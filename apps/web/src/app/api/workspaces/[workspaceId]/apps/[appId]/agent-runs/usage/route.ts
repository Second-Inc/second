import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import { summarizeAppAgentRunUsage } from "@/lib/db";

type AgentRunUsageRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

export async function GET(
  request: Request,
  context: AgentRunUsageRouteContext,
) {
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

  const summary = await summarizeAppAgentRunUsage(
    appId,
    workspaceContext.workspaceId,
    access.canCollaborate ? undefined : "published",
  );

  return NextResponse.json(summary, {
    headers: { "Cache-Control": "no-store" },
  });
}
