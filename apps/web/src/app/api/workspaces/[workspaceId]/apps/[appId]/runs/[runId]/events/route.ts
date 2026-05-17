import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import { loadRunForApp } from "@/lib/db";
import { getRedisClient, runEventsChannel } from "@/lib/redis";

type EventsRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
    runId: string;
  }>;
};

/**
 * SSE endpoint that pushes real-time notifications when a run changes.
 * Uses Redis pub/sub so no replica set is required.
 *
 * Events:
 *   stream_started  — a new agent stream began (another tab sent a message)
 *   completed       — the run finished
 *   failed          — the run errored
 *
 * Clients use these to sync across tabs: fetch latest messages, then
 * reconnect to the live stream via the existing resume mechanism.
 */
export async function GET(request: Request, context: EventsRouteContext) {
  const { workspaceId, appId, runId } = await context.params;
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
    return new Response(null, { status: 404 });
  }
  if (!access.canCollaborate) {
    return new Response(null, { status: 404 });
  }

  const run = await loadRunForApp(runId, workspaceContext.workspaceId, appId);
  if (!run) {
    return new Response(null, { status: 404 });
  }

  // Dedicated subscriber connection (Redis requires separate connections
  // for pub/sub subscribers vs regular commands).
  const subscriber = getRedisClient().duplicate();
  const channel = runEventsChannel(runId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Initial keepalive so the client knows the connection is live
      controller.enqueue(encoder.encode(": ok\n\n"));

      await subscriber.subscribe(channel);

      // Re-read after subscribing so a stream_started publish cannot be lost
      // in the gap between the authorization read above and the Redis
      // subscription becoming active.
      try {
        const latestRun = await loadRunForApp(
          runId,
          workspaceContext.workspaceId,
          appId,
        );
        if (latestRun?.status === "streaming" && latestRun.activeStreamId) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "status_sync", status: "streaming" })}\n\n`,
            ),
          );
        }
      } catch {
        // EventSource will keep the socket open; future pub/sub messages can
        // still sync the tab if this best-effort read fails.
      }

      subscriber.on("message", (_ch: string, message: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${message}\n\n`));
        } catch {
          // Stream already closed
        }
      });

      // Clean up when client disconnects
      request.signal.addEventListener("abort", () => {
        subscriber.unsubscribe(channel).catch(() => {});
        subscriber.disconnect();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },

    cancel() {
      subscriber.unsubscribe(channel).catch(() => {});
      subscriber.disconnect();
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
