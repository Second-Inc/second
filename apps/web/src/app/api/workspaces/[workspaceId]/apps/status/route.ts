import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  isWorkspaceAdminRole,
  listAppsVisibleInSidebarForWorkspaceContext,
  requireWorkspaceContext,
} from "@/lib/auth";
import { listLatestRunStatesForWorkspace } from "@/lib/db";

type StatusRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function GET(request: Request, context: StatusRouteContext) {
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

  const [apps, states] = await Promise.all([
    listAppsVisibleInSidebarForWorkspaceContext(workspaceContext),
    listLatestRunStatesForWorkspace(workspaceContext.workspaceId),
  ]);
  const canReview = isWorkspaceAdminRole(workspaceContext.membership.role);
  const visibleBuilderAppIds = new Set(
    apps
      .filter(
        (app) =>
          canReview ||
          app.createdByUserId === workspaceContext.user._id ||
          (app.collaboratorUserIds ?? []).includes(workspaceContext.user._id),
      )
      .map((app) => app._id),
  );

  return NextResponse.json({
    statuses: Object.fromEntries(
      Object.entries(states)
        .filter(([appId]) => visibleBuilderAppIds.has(appId))
        .map(([appId, state]) => [appId, state.status]),
    ),
    toolRecoveryStatuses: Object.fromEntries(
      Object.entries(states)
        .filter(([appId]) => visibleBuilderAppIds.has(appId))
        .map(([appId, state]) => [appId, state.toolRecoveryStatus]),
    ),
  });
}
