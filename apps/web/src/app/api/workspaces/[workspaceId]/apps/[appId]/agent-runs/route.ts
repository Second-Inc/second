import { NextResponse } from "next/server";
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
  createAppAgentRun,
  getAppSourceFilesForVersion,
  listAppAgentRuns,
} from "@/lib/db";

type AgentRunsRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

type AgentsJsonToolDef = {
  type: "builtin" | "custom";
  name: string;
  displayName?: string;
  enabled: boolean;
};

type AgentsJsonAgentDef = {
  id: string;
  name: string;
  systemPrompt: string;
  tools: AgentsJsonToolDef[];
};

type AgentsJson = {
  agents: AgentsJsonAgentDef[];
};

export async function POST(request: Request, context: AgentRunsRouteContext) {
  const { workspaceId, appId } = await context.params;

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
  const app = access.app;

  const body = (await request.json()) as {
    agentId: string;
    prompt: string;
    sourceVersion?: "draft" | "published";
  };

  // Validate agent exists in agents.json
  const sourceVersion =
    body.sourceVersion === "draft" && access.canCollaborate
      ? "draft"
      : "published";
  const sourceFiles = await getAppSourceFilesForVersion({
    workspaceId: workspaceContext.workspaceId,
    appId,
    version: sourceVersion,
  });

  const agentsJsonRaw = sourceFiles?.["agents.json"];
  if (!agentsJsonRaw) {
    return NextResponse.json({ error: "no_agents_defined" }, { status: 400 });
  }

  let agentsJson: AgentsJson;
  try {
    agentsJson = JSON.parse(agentsJsonRaw) as AgentsJson;
  } catch {
    return NextResponse.json({ error: "invalid_agents_json" }, { status: 400 });
  }

  const agentDef = agentsJson.agents.find((a) => a.id === body.agentId);
  if (!agentDef) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  // Create the run document — streaming is started by the /stream endpoint
  const run = await createAppAgentRun({
    appId,
    workspaceId: workspaceContext.workspaceId,
    sourceVersion,
    agentId: body.agentId,
    agentName: agentDef.name,
    triggeredBy: {
      userId: workspaceContext.user._id,
      email: workspaceContext.user.email,
      displayName: workspaceContext.user.displayName,
    },
    prompt: body.prompt,
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app_agent_run.created",
    category: "agents",
    severity: "info",
    outcome: "started",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      kind: "app_iframe",
      trust: "client_untrusted",
      appId,
      appName: app.name,
      sourceVersion,
      runId: run._id,
    }),
    target: {
      type: "run",
      id: run._id,
      name: agentDef.name,
      parentType: "app",
      parentId: appId,
    },
    action: "created",
    summary: `Created app-agent run for ${agentDef.name}.`,
    metadata: {
      agentId: body.agentId,
      agentName: agentDef.name,
      sourceVersion,
      promptLength: body.prompt?.length ?? 0,
    },
    relatedIds: { appId, agentRunId: run._id },
  });

  return NextResponse.json({ runId: run._id }, { status: 201 });
}

export async function GET(request: Request, context: AgentRunsRouteContext) {
  const { workspaceId, appId } = await context.params;

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

  const runs = await listAppAgentRuns(
    appId,
    workspaceContext.workspaceId,
    access.canCollaborate ? undefined : "published",
  );
  return NextResponse.json(
    {
      runs: runs.map((r) => ({
        id: r._id,
        agentId: r.agentId,
        agentName: r.agentName,
        prompt: r.prompt,
        status: r.status,
        triggeredByUserId: r.triggeredByUserId ?? null,
        triggeredByUserName: r.triggeredByUserName ?? null,
        createdAt: r.createdAt,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
