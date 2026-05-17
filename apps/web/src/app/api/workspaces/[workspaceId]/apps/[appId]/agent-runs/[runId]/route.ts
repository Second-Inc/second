import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import {
  loadAppAgentRunForApp,
  loadAppAgentRunSummaryForApp,
} from "@/lib/db";

type AgentRunRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
    runId: string;
  }>;
};

export async function GET(request: Request, context: AgentRunRouteContext) {
  const { workspaceId, appId, runId } = await context.params;
  const url = new URL(request.url);
  const summaryOnly = url.searchParams.get("summary") === "1";
  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;

  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: url.pathname,
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

  const run = await (summaryOnly
    ? loadAppAgentRunSummaryForApp(
        runId,
        workspaceContext.workspaceId,
        appId,
      )
    : loadAppAgentRunForApp(
        runId,
        workspaceContext.workspaceId,
        appId,
      ));
  if (!run) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }
  if (run.sourceVersion === "draft" && !access.canCollaborate) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }

  const payload = {
    id: run._id,
    agentId: run.agentId,
    agentName: run.agentName,
    prompt: run.prompt,
    status: run.status,
    result: run.result,
    usage: run.usage,
    createdAt: run.createdAt,
    ...(!summaryOnly && "messages" in run ? { messages: run.messages } : {}),
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
