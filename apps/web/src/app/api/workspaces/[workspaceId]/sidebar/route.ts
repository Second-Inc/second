import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  isWorkspaceAdminRole,
  listAppsVisibleInSidebarForWorkspaceContext,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  appHasPublishedVersion,
  getAppPublishStatus,
  listLatestRunStatesForWorkspace,
  listMembershipsForWorkspace,
  listReviewRequestsForWorkspace,
} from "@/lib/db";

type SidebarRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function GET(request: Request, context: SidebarRouteContext) {
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

  const canReview = isWorkspaceAdminRole(workspaceContext.membership.role);
  const [
    apps,
    appRunStates,
    memberships,
    reviews,
  ] = await Promise.all([
    listAppsVisibleInSidebarForWorkspaceContext(workspaceContext),
    listLatestRunStatesForWorkspace(workspaceContext.workspaceId),
    listMembershipsForWorkspace(workspaceContext.workspaceId),
    canReview
      ? listReviewRequestsForWorkspace({
          workspaceId: workspaceContext.workspaceId,
          status: "pending",
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json(
    {
      activeMemberCount: memberships.length,
      pendingReviewCount: reviews.length,
      apps: apps.map((app) => ({
        _id: app._id,
        name: app.name,
        runStatus:
          canReview ||
          app.createdByUserId === workspaceContext.user._id ||
          (app.collaboratorUserIds ?? []).includes(workspaceContext.user._id)
            ? (appRunStates[app._id]?.status ?? null)
            : null,
        toolRecoveryStatus:
          canReview ||
          app.createdByUserId === workspaceContext.user._id ||
          (app.collaboratorUserIds ?? []).includes(workspaceContext.user._id)
            ? (appRunStates[app._id]?.toolRecoveryStatus ?? null)
            : null,
        publishStatus: getAppPublishStatus(app),
        hasPublishedVersion: appHasPublishedVersion(app),
        canManage:
          canReview || app.createdByUserId === workspaceContext.user._id,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
