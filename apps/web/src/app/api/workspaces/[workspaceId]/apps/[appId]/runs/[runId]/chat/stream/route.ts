import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import { loadRunStreamStateForApp } from "@/lib/db";
import { getRedisClient, runEventsChannel } from "@/lib/redis";
import {
  createRunReplayResponseStream,
  hasCompleteRunReplay,
} from "@/lib/streams/run-replay";
import { createPerfTrace } from "@/lib/perf/trace";
import { reportServerError } from "@/lib/server-error-reporting";

type StreamRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
    runId: string;
  }>;
};

const STREAM_READY_WAIT_MS = 1500;

type RunStreamState = Awaited<ReturnType<typeof loadRunStreamStateForApp>>;

async function waitForAttachableStream(input: {
  runId: string;
  workspaceId: string;
  appId: string;
  initialState: NonNullable<RunStreamState>;
}): Promise<RunStreamState> {
  if (input.initialState.status !== "streaming" || input.initialState.activeStreamId) {
    return input.initialState;
  }

  const redis = getRedisClient();
  const subscriber = redis.duplicate();
  const channel = runEventsChannel(input.runId);

  return new Promise<RunStreamState>((resolve) => {
    let settled = false;

    const finish = async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscriber.removeAllListeners();
      await subscriber.unsubscribe(channel).catch(() => {});
      await subscriber.quit().catch(() => {});
      resolve(
        await loadRunStreamStateForApp(
          input.runId,
          input.workspaceId,
          input.appId,
        ),
      );
    };

    const fallbackToPoll = async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscriber.removeAllListeners();
      await subscriber.unsubscribe(channel).catch(() => {});
      await subscriber.quit().catch(() => {});
      resolve(await pollForAttachableStream(input));
    };

    const timeout = setTimeout(() => {
      void finish();
    }, STREAM_READY_WAIT_MS);

    subscriber.on("message", (_channel, message) => {
      let event: { type?: string } | null = null;
      try {
        event = JSON.parse(message) as { type?: string };
      } catch {
        return;
      }

      if (
        event.type === "stream_started" ||
        event.type === "completed" ||
        event.type === "failed"
      ) {
        void finish();
      }
    });
    subscriber.on("error", () => {
      void fallbackToPoll();
    });

    subscriber
      .subscribe(channel)
      .then(() => finishIfReady(input))
      .catch(() => fallbackToPoll())
      .then((ready) => {
        if (ready) void finish();
      });
  });
}

async function finishIfReady(input: {
  runId: string;
  workspaceId: string;
  appId: string;
}): Promise<boolean> {
  const state = await loadRunStreamStateForApp(
    input.runId,
    input.workspaceId,
    input.appId,
  );
  if (!state) return true;
  if (state.status !== "streaming") return true;
  return Boolean(state.activeStreamId);
}

async function pollForAttachableStream(input: {
  runId: string;
  workspaceId: string;
  appId: string;
  initialState: NonNullable<RunStreamState>;
}): Promise<RunStreamState> {
  const deadline = Date.now() + STREAM_READY_WAIT_MS;
  let state: RunStreamState = input.initialState;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    state = await loadRunStreamStateForApp(
      input.runId,
      input.workspaceId,
      input.appId,
    );

    if (!state) return null;
    if (state.status !== "streaming" || state.activeStreamId) {
      return state;
    }
  }

  return state;
}

export async function GET(request: Request, context: StreamRouteContext) {
  const { workspaceId, appId, runId } = await context.params;
  const url = new URL(request.url);
  const cursor = Number(url.searchParams.get("cursor") ?? "0");
  const trace = createPerfTrace({
    route:
      "GET /api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/stream",
    workspaceId,
    appId,
    runId,
  });
  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;

  try {
    workspaceContext = await trace.time("auth.workspace", () =>
      requireWorkspaceContext({
        headers: request.headers,
        pathname: url.pathname,
        workspaceId,
      }),
    );
  } catch (error) {
    if (isRequestGuardError(error)) {
      return guardErrorToApiResponse(error);
    }
    throw error;
  }

  const access = await trace.time("auth.app_access", () =>
    resolveAppAccess({ workspaceContext, appId }),
  );
  if (!access) {
    return new Response(null, { status: 404 });
  }
  if (!access.canCollaborate) {
    return new Response(null, { status: 404 });
  }

  const run = await trace.time("run.stream_state.initial", () =>
    loadRunStreamStateForApp(
      runId,
      workspaceContext.workspaceId,
      appId,
    ),
  );
  if (!run) {
    return new Response(null, { status: 404 });
  }

  const streamState = await trace.time("run.stream_attach.wait_ready", () =>
    waitForAttachableStream({
      runId,
      workspaceId: workspaceContext.workspaceId,
      appId,
      initialState: run,
    }),
    { initialStatus: run.status, hadActiveStream: Boolean(run.activeStreamId) },
  );

  const activeStreamId =
    streamState?.status === "streaming" ? streamState.activeStreamId : null;
  if (!activeStreamId) {
    trace.log("run.stream_attach.no_active_stream", {
      status: streamState?.status ?? null,
    });
    return new Response(null, { status: 204 });
  }

  const redis = getRedisClient();
  const resumableStreamContext = createResumableStreamContext({
    waitUntil: after,
    subscriber: redis.duplicate(),
    publisher: redis.duplicate(),
  });

  let resumedStream: ReadableStream<string> | null;
  try {
    resumedStream =
      (await trace.time("run.stream_attach.resumable_resume", () =>
        resumableStreamContext.resumeExistingStream(activeStreamId),
      )) ?? null;
  } catch (error) {
    reportServerError({
      source: "agent_chat_stream_attach",
      error,
      route:
        "GET /api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/stream",
      level: "warning",
      context: {
        workspaceId: workspaceContext.workspaceId,
        appId,
        runId,
        streamId: activeStreamId,
      },
    });
    trace.log("run.stream_attach.resumable_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    resumedStream = null;
  }

  if (!resumedStream) {
    const hasReplay = await hasCompleteRunReplay(runId).catch(() => false);
    if (!hasReplay) {
      trace.log("run.stream_attach.no_replay_after_resumable_miss", { cursor });
      return new Response(null, { status: 204 });
    }
    trace.log("run.stream_attach.replay_after_resumable_miss", { cursor });
    return new Response(
      createRunReplayResponseStream({
        runId,
        cursor: Number.isFinite(cursor) ? cursor : 0,
        signal: request.signal,
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "x-vercel-ai-ui-message-stream": "v1",
          "x-second-stream-replay": "1",
        },
      },
    );
  }

  trace.log("run.stream_attach.resumable", { cursor });
  return new Response(resumedStream.pipeThrough(new TextEncoderStream()), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}
