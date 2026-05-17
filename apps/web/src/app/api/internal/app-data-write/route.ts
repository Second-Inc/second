import { NextResponse } from "next/server";
import { validateInternalToken } from "@/lib/auth/internal-auth";
import { recordAuditEvent } from "@/lib/audit/record";
import { auditSha256 } from "@/lib/audit/redaction";
import {
  agentsPayloadAllowsDataCollection,
  getDraftAgentsJsonApproval,
} from "@/lib/agents/agents-governance";
import {
  deleteAppData,
  findAppById,
  getAppDataDoc,
  getAppSourceFilesForVersion,
  insertAppData,
  updateAppData,
  upsertAppData,
} from "@/lib/db";
import {
  appDataScopeId,
  normalizeAppSourceVersion,
} from "@/lib/app-data-scope";

type AppDataWriteRequest = {
  workspaceId: string;
  appId: string;
  sourceVersion?: "draft" | "published";
  agentId?: string;
  collection: string;
  operation: "insert" | "update" | "upsert" | "delete";
  filter?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const authError = validateInternalToken(request);
  if (authError) return authError;

  const body = (await request.json()) as AppDataWriteRequest;
  const { workspaceId, appId, collection, operation, filter, data } = body;

  if (!workspaceId || !appId || !body.agentId || !collection || !operation) {
    return NextResponse.json(
      { error: "workspaceId, appId, agentId, collection, and operation are required" },
      { status: 400 },
    );
  }

  try {
    const sourceVersion = normalizeAppSourceVersion(body.sourceVersion);
    const app = await findAppById({ workspaceId, appId });
    if (!app) {
      return NextResponse.json(
        {
          success: false,
          error: "App was not found for approved agents.json enforcement",
        },
        { status: 403 },
      );
    }
    if (sourceVersion === "draft") {
      const sourceFiles = await getAppSourceFilesForVersion({
        workspaceId,
        appId,
        version: "draft",
      });
      const approval = getDraftAgentsJsonApproval({
        app,
        sourceFiles,
      });
      if (
        !approval?.approved ||
        !agentsPayloadAllowsDataCollection(
          app.agentsJsonApprovedPayload,
          collection,
          body.agentId,
        )
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Draft agents.json must approve this data collection",
          },
          { status: 403 },
        );
      }
    } else if (
      !app.publishedAgentsJsonApprovedPayload ||
      !agentsPayloadAllowsDataCollection(
        app.publishedAgentsJsonApprovedPayload,
        collection,
        body.agentId,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Collection is not part of the published approved agents.json",
        },
        { status: 403 },
      );
    }
    const dataAppId = appDataScopeId(
      appId,
      sourceVersion,
    );
    if (operation === "insert") {
      if (!data) {
        return NextResponse.json(
          { error: "data is required for insert" },
          { status: 400 },
        );
      }
      const doc = await insertAppData(workspaceId, dataAppId, collection, data);
      await recordAuditEvent({
        workspaceId,
        eventName: "app_data.document.inserted",
        category: "app_data",
        severity: "notice",
        outcome: "success",
        actor: {
          kind: "agent",
          agentId: body.agentId,
          agentName: body.agentId,
        },
        source: {
          kind: "app_agent",
          trust: "internal_trusted",
          appId,
          appName: app.name,
          sourceVersion,
        },
        target: {
          type: "app_data_document",
          id: doc._id,
          name: `${collection} / ${doc._id}`,
          parentType: "app",
          parentId: appId,
        },
        action: "inserted",
        summary: `App agent inserted document in ${collection}.`,
        metadata: {
          collection,
          operation,
          sourceVersion,
          dataScope: dataAppId === appId ? "published" : "draft",
        },
        changes: {
          changedFields: Object.keys(data),
          afterHash: auditSha256(data),
        },
        relatedIds: {
          appId,
          appDataDocumentId: doc._id,
        },
      });
      return NextResponse.json({
        success: true,
        doc: { _id: doc._id, ...doc.data },
      });
    }

    if (operation === "update") {
      if (!filter?._id || !data) {
        return NextResponse.json(
          { error: "filter._id and data are required for update" },
          { status: 400 },
        );
      }
      const previousDoc = await getAppDataDoc(
        workspaceId,
        dataAppId,
        collection,
        String(filter._id),
      );
      const doc = await updateAppData(
        workspaceId,
        dataAppId,
        collection,
        String(filter._id),
        data,
      );
      if (!doc) {
        return NextResponse.json(
          { success: false, error: "Document not found" },
          { status: 404 },
        );
      }
      await recordAuditEvent({
        workspaceId,
        eventName: "app_data.document.updated",
        category: "app_data",
        severity: "notice",
        outcome: "success",
        actor: {
          kind: "agent",
          agentId: body.agentId,
          agentName: body.agentId,
        },
        source: {
          kind: "app_agent",
          trust: "internal_trusted",
          appId,
          appName: app.name,
          sourceVersion,
        },
        target: {
          type: "app_data_document",
          id: doc._id,
          name: `${collection} / ${doc._id}`,
          parentType: "app",
          parentId: appId,
        },
        action: "updated",
        summary: `App agent updated document in ${collection}.`,
        metadata: {
          collection,
          operation,
          sourceVersion,
          dataScope: dataAppId === appId ? "published" : "draft",
        },
        changes: {
          changedFields: Object.keys(data),
          beforeHash: previousDoc ? auditSha256(previousDoc.data) : undefined,
          afterHash: auditSha256(doc.data),
        },
        relatedIds: {
          appId,
          appDataDocumentId: doc._id,
        },
      });
      return NextResponse.json({
        success: true,
        doc: { _id: doc._id, ...doc.data },
      });
    }

    if (operation === "upsert") {
      if (!filter || !data) {
        return NextResponse.json(
          { error: "filter and data are required for upsert" },
          { status: 400 },
        );
      }
      const doc = await upsertAppData(
        workspaceId,
        dataAppId,
        collection,
        filter,
        data,
      );
      await recordAuditEvent({
        workspaceId,
        eventName: "app_data.document.upserted",
        category: "app_data",
        severity: "notice",
        outcome: "success",
        actor: {
          kind: "agent",
          agentId: body.agentId,
          agentName: body.agentId,
        },
        source: {
          kind: "app_agent",
          trust: "internal_trusted",
          appId,
          appName: app.name,
          sourceVersion,
        },
        target: {
          type: "app_data_document",
          id: doc._id,
          name: `${collection} / ${doc._id}`,
          parentType: "app",
          parentId: appId,
        },
        action: "upserted",
        summary: `App agent upserted document in ${collection}.`,
        metadata: {
          collection,
          operation,
          sourceVersion,
          dataScope: dataAppId === appId ? "published" : "draft",
          filterKeys: Object.keys(filter),
        },
        changes: {
          changedFields: Object.keys(data),
          afterHash: auditSha256(doc.data),
        },
        relatedIds: {
          appId,
          appDataDocumentId: doc._id,
        },
      });
      return NextResponse.json({
        success: true,
        doc: { _id: doc._id, ...doc.data },
      });
    }

    if (operation === "delete") {
      if (!filter?._id) {
        return NextResponse.json(
          { error: "filter._id is required for delete" },
          { status: 400 },
        );
      }
      const previousDoc = await getAppDataDoc(
        workspaceId,
        dataAppId,
        collection,
        String(filter._id),
      );
      const deleted = await deleteAppData(
        workspaceId,
        dataAppId,
        collection,
        String(filter._id),
      );
      if (deleted) {
        await recordAuditEvent({
          workspaceId,
          eventName: "app_data.document.deleted",
          category: "app_data",
          severity: "warning",
          outcome: "success",
          actor: {
            kind: "agent",
            agentId: body.agentId,
            agentName: body.agentId,
          },
          source: {
            kind: "app_agent",
            trust: "internal_trusted",
            appId,
            appName: app.name,
            sourceVersion,
          },
          target: {
            type: "app_data_document",
            id: String(filter._id),
            name: `${collection} / ${String(filter._id)}`,
            parentType: "app",
            parentId: appId,
          },
          action: "deleted",
          summary: `App agent deleted document in ${collection}.`,
          metadata: {
            collection,
            operation,
            sourceVersion,
            dataScope: dataAppId === appId ? "published" : "draft",
          },
          changes: {
            changedFields: Object.keys(previousDoc?.data ?? {}),
            beforeHash: previousDoc ? auditSha256(previousDoc.data) : undefined,
          },
          relatedIds: {
            appId,
            appDataDocumentId: String(filter._id),
          },
        });
      }
      return NextResponse.json({ success: deleted });
    }

    return NextResponse.json(
      { error: `Unknown operation: ${operation}` },
      { status: 400 },
    );
  } catch (err) {
    console.error("[app-data-write] Error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal error",
      },
      { status: 500 },
    );
  }
}
