import { NextResponse } from "next/server";
import {
  getDraftAgentsJsonApproval,
} from "@/lib/agents/agents-governance";
import { validateInternalToken } from "@/lib/auth/internal-auth";
import { recordAuditEvent } from "@/lib/audit/record";
import {
  findAppById,
  getAppSourceFilesForVersion,
  normalizeIntegrationKeySlug,
} from "@/lib/db";
import {
  approvedAgentsPayloadIncludesTool,
  createIntegrationActionDeniedResult,
  createIntegrationActionMockResult,
  executeIntegrationHttpAction,
} from "@/lib/integrations/execute-http-action";
import type {
  CustomHttpActionSpec,
  IntegrationActionExecutionResult,
  OAuthTokenRefreshAuditInput,
} from "@/lib/integrations/execute-http-action";

type ToolExecuteRequest = {
  workspaceId: string;
  appId: string;
  runId?: string;
  sourceVersion?: "draft" | "published";
  agentId?: string;
  toolName: string;
  toolSpec: CustomHttpActionSpec;
  toolInput: Record<string, unknown>;
};

async function recordToolAuditEvent(input: {
  body: ToolExecuteRequest;
  appName?: string;
  result: IntegrationActionExecutionResult;
}) {
  const integration = input.result.audit.integration;

  await recordAuditEvent({
    workspaceId: input.body.workspaceId,
    eventName: input.result.audit.eventName,
    category: "tools",
    severity: input.result.audit.severity,
    outcome: input.result.audit.outcome,
    actor: {
      kind: "agent",
      agentId: input.body.agentId,
      agentName: input.body.agentId,
    },
    source: {
      kind: "app_agent",
      trust: "internal_trusted",
      appId: input.body.appId,
      appName: input.appName,
      sourceVersion: input.body.sourceVersion ?? "published",
      runId: input.body.runId,
    },
    target: {
      type: "tool",
      id: input.body.toolName,
      name: input.body.toolName,
      parentType: "app",
      parentId: input.body.appId,
    },
    action: input.result.audit.eventName.split(".").at(-1) ?? "executed",
    summary: input.result.audit.summary,
    metadata: {
      toolName: input.body.toolName,
      integrationDomain: input.body.toolSpec?.integration?.domain,
      integrationKeySlug: normalizeIntegrationKeySlug(
        input.body.toolSpec?.integration?.keySlug,
      ),
      integrationId: integration?._id,
      integrationName: integration?.name,
      appId: integration?.appId,
      credentialId: integration?.credentialId,
      sourceVersion: input.body.sourceVersion ?? "published",
      runId: input.body.runId,
      ...input.result.audit.metadata,
    },
    relatedIds: {
      appId: input.body.appId,
      agentRunId: input.body.runId,
      integrationId: integration?._id,
    },
  });
}

async function recordAgentOAuthRefreshAuditEvent(input: {
  body: ToolExecuteRequest;
  appName?: string;
  event: OAuthTokenRefreshAuditInput;
}) {
  await recordAuditEvent({
    workspaceId: input.body.workspaceId,
    eventName: "oauth.token_refreshed",
    category: "integrations",
    severity: "info",
    outcome: "success",
    actor: {
      kind: "agent",
      agentId: input.body.agentId,
      agentName: input.body.agentId,
    },
    source: {
      kind: "app_agent",
      trust: "internal_trusted",
      appId: input.body.appId,
      appName: input.appName,
      sourceVersion: input.body.sourceVersion ?? "published",
      runId: input.body.runId,
    },
    target: {
      type: "connected_account",
      id: input.event.accountId,
      name: input.event.accountProviderKey,
      parentType: "oauth_provider_config",
      parentId: input.event.providerConfig._id,
    },
    action: "token_refreshed",
    summary: `Refreshed OAuth access token for ${input.event.providerConfig.displayName}.`,
    metadata: {
      providerKey: input.event.auth.providerKey,
      providerConfigId: input.event.providerConfig._id,
      integrationId: input.event.integration?._id,
      toolName: input.body.toolName,
      runId: input.body.runId,
    },
    relatedIds: {
      appId: input.body.appId,
      agentRunId: input.body.runId,
      integrationId: input.event.integration?._id,
    },
  });
}

function responseFromExecutionResult(result: IntegrationActionExecutionResult) {
  return NextResponse.json(result.body, { status: result.status });
}

async function auditedResponse(input: {
  body: ToolExecuteRequest;
  appName?: string;
  result: IntegrationActionExecutionResult;
}) {
  await recordToolAuditEvent(input);
  return responseFromExecutionResult(input.result);
}

export async function POST(request: Request) {
  const authError = validateInternalToken(request);
  if (authError) return authError;

  const body = (await request.json()) as ToolExecuteRequest;
  const { workspaceId, appId, toolSpec } = body;
  const toolInput = body.toolInput ?? {};

  if (!workspaceId || !appId || !body.agentId || !body.toolName || !toolSpec) {
    return NextResponse.json(
      {
        success: false,
        error: "workspaceId, appId, agentId, toolName, and toolSpec are required",
        mock: false,
      },
      { status: 400 },
    );
  }

  const app = await findAppById({ workspaceId, appId });
  if (!app) {
    return NextResponse.json(
      {
        success: false,
        error: "App was not found for approved agents.json enforcement.",
        mock: false,
      },
      { status: 403 },
    );
  }

  if (body.sourceVersion === "draft") {
    const sourceFiles = await getAppSourceFilesForVersion({
      workspaceId,
      appId,
      version: "draft",
    });
    const approval = getDraftAgentsJsonApproval({
      app,
      sourceFiles,
    });
    const approvedTool =
      !!app.agentsJsonApprovedPayload &&
      approvedAgentsPayloadIncludesTool({
        payload: app.agentsJsonApprovedPayload,
        agentId: body.agentId,
        toolName: body.toolName,
        toolSpec,
      });
    if (!approval?.approved || !approvedTool) {
      const result = createIntegrationActionDeniedResult({
        toolName: body.toolName,
        error: "Draft agents.json must be approved before live tools can run.",
        status: 403,
        metadata: { reason: "draft_agents_config_unapproved" },
      });
      return auditedResponse({ body, appName: app.name, result });
    }
    if (app.agentsJsonApprovalSource === "build_chat_mock") {
      const result = createIntegrationActionMockResult({
        toolName: body.toolName,
        toolSpec,
        reason: "Draft agents.json was approved for mock-data development. Real data from integrations requires review by a workspace admin or owner.",
      });
      return auditedResponse({ body, appName: app.name, result });
    }
  } else {
    if (
      !app.publishedAgentsJsonApprovedPayload ||
      !approvedAgentsPayloadIncludesTool({
        payload: app.publishedAgentsJsonApprovedPayload,
        agentId: body.agentId,
        toolName: body.toolName,
        toolSpec,
      })
    ) {
      const result = createIntegrationActionDeniedResult({
        toolName: body.toolName,
        error: "Tool is not part of the published approved agents.json.",
        status: 403,
        metadata: { reason: "published_agents_config_missing_tool" },
      });
      return auditedResponse({ body, appName: app.name, result });
    }
  }

  const result = await executeIntegrationHttpAction({
    workspaceId,
    appId,
    toolName: body.toolName,
    toolSpec,
    toolInput,
    oauthIdentity: {
      kind: "app_agent",
      runId: body.runId,
    },
    onOAuthTokenRefreshed: async (event) => {
      await recordAgentOAuthRefreshAuditEvent({
        body,
        appName: app.name,
        event,
      });
    },
  });

  return auditedResponse({ body, appName: app.name, result });
}
