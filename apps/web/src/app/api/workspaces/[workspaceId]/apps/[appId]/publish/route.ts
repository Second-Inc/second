import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  isWorkspaceAdminRole,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import { InvalidAgentsJsonError } from "@/lib/agents/agents-governance";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import { readRuntimeConfig } from "@/lib/config";
import {
  approveCurrentAppAgentsJson,
  integrationNeedsSetup,
  listIntegrationsForAppReview,
  listWorkspaceTeams,
  markReviewRequestApproved,
  publishApp,
  requestAppReview,
  upsertAppReviewRequest,
} from "@/lib/db";

type PublishRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

async function validateTeamIds(workspaceId: string, teamIds: string[]) {
  const teams = await listWorkspaceTeams(workspaceId);
  const validIds = new Set(teams.map((team) => team._id));
  return teamIds.length > 0 && teamIds.every((teamId) => validIds.has(teamId));
}

export async function POST(request: Request, context: PublishRouteContext) {
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
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!access.canCollaborate) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { teamIds?: unknown; mode?: "request" | "publish" }
    | null;
  const teamIds = uniqueStrings(body?.teamIds);
  if (!(await validateTeamIds(workspaceContext.workspaceId, teamIds))) {
    return NextResponse.json({ error: "invalid_team_selection" }, { status: 400 });
  }

  const config = readRuntimeConfig();
  const localMode = config.authMode === "none";
  const reviewer = isWorkspaceAdminRole(workspaceContext.membership.role);
  const shouldRequestReview = body?.mode === "request" || !reviewer;

  if (shouldRequestReview) {
    await requestAppReview({
      workspaceId: workspaceContext.workspaceId,
      appId,
      teamIds,
      requestedByUserId: workspaceContext.user._id,
      requestedByUserName: workspaceContext.user.displayName,
    });
    const review = await upsertAppReviewRequest({
      workspaceId: workspaceContext.workspaceId,
      appId,
      appName: access.app.name,
      requestedByUserId: workspaceContext.user._id,
      requestedByUserName: workspaceContext.user.displayName,
      targetTeamIds: teamIds,
    });

    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "review.requested",
      category: "reviews",
      severity: "notice",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        appId,
        appName: access.app.name,
      }),
      target: { type: "review", id: review._id, name: access.app.name },
      action: "requested",
      summary: `Requested review for ${access.app.name}.`,
      metadata: {
        targetTeamIds: teamIds,
      },
      relatedIds: {
        appId,
        reviewRequestId: review._id,
      },
    });

    return NextResponse.json({
      action: "review_requested",
      reviewId: review._id,
    });
  }

  if (!localMode) {
    const integrations = await listIntegrationsForAppReview({
      workspaceId: workspaceContext.workspaceId,
      appId,
    });
    if (integrations.some((integration) => integrationNeedsSetup(integration))) {
      return NextResponse.json(
        { error: "integrations_setup_required" },
        { status: 409 },
      );
    }
  }

  try {
    const agentsApproval = await approveCurrentAppAgentsJson({
      workspaceId: workspaceContext.workspaceId,
      appId,
      approvedByUserId: workspaceContext.user._id,
      approvedByUserName: workspaceContext.user.displayName,
      source: "publish",
    });
    if (agentsApproval.hasAgentsJson) {
      await recordAuditEvent({
        workspaceId: workspaceContext.workspaceId,
        eventName: "app.agents_config.approved",
        category: "agents",
        severity: "notice",
        outcome: "success",
        actor: auditActorFromWorkspaceContext(workspaceContext),
        source: auditSourceFromRequest(request, {
          appId,
          appName: access.app.name,
        }),
        target: {
          type: "agent",
          id: agentsApproval.hash ?? appId,
          name: `${access.app.name} agents.json`,
          parentType: "app",
          parentId: appId,
        },
        action: "approved",
        summary: `Approved app-agent runtime policy for ${access.app.name}.`,
        metadata: {
          approvalSource: "publish",
          agentsJsonHash: agentsApproval.hash,
        },
        changes: { changedFields: ["agentsJsonApprovalHash"] },
        relatedIds: { appId },
      });
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

  await publishApp({
    workspaceId: workspaceContext.workspaceId,
    appId,
    teamIds,
    publishedByUserId: workspaceContext.user._id,
  });

  const previousVisibility = access.app.visibility ?? "workspace";
  if (previousVisibility !== "teams") {
    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "app.visibility_changed",
      category: "apps",
      severity: "notice",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        appId,
        appName: access.app.name,
      }),
      target: { type: "app", id: appId, name: access.app.name },
      action: "visibility_changed",
      summary: `Changed visibility for ${access.app.name}.`,
      metadata: {
        previousVisibility,
        nextVisibility: "teams",
      },
      changes: { changedFields: ["visibility"] },
      relatedIds: { appId },
    });
  }

  const previousTeamIds = access.app.teamIds ?? [];
  if (!sameStringSet(previousTeamIds, teamIds)) {
    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "app.teams_changed",
      category: "apps",
      severity: "notice",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        appId,
        appName: access.app.name,
      }),
      target: { type: "app", id: appId, name: access.app.name },
      action: "teams_changed",
      summary: `Changed publishing teams for ${access.app.name}.`,
      metadata: {
        previousTeamIds,
        targetTeamIds: teamIds,
      },
      changes: { changedFields: ["teamIds"] },
      relatedIds: { appId },
    });
  }

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app.published",
    category: "apps",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId,
      appName: access.app.name,
    }),
    target: { type: "app", id: appId, name: access.app.name },
    action: "published",
    summary: `Published app ${access.app.name}.`,
    metadata: {
      targetTeamIds: teamIds,
      localMode,
    },
    changes: { changedFields: ["publishStatus", "teamIds", "publishedSnapshotId"] },
    relatedIds: { appId },
  });

  if (!localMode) {
    const review = await upsertAppReviewRequest({
      workspaceId: workspaceContext.workspaceId,
      appId,
      appName: access.app.name,
      requestedByUserId: workspaceContext.user._id,
      requestedByUserName: workspaceContext.user.displayName,
      targetTeamIds: teamIds,
    });
    await markReviewRequestApproved({
      workspaceId: workspaceContext.workspaceId,
      reviewId: review._id,
      reviewerUserId: workspaceContext.user._id,
      reviewerUserName: workspaceContext.user.displayName,
    });
    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "review.approved",
      category: "reviews",
      severity: "notice",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        appId,
        appName: access.app.name,
      }),
      target: { type: "review", id: review._id, name: access.app.name },
      action: "approved",
      summary: `Approved review for ${access.app.name}.`,
      metadata: {
        targetTeamIds: teamIds,
        selfPublished: true,
      },
      relatedIds: {
        appId,
        reviewRequestId: review._id,
      },
    });
  }

  return NextResponse.json({ action: "published" });
}
