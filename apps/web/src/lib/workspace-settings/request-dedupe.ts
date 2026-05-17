import type { WorkspaceContext } from "@/lib/auth/guard";

type DedupeEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

const STORE_KEY = "__secondWorkspaceSettingsRequestDedupe";
const MAX_ENTRIES = 500;

type DedupeGlobal = typeof globalThis & {
  [STORE_KEY]?: Map<string, DedupeEntry<unknown>>;
};

function store(): Map<string, DedupeEntry<unknown>> {
  const globalStore = globalThis as DedupeGlobal;
  globalStore[STORE_KEY] ??= new Map();
  return globalStore[STORE_KEY];
}

function cleanupExpiredEntries(
  entries: Map<string, DedupeEntry<unknown>>,
  now: number,
) {
  if (entries.size <= MAX_ENTRIES) return;

  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }

  while (entries.size > MAX_ENTRIES) {
    const oldestKey = entries.keys().next().value as string | undefined;
    if (!oldestKey) return;
    entries.delete(oldestKey);
  }
}

export function workspaceSettingsDedupeKey(
  scope: string,
  workspaceContext: WorkspaceContext,
): string {
  const membershipVersion =
    workspaceContext.membership.updatedAt?.getTime() ??
    workspaceContext.membership.createdAt.getTime();

  return [
    scope,
    workspaceContext.workspaceId,
    workspaceContext.user._id,
    workspaceContext.membership.role,
    membershipVersion,
  ].join(":");
}

export function dedupeWorkspaceSettingsRequest<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const entries = store();
  const now = Date.now();
  cleanupExpiredEntries(entries, now);

  const existing = entries.get(key) as DedupeEntry<T> | undefined;
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  const promise = load().catch((error) => {
    if (entries.get(key)?.promise === promise) {
      entries.delete(key);
    }
    throw error;
  });
  entries.set(key, {
    expiresAt: now + ttlMs,
    promise,
  });

  return promise;
}
