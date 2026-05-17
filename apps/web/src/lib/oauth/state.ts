import { createHash, randomBytes } from "node:crypto";
import { getRedisClient } from "@/lib/redis";

const STATE_TTL_SECONDS = 10 * 60;

export type OAuthStatePayload = {
  workspaceId: string;
  userId: string;
  providerConfigId: string;
  integrationId: string;
  requestedScopes: string[];
  returnTo: string;
  codeVerifier: string;
  createdAt: string;
};

function stateKey(state: string): string {
  return `oauth:state:${state}`;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function createPkcePair(): {
  codeVerifier: string;
  codeChallenge: string;
} {
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  return { codeVerifier, codeChallenge };
}

export async function createOAuthState(
  payload: Omit<OAuthStatePayload, "createdAt">,
): Promise<string> {
  const state = base64Url(randomBytes(32));
  await getRedisClient().set(
    stateKey(state),
    JSON.stringify({ ...payload, createdAt: new Date().toISOString() }),
    "EX",
    STATE_TTL_SECONDS,
  );
  return state;
}

export async function consumeOAuthState(
  state: string,
): Promise<OAuthStatePayload | null> {
  const key = stateKey(state);
  const redis = getRedisClient();
  const raw = await redis.get(key);
  if (!raw) return null;
  await redis.del(key).catch(() => undefined);

  try {
    const parsed = JSON.parse(raw) as OAuthStatePayload;
    if (
      !parsed.workspaceId ||
      !parsed.userId ||
      !parsed.providerConfigId ||
      !parsed.integrationId ||
      !Array.isArray(parsed.requestedScopes) ||
      !parsed.codeVerifier
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value?.trim()) return "/";
  try {
    const parsed = new URL(value, "https://second.local");
    if (parsed.origin !== "https://second.local") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}
