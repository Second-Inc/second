import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import { listWorkspaceTools } from "@/lib/db";

type WorkspaceAgentToolsRouteContext = {
  params: Promise<{ workspaceId: string }>;
};

export async function GET(
  request: Request,
  context: WorkspaceAgentToolsRouteContext,
) {
  const { workspaceId } = await context.params;

  try {
    await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  return NextResponse.json({ items: await listWorkspaceTools() });
}
