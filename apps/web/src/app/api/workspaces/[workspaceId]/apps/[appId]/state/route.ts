import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import {
  appHasPublishedVersion,
  appHasUnpublishedChanges,
  getAppPublishStatus,
  findPendingAppReviewRequest,
  getWorkspaceAppRuntimeSettings,
  integrationNeedsSetup,
  listIntegrationsForAppReview,
} from "@/lib/db";

type AppStateRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

export async function GET(request: Request, context: AppStateRouteContext) {
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
  const publishStatus = getAppPublishStatus(app);
  const hasPublishedVersion = appHasPublishedVersion(app);
  const hasDraftChanges = appHasUnpublishedChanges(app);
  const canSeeDraftState = access.canCollaborate;
  const visiblePublishStatus =
    canSeeDraftState || !hasPublishedVersion ? publishStatus : "published";
  const visibleHasDraftChanges = canSeeDraftState ? hasDraftChanges : false;
  const [appRuntimeSettings, pendingReview, integrations] = await Promise.all([
    getWorkspaceAppRuntimeSettings(workspaceContext.workspaceId),
    canSeeDraftState
      ? findPendingAppReviewRequest({
          workspaceId: workspaceContext.workspaceId,
          appId,
        })
      : Promise.resolve(null),
    canSeeDraftState
      ? listIntegrationsForAppReview({
          workspaceId: workspaceContext.workspaceId,
          appId,
        })
      : Promise.resolve([]),
  ]);
  const visibleAppTeamIds = canSeeDraftState
    ? (pendingReview?.targetTeamIds ?? app.teamIds ?? [])
    : [];

  return NextResponse.json(
    {
      publishStatus: visiblePublishStatus,
      reviewRequestedAt: canSeeDraftState
        ? (app.reviewRequestedAt?.toISOString() ?? null)
        : null,
      changeRequestMessage: canSeeDraftState
        ? (app.changeRequestMessage ?? null)
        : null,
      agentsJsonApprovalSource: canSeeDraftState
        ? (app.agentsJsonApprovalSource ?? null)
        : null,
      appTeamIds: visibleAppTeamIds,
      collaboratorUserIds: canSeeDraftState ? (app.collaboratorUserIds ?? []) : [],
      hasPublishedVersion,
      hasDraftChanges: visibleHasDraftChanges,
      appRuntimeSettings,
      integrations: integrations.map((integration) => {
        return {
          id: integration._id,
          name: integration.name,
          domain: integration.domain,
          keySlug: integration.keySlug,
          keyName: integration.keyName,
          capabilityLabel: integration.capabilityLabel,
          faviconUrl: integration.faviconUrl,
          configured: integration.configured,
          needsSetup: integrationNeedsSetup(integration),
          permissionGroups: integration.permissionGroups ?? [],
          secretRequirements: integration.secretRequirements ?? [],
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
