import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  normalizeObjectId,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import { deleteApp, getAppPublishStatus, updateAppName } from "@/lib/db";

type WorkspaceAppRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

export async function GET(
  request: Request,
  context: WorkspaceAppRouteContext,
) {
  const { workspaceId, appId: rawAppId } = await context.params;
  const appId = normalizeObjectId(rawAppId);

  if (!appId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;

  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) {
      return guardErrorToApiResponse(error);
    }

    throw error;
  }

  const access = await resolveAppAccess({ workspaceContext, appId });

  if (!access) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const app = access.app;
  const canSeeDraftState = access.canCollaborate;

  return NextResponse.json({
    id: app._id,
    workspaceId: app.workspaceId,
    name: app.name,
    description: app.description ?? null,
    createdByUserId: canSeeDraftState ? app.createdByUserId : null,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    publishStatus: canSeeDraftState ? getAppPublishStatus(app) : "published",
    teamIds: canSeeDraftState ? (app.teamIds ?? []) : [],
    collaboratorUserIds: canSeeDraftState ? (app.collaboratorUserIds ?? []) : [],
  });
}

export async function PATCH(
  request: Request,
  context: WorkspaceAppRouteContext,
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
    if (isRequestGuardError(error)) {
      return guardErrorToApiResponse(error);
    }
    throw error;
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string;
  } | null;

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!access.canManage) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const updatedName = await updateAppName({
    workspaceId: workspaceContext.workspaceId,
    appId,
    name,
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app.renamed",
    category: "apps",
    severity: "info",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId,
      appName: updatedName,
    }),
    target: { type: "app", id: appId, name: updatedName },
    action: "renamed",
    summary: `Renamed app from ${access.app.name} to ${updatedName}.`,
    metadata: {
      previousName: access.app.name,
      newName: updatedName,
    },
    changes: { changedFields: ["name"] },
    relatedIds: { appId },
  });

  return NextResponse.json({ ok: true, name: updatedName });
}

export async function DELETE(
  request: Request,
  context: WorkspaceAppRouteContext,
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
    if (isRequestGuardError(error)) {
      return guardErrorToApiResponse(error);
    }
    throw error;
  }

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!access.canManage) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await deleteApp({
    workspaceId: workspaceContext.workspaceId,
    appId,
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app.deleted",
    category: "apps",
    severity: "warning",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId,
      appName: access.app.name,
    }),
    target: { type: "app", id: appId, name: access.app.name },
    action: "deleted",
    summary: `Deleted app ${access.app.name}.`,
    metadata: {
      publishStatus: getAppPublishStatus(access.app),
    },
    relatedIds: { appId },
  });

  return NextResponse.json({ ok: true });
}
