import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  }
  return redis;
}

/** Redis pub/sub channel for run-level sync events (multi-tab). */
export function runEventsChannel(runId: string): string {
  return `run:${runId}:events`;
}

/** Redis pub/sub channel for app agent run events. */
export function agentRunEventsChannel(runId: string): string {
  return `agent-run:${runId}:events`;
}
