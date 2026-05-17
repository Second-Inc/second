import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import {
  appDataScopeId,
  normalizeAppSourceVersion,
} from "@/lib/app-data-scope";
import { getAppDataCollection } from "@/lib/db/collections";
import { createPerfTrace } from "@/lib/perf/trace";
import { NextResponse } from "next/server";

type StreamRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: StreamRouteContext) {
  const { workspaceId, appId } = await context.params;
  const trace = createPerfTrace({
    route: "GET /api/workspaces/[workspaceId]/apps/[appId]/data/stream",
    workspaceId,
    appId,
  });
  trace.log("app_data.stream.request_start");

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await trace.time("auth.workspace", () =>
      requireWorkspaceContext({
        headers: request.headers,
        pathname: new URL(request.url).pathname,
        workspaceId,
      }),
    );
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const access = await trace.time("auth.app_access", () =>
    resolveAppAccess({ workspaceContext, appId }),
  );
  if (!access) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const sourceVersion = normalizeAppSourceVersion(url.searchParams.get("version"));
  if (sourceVersion === "draft" && !access.canCollaborate) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const dataAppId = appDataScopeId(appId, sourceVersion);
  trace.log("app_data.stream.authorized", { sourceVersion });

  const resolvedWorkspaceId = workspaceContext.workspaceId;
  const collection = await getAppDataCollection();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const streamStartedAt = Date.now();
      let closeLogged = false;

      function logClose(reason: string) {
        if (closeLogged) return;
        closeLogged = true;
        trace.log("app_data.stream.close", {
          reason,
          streamMs: Date.now() - streamStartedAt,
          sourceVersion,
        });
      }

      function send(data: unknown) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Controller closed
        }
      }

      // Send a heartbeat to keep the connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // Open a Change Stream filtered to this app's data
      const pipeline = [
        {
          $match: {
            $or: [
              {
                operationType: { $in: ["insert", "update"] },
                "fullDocument.workspaceId": resolvedWorkspaceId,
                "fullDocument.appId": dataAppId,
              },
              {
                operationType: "delete",
              },
            ],
          },
        },
      ];

      let changeStream: ReturnType<typeof collection.watch> | null = null;

      try {
        const scopedDocCollections = new Map<string, string>();
        const existingDocs = await collection
          .find(
            { workspaceId: resolvedWorkspaceId, appId: dataAppId },
            { projection: { _id: 1, collection: 1 } },
          )
          .toArray();
        trace.log("app_data.stream.watch_prepare", {
          sourceVersion,
          existingDocCount: existingDocs.length,
        });

        for (const doc of existingDocs) {
          scopedDocCollections.set(String(doc._id), doc.collection);
        }

        changeStream = collection.watch(pipeline, {
          fullDocument: "updateLookup",
        });
        trace.log("app_data.stream.watch_ready", { sourceVersion });

        changeStream.on("change", (change) => {
          // Filter by workspaceId + appId for update/delete events
          // (insert events are already filtered by the pipeline)
          if (change.operationType === "insert") {
            const doc = change.fullDocument;
            if (
              doc?.workspaceId !== resolvedWorkspaceId ||
              doc?.appId !== dataAppId
            )
              return;
            scopedDocCollections.set(String(doc._id), doc.collection);
            trace.log("app_data.stream.change", {
              operation: "insert",
              collection: doc.collection,
              docId: String(doc._id),
              sourceVersion,
            });
            send({
              type: "insert",
              collection: doc.collection,
              doc: {
                _id: doc._id,
                ...((doc.data as Record<string, unknown>) ?? {}),
                _createdAt: doc.createdAt,
                _updatedAt: doc.updatedAt,
              },
            });
          } else if (change.operationType === "update") {
            const doc = change.fullDocument;
            if (!doc) return;
            if (
              doc.workspaceId !== resolvedWorkspaceId ||
              doc.appId !== dataAppId
            )
              return;
            scopedDocCollections.set(String(doc._id), doc.collection);
            trace.log("app_data.stream.change", {
              operation: "update",
              collection: doc.collection,
              docId: String(doc._id),
              sourceVersion,
            });
            send({
              type: "update",
              collection: doc.collection,
              docId: doc._id,
              doc: {
                _id: doc._id,
                ...((doc.data as Record<string, unknown>) ?? {}),
                _createdAt: doc.createdAt,
                _updatedAt: doc.updatedAt,
              },
            });
          } else if (change.operationType === "delete") {
            const docId = String(
              (change.documentKey as { _id: string })._id,
            );
            const collectionName = scopedDocCollections.get(docId);
            if (!collectionName) return;
            scopedDocCollections.delete(docId);
            trace.log("app_data.stream.change", {
              operation: "delete",
              collection: collectionName,
              docId,
              sourceVersion,
            });
            send({
              type: "delete",
              collection: collectionName,
              docId,
            });
          }
        });

        changeStream.on("error", () => {
          trace.log("app_data.stream.error", { sourceVersion });
          logClose("change_stream_error");
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch { /* already closed */ }
        });

        // Handle client disconnect
        request.signal.addEventListener("abort", () => {
          logClose("client_abort");
          clearInterval(heartbeat);
          changeStream?.close().catch(() => {});
          try {
            controller.close();
          } catch { /* already closed */ }
        });
      } catch (error) {
        trace.log("app_data.stream.start_failed", {
          sourceVersion,
          error: error instanceof Error ? error.name || "Error" : "UnknownError",
        });
        logClose("start_failed");
        clearInterval(heartbeat);
        changeStream?.close().catch(() => {});
        try {
          controller.close();
        } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
