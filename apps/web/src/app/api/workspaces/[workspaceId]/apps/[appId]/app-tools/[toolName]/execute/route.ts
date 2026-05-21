import { NextResponse } from "next/server";
import {
  getDraftAgentsJsonApproval,
} from "@/lib/agents/agents-governance";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  getAppSourceFilesForVersion,
  normalizeIntegrationKeySlug,
} from "@/lib/db";
import { normalizeAppSourceVersion } from "@/lib/app-data-scope";
import {
  createIntegrationActionDeniedResult,
  createIntegrationActionMockResult,
  executeIntegrationHttpAction,
  findApprovedAppTool,
} from "@/lib/integrations/execute-http-action";
import type {
  IntegrationActionExecutionResult,
  OAuthTokenRefreshAuditInput,
} from "@/lib/integrations/execute-http-action";

type AppToolExecuteRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
    toolName: string;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseFromExecutionResult(result: IntegrationActionExecutionResult) {
  return NextResponse.json(result.body, { status: result.status });
}

async function recordAppToolAuditEvent(input: {
  request: Request;
  workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  appId: string;
  appName?: string;
  sourceVersion: "draft" | "published";
  toolName: string;
  toolSpec: {
    integration?: {
      domain?: string;
      keySlug?: string;
    };
  };
  result: IntegrationActionExecutionResult;
}) {
  const integration = input.result.audit.integration;

  await recordAuditEvent({
    workspaceId: input.workspaceContext.workspaceId,
    eventName: input.result.audit.eventName,
    category: "tools",
    severity: input.result.audit.severity,
    outcome: input.result.audit.outcome,
    actor: auditActorFromWorkspaceContext(input.workspaceContext),
    source: auditSourceFromRequest(input.request, {
      kind: "app_iframe",
      trust: "client_untrusted",
      appId: input.appId,
      appName: input.appName,
      sourceVersion: input.sourceVersion,
    }),
    target: {
      type: "tool",
      id: input.toolName,
      name: input.toolName,
      parentType: "app",
      parentId: input.appId,
    },
    action: input.result.audit.eventName.split(".").at(-1) ?? "executed",
    summary: input.result.audit.summary,
    metadata: {
      toolName: input.toolName,
      integrationDomain: input.toolSpec.integration?.domain,
      integrationKeySlug: normalizeIntegrationKeySlug(
        input.toolSpec.integration?.keySlug,
      ),
      integrationId: integration?._id,
      integrationName: integration?.name,
      appId: integration?.appId,
      credentialId: integration?.credentialId,
      sourceVersion: input.sourceVersion,
      source: "app_iframe",
      ...input.result.audit.metadata,
    },
    relatedIds: {
      appId: input.appId,
      integrationId: integration?._id,
    },
  });
}

async function recordAppOAuthRefreshAuditEvent(input: {
  request: Request;
  workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  appId: string;
  appName?: string;
  sourceVersion: "draft" | "published";
  toolName: string;
  event: OAuthTokenRefreshAuditInput;
}) {
  await recordAuditEvent({
    workspaceId: input.workspaceContext.workspaceId,
    eventName: "oauth.token_refreshed",
    category: "integrations",
    severity: "info",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(input.workspaceContext),
    source: auditSourceFromRequest(input.request, {
      kind: "app_iframe",
      trust: "client_untrusted",
      appId: input.appId,
      appName: input.appName,
      sourceVersion: input.sourceVersion,
    }),
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
      toolName: input.toolName,
      sourceVersion: input.sourceVersion,
      source: "app_iframe",
    },
    relatedIds: {
      appId: input.appId,
      integrationId: input.event.integration?._id,
    },
  });
}

async function auditedResponse(input: {
  request: Request;
  workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  appId: string;
  appName?: string;
  sourceVersion: "draft" | "published";
  toolName: string;
  toolSpec: { integration?: { domain?: string; keySlug?: string } };
  result: IntegrationActionExecutionResult;
}) {
  await recordAppToolAuditEvent(input);
  return responseFromExecutionResult(input.result);
}

export async function POST(
  request: Request,
  context: AppToolExecuteRouteContext,
) {
  const { workspaceId, appId, toolName } = await context.params;

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const sourceVersion = normalizeAppSourceVersion(url.searchParams.get("version"));
  if (sourceVersion === "draft" && !access.canCollaborate) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rawBody = await request.json().catch(() => null);
  if (!isRecord(rawBody)) {
    return NextResponse.json(
      { success: false, error: "Request body must be a JSON object.", mock: false },
      { status: 400 },
    );
  }
  if (rawBody.input !== undefined && !isRecord(rawBody.input)) {
    return NextResponse.json(
      {
        success: false,
        error: "input must be an object when provided.",
        mock: false,
      },
      { status: 400 },
    );
  }
  const toolInput = isRecord(rawBody.input) ? rawBody.input : {};

  const approvedPayload =
    sourceVersion === "draft"
      ? access.app.agentsJsonApprovedPayload
      : access.app.publishedAgentsJsonApprovedPayload;

  if (sourceVersion === "draft") {
    const sourceFiles = await getAppSourceFilesForVersion({
      workspaceId: workspaceContext.workspaceId,
      appId,
      version: "draft",
    });
    const approval = getDraftAgentsJsonApproval({
      app: access.app,
      sourceFiles,
    });
    if (!approval.approved || !approvedPayload) {
      const result = createIntegrationActionDeniedResult({
        toolName,
        error: "Draft agents.json must be approved before live app actions can run.",
        status: 403,
        metadata: { reason: "draft_app_tools_config_unapproved" },
      });
      return auditedResponse({
        request,
        workspaceContext,
        appId,
        appName: access.app.name,
        sourceVersion,
        toolName,
        toolSpec: {},
        result,
      });
    }
  } else if (!approvedPayload) {
    const result = createIntegrationActionDeniedResult({
      toolName,
      error: "App tool is not part of the published approved agents.json.",
      status: 403,
      metadata: { reason: "published_agents_config_missing_app_tool" },
    });
    return auditedResponse({
      request,
      workspaceContext,
      appId,
      appName: access.app.name,
      sourceVersion,
      toolName,
      toolSpec: {},
      result,
    });
  }

  const toolSpec = findApprovedAppTool({ payload: approvedPayload, toolName });
  if (!toolSpec) {
    const result = createIntegrationActionDeniedResult({
      toolName,
      error: "App tool is not part of the approved agents.json appTools policy.",
      status: 403,
      metadata: { reason: "approved_app_tool_missing" },
    });
    return auditedResponse({
      request,
      workspaceContext,
      appId,
      appName: access.app.name,
      sourceVersion,
      toolName,
      toolSpec: {},
      result,
    });
  }

  if (
    sourceVersion === "draft" &&
    access.app.agentsJsonApprovalSource === "build_chat_mock"
  ) {
    const result = createIntegrationActionMockResult({
      toolName,
      toolSpec,
      reason: "Draft agents.json was approved for mock-data development. Real data from integrations requires review by a workspace admin or owner.",
    });
    return auditedResponse({
      request,
      workspaceContext,
      appId,
      appName: access.app.name,
      sourceVersion,
      toolName,
      toolSpec,
      result,
    });
  }

  const result = await executeIntegrationHttpAction({
    workspaceId: workspaceContext.workspaceId,
    appId,
    toolName,
    toolSpec,
    toolInput,
    oauthIdentity: {
      kind: "app_runtime",
      userId: workspaceContext.user._id,
    },
    onOAuthTokenRefreshed: async (event) => {
      await recordAppOAuthRefreshAuditEvent({
        request,
        workspaceContext,
        appId,
        appName: access.app.name,
        sourceVersion,
        toolName,
        event,
      });
    },
  });

  return auditedResponse({
    request,
    workspaceContext,
    appId,
    appName: access.app.name,
    sourceVersion,
    toolName,
    toolSpec,
    result,
  });
}
