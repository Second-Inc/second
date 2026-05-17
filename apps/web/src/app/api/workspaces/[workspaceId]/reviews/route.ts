import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  isWorkspaceAdminRole,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  findAppById,
  integrationNeedsSetup,
  listDoneBuildingSummariesForApp,
  listIntegrationsForAppReview,
  listReviewRequestsForWorkspace,
  listWorkspaceTeams,
} from "@/lib/db";
import type {
  IntegrationGrantWithCredential,
  ReviewRequestDocument,
  ReviewRequestStatus,
} from "@/lib/db/types";

type ReviewsRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

function parseStatus(value: string | null): ReviewRequestStatus | undefined {
  if (
    value === "pending" ||
    value === "approved" ||
    value === "changes_requested" ||
    value === "superseded"
  ) {
    return value;
  }
  return undefined;
}

function serializeReview(
  review: ReviewRequestDocument,
  input: {
    app: Awaited<ReturnType<typeof findAppById>>;
    teamNames: string[];
    integrations: IntegrationGrantWithCredential[];
    changes: string[];
  },
) {
  return {
    id: review._id,
    resourceType: review.resourceType,
    resourceId: review.resourceId,
    resourceName: input.app?.name ?? review.resourceName,
    resourceDescription: input.app?.description ?? null,
    changes: input.changes,
    status: review.status,
    requestedByUserId: review.requestedByUserId,
    requestedByUserName: review.requestedByUserName,
    requestedAt: review.requestedAt.toISOString(),
    targetTeamIds: review.targetTeamIds,
    targetTeamNames: input.teamNames,
    reviewerUserName: review.reviewerUserName ?? null,
    reviewedAt: review.reviewedAt?.toISOString() ?? null,
    reviewMessage: review.reviewMessage ?? null,
    appStatus: input.app?.publishStatus ?? "published",
    integrations: input.integrations.map((integration) => {
      return {
        id: integration._id,
        appId: integration.appId,
        appName: integration.appName,
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
  };
}

export async function GET(request: Request, context: ReviewsRouteContext) {
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

  if (!isWorkspaceAdminRole(workspaceContext.membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const [reviews, teams] = await Promise.all([
    listReviewRequestsForWorkspace({
      workspaceId: workspaceContext.workspaceId,
      status: parseStatus(url.searchParams.get("status")),
    }),
    listWorkspaceTeams(workspaceContext.workspaceId),
  ]);
  const teamNameById = new Map(teams.map((team) => [team._id, team.name]));

  const items = await Promise.all(
    reviews.map(async (review) => {
      const [app, integrations] = await Promise.all([
        review.resourceType === "app"
          ? findAppById({
              workspaceId: workspaceContext.workspaceId,
              appId: review.resourceId,
            })
          : null,
        review.resourceType === "app"
          ? listIntegrationsForAppReview({
              workspaceId: workspaceContext.workspaceId,
              appId: review.resourceId,
            })
          : [],
      ]);
      const changes =
        review.resourceType === "app"
          ? await listDoneBuildingSummariesForApp({
              workspaceId: workspaceContext.workspaceId,
              appId: review.resourceId,
            })
          : [];

      return serializeReview(review, {
        app,
        teamNames: review.targetTeamIds.map(
          (teamId) => teamNameById.get(teamId) ?? teamId,
        ),
        integrations,
        changes,
      });
    }),
  );

  return NextResponse.json({ items });
}
