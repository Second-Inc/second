import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  getAgentRunsCollection,
  getAppAgentRunsCollection,
} from "@/lib/db/collections";
import { getRedisClient } from "@/lib/redis";
import { workspaceEventsChannel } from "@/lib/events/workspace-events";
import { createPerfTrace } from "@/lib/perf/trace";

type WorkspaceEventsRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: WorkspaceEventsRouteContext,
) {
  const { workspaceId } = await context.params;
  const trace = createPerfTrace({
    route: "GET /api/workspaces/[workspaceId]/events",
    workspaceId,
  });
  trace.log("workspace.events.request_start");

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

  const channel = workspaceEventsChannel(workspaceContext.workspaceId);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const subscriber = getRedisClient().duplicate();
      let closed = false;
      const streamStartedAt = Date.now();

      function enqueueSse(payload: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          void close("enqueue_failed");
        }
      }

      async function close(reason: string) {
        if (closed) return;
        closed = true;
        trace.log("workspace.events.close", {
          reason,
          streamMs: Date.now() - streamStartedAt,
        });
        clearInterval(heartbeat);
        subscriber.removeAllListeners();
        await subscriber.unsubscribe(channel).catch(() => {});
        await subscriber.quit().catch(() => {});
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }

      const heartbeat = setInterval(() => {
        enqueueSse(": heartbeat\n\n");
      }, 30_000);

      request.signal.addEventListener("abort", () => {
        void close("client_abort");
      });

      subscriber.on("message", (_channel, message) => {
        enqueueSse(`data: ${message}\n\n`);
      });
      subscriber.on("error", () => {
        void close("redis_error");
      });

      try {
        await subscriber.subscribe(channel);
        trace.log("workspace.events.subscribed");
        const [activeRuns, activeAppAgentRuns] = await Promise.all([
          getAgentRunsCollection()
            .then((collection) =>
              collection
                .find(
                  {
                    workspaceId: workspaceContext.workspaceId,
                    status: "streaming",
                  },
                  {
                    projection: {
                      _id: 1,
                      appId: 1,
                      activeStreamId: 1,
                      sourceVersion: 1,
                      status: 1,
                    },
                    limit: 100,
                  },
                )
                .toArray(),
            )
            .catch(() => []),
          getAppAgentRunsCollection()
            .then((collection) =>
              collection
                .find(
                  {
                    workspaceId: workspaceContext.workspaceId,
                    status: { $in: ["pending", "running", "streaming"] },
                  },
                  {
                    projection: {
                      _id: 1,
                      appId: 1,
                      activeStreamId: 1,
                      sourceVersion: 1,
                      status: 1,
                    },
                    limit: 100,
                  },
                )
                .toArray(),
            )
            .catch(() => []),
        ]);
        trace.log("workspace.events.active_run_sync", {
          activeRunCount: activeRuns.length,
          activeAppAgentRunCount: activeAppAgentRuns.length,
        });
        for (const run of activeRuns) {
          enqueueSse(
            `data: ${JSON.stringify({
              version: 1,
              type: run.activeStreamId ? "run.stream_ready" : "run.starting",
              workspaceId: workspaceContext.workspaceId,
              scope: "agent-runs",
              appId: run.appId,
              runId: run._id,
              runStatus: "streaming",
              at: new Date().toISOString(),
            })}\n\n`,
          );
        }
        for (const run of activeAppAgentRuns) {
          enqueueSse(
            `data: ${JSON.stringify({
              version: 1,
              type: run.activeStreamId ? "run.stream_ready" : "run.starting",
              workspaceId: workspaceContext.workspaceId,
              scope: "agent-runs",
              appId: run.appId,
              runId: run._id,
              sourceVersion: run.sourceVersion ?? "published",
              runStatus: run.status,
              at: new Date().toISOString(),
            })}\n\n`,
          );
        }
      } catch {
        await close("subscribe_failed");
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
