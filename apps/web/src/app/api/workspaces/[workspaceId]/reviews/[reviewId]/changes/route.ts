import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  isWorkspaceAdminRole,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  findReviewRequestById,
  markReviewRequestChangesRequested,
  requestAppChanges,
} from "@/lib/db";

type ReviewActionRouteContext = {
  params: Promise<{
    workspaceId: string;
    reviewId: string;
  }>;
};

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

  const body = (await request.json().catch(() => null)) as
    | { message?: string }
    | null;
  const message =
    typeof body?.message === "string" && body.message.trim()
      ? body.message.trim()
      : "Changes requested before this app can be published.";

  const review = await findReviewRequestById({
    workspaceId: workspaceContext.workspaceId,
    reviewId,
  });

  if (!review || review.resourceType !== "app" || review.status !== "pending") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const changesRequested = await requestAppChanges({
    workspaceId: workspaceContext.workspaceId,
    appId: review.resourceId,
    message,
    reviewerUserId: workspaceContext.user._id,
  });
  if (!changesRequested) {
    return NextResponse.json({ error: "review_stale" }, { status: 409 });
  }

  await markReviewRequestChangesRequested({
    workspaceId: workspaceContext.workspaceId,
    reviewId,
    reviewerUserId: workspaceContext.user._id,
    reviewerUserName: workspaceContext.user.displayName,
    message,
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "review.changes_requested",
    category: "reviews",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId: review.resourceId,
      appName: review.resourceName,
    }),
    target: { type: "review", id: reviewId, name: review.resourceName },
    action: "changes_requested",
    summary: `Requested changes for ${review.resourceName}.`,
    metadata: {
      resourceType: review.resourceType,
      resourceId: review.resourceId,
      messageLength: message.length,
    },
    relatedIds: {
      appId: review.resourceId,
      reviewRequestId: reviewId,
    },
  });

  return NextResponse.json({ ok: true });
}
