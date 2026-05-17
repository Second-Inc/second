import { randomBytes } from "node:crypto";
import { getRedisClient } from "@/lib/redis";

const LOCK_TTL_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withOAuthRefreshLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
  onWait: () => Promise<T | null>,
): Promise<T> {
  const redis = getRedisClient();
  const value = randomBytes(12).toString("base64url");
  const key = `oauth:refresh:${lockKey}`;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const acquired = await redis.set(key, value, "PX", LOCK_TTL_MS, "NX");
    if (acquired === "OK") {
      try {
        return await fn();
      } finally {
        const current = await redis.get(key).catch(() => null);
        if (current === value) {
          await redis.del(key).catch(() => undefined);
        }
      }
    }

    await sleep(250);
    const waited = await onWait();
    if (waited !== null) return waited;
  }

  throw new Error("oauth_refresh_lock_timeout");
}
