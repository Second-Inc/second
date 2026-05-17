import type { UserDocument, WorkspaceMembershipDocument } from "@/lib/db";

type PostHogPayload = {
  api_key: string;
  event: string;
  distinct_id: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
};

type PostHogConfig = {
  posthogToken: string;
  posthogHost: string;
};

type PostHogSendContext = {
  event: string;
  anonymized?: boolean;
};

type PostHogIdentityInput = {
  config: PostHogConfig;
  user: UserDocument;
  membership: WorkspaceMembershipDocument | null | undefined;
};

const IDENTIFY_CACHE_TTL_MS = 30 * 60 * 1000;

const identifyCache = new Map<string, number>();

export function readPostHogEndpoint(host: string): string {
  return new URL("/i/v0/e/", host).toString();
}

function postHogIdentityCacheKey(input: PostHogIdentityInput): string {
  return [
    input.user._id,
    input.user.email,
    input.user.displayName,
    input.membership?.workspaceId ?? "",
    input.membership?.role ?? "",
  ].join(":");
}

function buildPersonProperties(input: PostHogIdentityInput) {
  return {
    email: input.user.email,
    name: input.user.displayName,
    user_id: input.user._id,
    workspace_id: input.membership?.workspaceId,
    workspace_role: input.membership?.role,
    second_oss: true,
  };
}

export async function sendPostHogPayload(
  config: PostHogConfig,
  payload: PostHogPayload,
  context: PostHogSendContext,
): Promise<boolean> {
  const response = await fetch(readPostHogEndpoint(config.posthogHost), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) {
    const responseText = response ? await response.text().catch(() => "") : "";
    console.warn("[analytics] PostHog capture failed", {
      event: context.event,
      anonymized: context.anonymized ?? null,
      status: response?.status ?? null,
      body: responseText.slice(0, 500),
    });
    return false;
  }

  return true;
}

export async function ensurePostHogIdentity(
  input: PostHogIdentityInput,
): Promise<boolean> {
  if (!input.config.posthogToken) return false;

  const cacheKey = postHogIdentityCacheKey(input);
  const now = Date.now();
  const cachedAt = identifyCache.get(cacheKey);
  if (cachedAt && now - cachedAt < IDENTIFY_CACHE_TTL_MS) {
    return true;
  }

  const identified = await sendPostHogPayload(
    input.config,
    {
      api_key: input.config.posthogToken,
      event: "$identify",
      distinct_id: input.user._id,
      properties: {
        $set: buildPersonProperties(input),
      },
    },
    { event: "$identify", anonymized: false },
  );

  if (identified) identifyCache.set(cacheKey, now);
  return identified;
}
