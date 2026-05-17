import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  isWorkspaceAdminRole,
  requireWorkspaceContext,
} from "@/lib/auth";
import { InvalidAgentsJsonError } from "@/lib/agents/agents-governance";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  findAppById,
  findReviewRequestById,
  integrationNeedsSetup,
  listIntegrationsForAppReview,
  markReviewRequestApproved,
  publishReviewRequestedApp,
} from "@/lib/db";

type ReviewActionRouteContext = {
  params: Promise<{
    workspaceId: string;
    reviewId: string;
  }>;
};

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

export async function POST(request: Request, context: ReviewActionRouteContext) {
  const { workspaceId, reviewId } = await context.params;

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

  const review = await findReviewRequestById({
    workspaceId: workspaceContext.workspaceId,
    reviewId,
  });

  if (!review || review.resourceType !== "app" || review.status !== "pending") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const integrations = await listIntegrationsForAppReview({
    workspaceId: workspaceContext.workspaceId,
    appId: review.resourceId,
  });

  if (integrations.some((integration) => integrationNeedsSetup(integration))) {
    return NextResponse.json(
      { error: "integrations_setup_required" },
      { status: 409 },
    );
  }

  const appBeforePublish = await findAppById({
    workspaceId: workspaceContext.workspaceId,
    appId: review.resourceId,
  });

  try {
    const published = await publishReviewRequestedApp({
      workspaceId: workspaceContext.workspaceId,
      appId: review.resourceId,
      teamIds: review.targetTeamIds,
      publishedByUserId: workspaceContext.user._id,
      approvedByUserId: workspaceContext.user._id,
      approvedByUserName: workspaceContext.user.displayName,
      approvalSource: "review",
    });
    if (!published) {
      return NextResponse.json({ error: "review_stale" }, { status: 409 });
    }
  } catch (error) {
    if (error instanceof InvalidAgentsJsonError) {
      return NextResponse.json(
        { error: "invalid_agents_json", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }

  const approved = await markReviewRequestApproved({
    workspaceId: workspaceContext.workspaceId,
    reviewId,
    reviewerUserId: workspaceContext.user._id,
    reviewerUserName: workspaceContext.user.displayName,
  });
  if (!approved) {
    return NextResponse.json({ error: "review_stale" }, { status: 409 });
  }

  const previousVisibility = appBeforePublish?.visibility ?? "workspace";
  if (previousVisibility !== "teams") {
    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "app.visibility_changed",
      category: "apps",
      severity: "notice",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        appId: review.resourceId,
        appName: review.resourceName,
      }),
      target: {
        type: "app",
        id: review.resourceId,
        name: review.resourceName,
      },
      action: "visibility_changed",
      summary: `Changed visibility for ${review.resourceName}.`,
      metadata: {
        previousVisibility,
        nextVisibility: "teams",
        reviewRequestId: reviewId,
      },
      changes: { changedFields: ["visibility"] },
      relatedIds: {
        appId: review.resourceId,
        reviewRequestId: reviewId,
      },
    });
  }

  const previousTeamIds = appBeforePublish?.teamIds ?? [];
  if (!sameStringSet(previousTeamIds, review.targetTeamIds)) {
    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "app.teams_changed",
      category: "apps",
      severity: "notice",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        appId: review.resourceId,
        appName: review.resourceName,
      }),
      target: {
        type: "app",
        id: review.resourceId,
        name: review.resourceName,
      },
      action: "teams_changed",
      summary: `Changed publishing teams for ${review.resourceName}.`,
      metadata: {
        previousTeamIds,
        targetTeamIds: review.targetTeamIds,
        reviewRequestId: reviewId,
      },
      changes: { changedFields: ["teamIds"] },
      relatedIds: {
        appId: review.resourceId,
        reviewRequestId: reviewId,
      },
    });
  }

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "review.approved",
    category: "reviews",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId: review.resourceId,
      appName: review.resourceName,
    }),
    target: { type: "review", id: reviewId, name: review.resourceName },
    action: "approved",
    summary: `Approved review for ${review.resourceName}.`,
    metadata: {
      resourceType: review.resourceType,
      resourceId: review.resourceId,
      targetTeamIds: review.targetTeamIds,
    },
    relatedIds: {
      appId: review.resourceId,
      reviewRequestId: reviewId,
    },
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app.published",
    category: "apps",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId: review.resourceId,
      appName: review.resourceName,
    }),
    target: { type: "app", id: review.resourceId, name: review.resourceName },
    action: "published",
    summary: `Published app ${review.resourceName} from review approval.`,
    metadata: {
      reviewRequestId: reviewId,
      targetTeamIds: review.targetTeamIds,
    },
    changes: { changedFields: ["publishStatus", "publishedSnapshotId", "teamIds"] },
    relatedIds: {
      appId: review.resourceId,
      reviewRequestId: reviewId,
    },
  });

  return NextResponse.json({ ok: true });
}
