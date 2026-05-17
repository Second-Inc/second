import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import { workspaceEventsChannel, type WorkspaceEvent } from "@/lib/events/workspace-events";
import { getRedisClient } from "@/lib/redis";

type StreamRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: StreamRouteContext) {
  const { workspaceId } = await context.params;

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

  const channel = workspaceEventsChannel(workspaceContext.workspaceId);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const subscriber = getRedisClient().duplicate();
      let closed = false;

      function enqueueSse(payload: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      }

      async function close() {
        if (closed) return;
        closed = true;
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
        void close();
      });

      subscriber.on("message", (_channel, message) => {
        let event: WorkspaceEvent | null = null;
        try {
          event = JSON.parse(message) as WorkspaceEvent;
        } catch {
          return;
        }
        if (event.scope !== "integrations") return;
        enqueueSse(
          `data: ${JSON.stringify({
            type: "changed",
            operation: "update",
            appId: event.appId,
          })}\n\n`,
        );
      });
      subscriber.on("error", () => {
        void close();
      });

      try {
        await subscriber.subscribe(channel);
      } catch {
        await close();
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
