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
import {
  insertAppData,
  listAppData,
  listAppDataForApp,
} from "@/lib/db";
import {
  appDataScopeId,
  normalizeAppSourceVersion,
} from "@/lib/app-data-scope";
import type { AppDataDocument } from "@/lib/db/types";

type DataRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

function serializeAppDataDoc(doc: AppDataDocument) {
  return {
    _id: doc._id,
    ...doc.data,
    _createdAt: doc.createdAt,
    _updatedAt: doc.updatedAt,
  };
}

export async function GET(request: Request, context: DataRouteContext) {
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

  const url = new URL(request.url);
  const sourceVersion = normalizeAppSourceVersion(url.searchParams.get("version"));
  if (sourceVersion === "draft" && !access.canCollaborate) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const dataAppId = appDataScopeId(appId, sourceVersion);
  const collection = url.searchParams.get("collection");
  if (!collection) {
    const docs = await listAppDataForApp(
      workspaceContext.workspaceId,
      dataAppId,
    );
    const collections = new Map<string, AppDataDocument[]>();

    for (const doc of docs) {
      const existing = collections.get(doc.collection);
      if (existing) {
        existing.push(doc);
      } else {
        collections.set(doc.collection, [doc]);
      }
    }

    return NextResponse.json({
      collections: Array.from(collections.entries()).map(([name, docs]) => ({
        name,
        count: docs.length,
        docs: docs.map(serializeAppDataDoc),
      })),
    });
  }

  const docs = await listAppData(
    workspaceContext.workspaceId,
    dataAppId,
    collection,
  );

  return NextResponse.json({
    docs: docs.map(serializeAppDataDoc),
  });
}

export async function POST(request: Request, context: DataRouteContext) {
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

  const doc = await insertAppData(
    workspaceContext.workspaceId,
    dataAppId,
    body.collection,
    body.data,
  );

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app_data.document.inserted",
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
    action: "inserted",
    summary: `Inserted document in ${body.collection}.`,
    metadata: {
      collection: body.collection,
      sourceVersion,
      dataScope: dataAppId === appId ? "published" : "draft",
    },
    changes: {
      changedFields: Object.keys(body.data),
      afterHash: auditSha256(body.data),
    },
    relatedIds: {
      appId,
      appDataDocumentId: doc._id,
    },
  });

  return NextResponse.json(
    {
      doc: serializeAppDataDoc(doc),
    },
    { status: 201 },
  );
}
