import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import { auditSha256 } from "@/lib/audit/redaction";
import { deleteAppData, getAppDataDoc, updateAppData } from "@/lib/db";
import {
  appDataScopeId,
  normalizeAppSourceVersion,
} from "@/lib/app-data-scope";

type DocRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
    docId: string;
  }>;
};

export async function GET(request: Request, context: DocRouteContext) {
  const { workspaceId, appId, docId } = await context.params;

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

  const url = new URL(request.url);
  const sourceVersion = normalizeAppSourceVersion(url.searchParams.get("version"));
  if (sourceVersion === "draft" && !access.canCollaborate) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const dataAppId = appDataScopeId(appId, sourceVersion);
  const collection = url.searchParams.get("collection");
  if (!collection) {
    return NextResponse.json(
      { error: "collection query param required" },
      { status: 400 },
    );
  }

  const doc = await getAppDataDoc(
    workspaceContext.workspaceId,
    dataAppId,
    collection,
    docId,
  );

  if (!doc) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    doc: {
      _id: doc._id,
      ...doc.data,
      _createdAt: doc.createdAt,
      _updatedAt: doc.updatedAt,
    },
  });
}

export async function PATCH(request: Request, context: DocRouteContext) {
  const { workspaceId, appId, docId } = await context.params;

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
  const url = new URL(request.url);
  const sourceVersion = normalizeAppSourceVersion(url.searchParams.get("version"));
  if (sourceVersion === "draft" && !access.canCollaborate) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const dataAppId = appDataScopeId(appId, sourceVersion);

  const body = (await request.json()) as {
    collection: string;
    data: Record<string, unknown>;
  };

  if (!body.collection || !body.data) {
    return NextResponse.json(
      { error: "collection and data required" },
      { status: 400 },
    );
  }

  const previousDoc = await getAppDataDoc(
    workspaceContext.workspaceId,
    dataAppId,
    body.collection,
    docId,
  );

  const doc = await updateAppData(
    workspaceContext.workspaceId,
    dataAppId,
    body.collection,
    docId,
    body.data,
  );

  if (!doc) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app_data.document.updated",
    category: "app_data",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      kind: "app_iframe",
      trust: "client_untrusted",
      appId,
      appName: access.app.name,
      sourceVersion,
    }),
    target: {
      type: "app_data_document",
      id: doc._id,
      name: `${body.collection} / ${doc._id}`,
      parentType: "app",
      parentId: appId,
    },
    action: "updated",
    summary: `Updated document in ${body.collection}.`,
    metadata: {
      collection: body.collection,
      sourceVersion,
      dataScope: dataAppId === appId ? "published" : "draft",
    },
    changes: {
      changedFields: Object.keys(body.data),
      beforeHash: previousDoc ? auditSha256(previousDoc.data) : undefined,
      afterHash: auditSha256(doc.data),
    },
    relatedIds: {
      appId,
      appDataDocumentId: doc._id,
    },
  });

  return NextResponse.json({
    doc: {
      _id: doc._id,
      ...doc.data,
      _createdAt: doc.createdAt,
      _updatedAt: doc.updatedAt,
    },
  });
}

export async function DELETE(request: Request, context: DocRouteContext) {
  const { workspaceId, appId, docId } = await context.params;

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

  const url = new URL(request.url);
  const sourceVersion = normalizeAppSourceVersion(url.searchParams.get("version"));
  if (sourceVersion === "draft" && !access.canCollaborate) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const dataAppId = appDataScopeId(appId, sourceVersion);
  const collection = url.searchParams.get("collection");
  if (!collection) {
    return NextResponse.json(
      { error: "collection query param required" },
      { status: 400 },
    );
  }

  const previousDoc = await getAppDataDoc(
    workspaceContext.workspaceId,
    dataAppId,
    collection,
    docId,
  );
  const deleted = await deleteAppData(
    workspaceContext.workspaceId,
    dataAppId,
    collection,
    docId,
  );

  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app_data.document.deleted",
    category: "app_data",
    severity: "warning",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      kind: "app_iframe",
      trust: "client_untrusted",
      appId,
      appName: access.app.name,
      sourceVersion,
    }),
    target: {
      type: "app_data_document",
      id: docId,
      name: `${collection} / ${docId}`,
      parentType: "app",
      parentId: appId,
    },
    action: "deleted",
    summary: `Deleted document in ${collection}.`,
    metadata: {
      collection,
      sourceVersion,
      dataScope: dataAppId === appId ? "published" : "draft",
    },
    changes: {
      changedFields: Object.keys(previousDoc?.data ?? {}),
      beforeHash: previousDoc ? auditSha256(previousDoc.data) : undefined,
    },
    relatedIds: {
      appId,
      appDataDocumentId: docId,
    },
  });

  return NextResponse.json({ ok: true });
}
