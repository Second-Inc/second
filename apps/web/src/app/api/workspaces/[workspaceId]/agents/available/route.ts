import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import { listAvailableWorkspaceAgentsForViewer } from "@/lib/db";
import {
  createWorkspaceResourceViewer,
  serializeWorkspaceAgent,
} from "@/lib/workspace-resources";

type AvailableAgentsRouteContext = {
  params: Promise<{ workspaceId: string }>;
};

export async function GET(
  request: Request,
  context: AvailableAgentsRouteContext,
) {
  const { workspaceId } = await context.params;
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

  const viewer = await createWorkspaceResourceViewer(workspaceContext);
  const agents = await listAvailableWorkspaceAgentsForViewer({
    workspaceId: workspaceContext.workspaceId,
    viewer,
  });

  return NextResponse.json({
    items: agents.map((agent) => {
      const serialized = serializeWorkspaceAgent(agent);
      return {
        _id: serialized._id,
        slug: serialized.slug,
        avatarGradientSeed: serialized.avatarGradientSeed ?? null,
        displayName: serialized.displayName,
        description: serialized.description,
        approvalStatus: serialized.approvalStatus,
        status: serialized.status,
      };
    }),
  });
}
