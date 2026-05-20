import type Redis from "ioredis";
import { getRedisClient } from "@/lib/redis";

const RUN_REPLAY_TTL_SECONDS = 60 * 60;
const RUN_REPLAY_MAX_CHUNKS = 5000;

type RunReplayRecord = {
  seq: number;
  chunk: string;
  at: string;
};

type RunReplayLiveMessage =
  | {
      type: "chunk";
      seq: number;
      chunk: string;
    }
  | {
      type: "terminal";
      status: "completed" | "failed";
    };

function chunksKey(runId: string): string {
  return `run:${runId}:replay:chunks`;
}

function seqKey(runId: string): string {
  return `run:${runId}:replay:seq`;
}

function terminalKey(runId: string): string {
  return `run:${runId}:replay:terminal`;
}

function liveChannel(runId: string): string {
  return `run:${runId}:replay:live`;
}

async function refreshReplayTtl(redis: Redis, runId: string): Promise<void> {
  await Promise.all([
    redis.expire(chunksKey(runId), RUN_REPLAY_TTL_SECONDS),
    redis.expire(seqKey(runId), RUN_REPLAY_TTL_SECONDS),
    redis.expire(terminalKey(runId), RUN_REPLAY_TTL_SECONDS),
  ]);
}

export async function resetRunReplayBuffer(runId: string): Promise<void> {
  const redis = getRedisClient();
  await Promise.all([
    redis.del(chunksKey(runId)),
    redis.del(seqKey(runId)),
    redis.del(terminalKey(runId)),
  ]);
}

export async function appendRunReplayChunk(input: {
  runId: string;
  chunk: string;
}): Promise<void> {
  if (!input.chunk) return;

  const redis = getRedisClient();
  const seq = await redis.incr(seqKey(input.runId));
  const record: RunReplayRecord = {
    seq,
    chunk: input.chunk,
    at: new Date().toISOString(),
  };
  const live: RunReplayLiveMessage = {
    type: "chunk",
    seq,
    chunk: input.chunk,
  };

  await Promise.all([
    redis.rpush(chunksKey(input.runId), JSON.stringify(record)),
    redis.ltrim(chunksKey(input.runId), -RUN_REPLAY_MAX_CHUNKS, -1),
    redis.publish(liveChannel(input.runId), JSON.stringify(live)),
    refreshReplayTtl(redis, input.runId),
  ]);
}

export async function markRunReplayTerminal(input: {
  runId: string;
  status: "completed" | "failed";
}): Promise<void> {
  const redis = getRedisClient();
  const live: RunReplayLiveMessage = {
    type: "terminal",
    status: input.status,
  };
  await Promise.all([
    redis.set(
      terminalKey(input.runId),
      JSON.stringify({
        status: input.status,
        at: new Date().toISOString(),
      }),
      "EX",
      RUN_REPLAY_TTL_SECONDS,
    ),
    redis.publish(liveChannel(input.runId), JSON.stringify(live)),
    refreshReplayTtl(redis, input.runId),
  ]);
}

export function captureRunReplayStream(input: {
  runId: string;
  stream: ReadableStream<string>;
  onChunk?: () => void;
}): ReadableStream<string> {
  return input.stream.pipeThrough(
    new TransformStream<string, string>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        appendRunReplayChunk({ runId: input.runId, chunk }).catch(() => {});
        input.onChunk?.();
      },
      flush() {
        // Terminal state is published by the route once final messages are
        // persisted. The replay buffer only records raw UI stream chunks here.
      },
    }),
  );
}

export async function hasRunReplayChunks(runId: string): Promise<boolean> {
  return (await getRedisClient().llen(chunksKey(runId))) > 0;
}

export async function hasCompleteRunReplay(runId: string): Promise<boolean> {
  const first = await getRedisClient().lindex(chunksKey(runId), 0);
  if (!first) return false;
  try {
    const record = JSON.parse(first) as Partial<RunReplayRecord>;
    return record.seq === 1;
  } catch {
    return false;
  }
}

export function createRunReplayResponseStream(input: {
  runId: string;
  cursor?: number;
  signal?: AbortSignal;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const fromSeq = Math.max(0, input.cursor ?? 0);
  const subscriber = getRedisClient().duplicate();
  let lastSeq = fromSeq;
  let closed = false;
  let replayingHistory = true;
  const pendingLiveMessages: RunReplayLiveMessage[] = [];

  const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) return;
    closed = true;
    subscriber.unsubscribe(liveChannel(input.runId)).catch(() => {});
    subscriber.quit().catch(() => {});
    try {
      controller.close();
    } catch {
      // already closed
    }
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const channel = liveChannel(input.runId);

      const enqueueChunk = (seq: number, chunk: string) => {
        if (seq <= lastSeq || closed) return;
        lastSeq = seq;
        controller.enqueue(encoder.encode(chunk));
      };

      subscriber.on("message", (_channel, raw) => {
        let message: RunReplayLiveMessage | null = null;
        try {
          message = JSON.parse(raw) as RunReplayLiveMessage;
        } catch {
          return;
        }

        if (replayingHistory) {
          pendingLiveMessages.push(message);
          return;
        }

        if (message.type === "chunk") {
          enqueueChunk(message.seq, message.chunk);
          return;
        }
        close(controller);
      });

      subscriber.on("error", () => close(controller));
      input.signal?.addEventListener("abort", () => close(controller), {
        once: true,
      });

      await subscriber.subscribe(channel);

      const redis = getRedisClient();
      const records = await redis.lrange(chunksKey(input.runId), 0, -1);
      for (const raw of records) {
        let record: RunReplayRecord | null = null;
        try {
          record = JSON.parse(raw) as RunReplayRecord;
        } catch {
          continue;
        }
        enqueueChunk(record.seq, record.chunk);
      }

      replayingHistory = false;
      for (const message of pendingLiveMessages.sort((a, b) => {
        if (a.type === "terminal" && b.type === "terminal") return 0;
        if (a.type === "terminal") return 1;
        if (b.type === "terminal") return -1;
        return a.seq - b.seq;
      })) {
        if (message.type === "chunk") {
          enqueueChunk(message.seq, message.chunk);
          continue;
        }
        close(controller);
        return;
      }
      pendingLiveMessages.length = 0;

      const terminal = await redis.get(terminalKey(input.runId));
      if (terminal) {
        close(controller);
      }
    },
    cancel() {
      closed = true;
      subscriber.unsubscribe(liveChannel(input.runId)).catch(() => {});
      subscriber.quit().catch(() => {});
    },
  });
}
