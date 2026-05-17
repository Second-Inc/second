import { ObjectId } from "mongodb";
import { getConnectedAccountsCollection } from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import type {
  ConnectedAccountDocument,
  ConnectedAccountSource,
} from "@/lib/db/types";

function uniqueScopes(scopes: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const scope of scopes) {
    const clean = scope.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

export function scopesIncludeAll(input: {
  grantedScopes: string[];
  requiredScopes: string[];
}): boolean {
  const granted = new Set(
    input.grantedScopes.map((scope) => scope.trim().toLowerCase()),
  );
  return input.requiredScopes.every((scope) =>
    granted.has(scope.trim().toLowerCase()),
  );
}

export function missingOAuthScopes(input: {
  grantedScopes: string[];
  requiredScopes: string[];
}): string[] {
  const granted = new Set(
    input.grantedScopes.map((scope) => scope.trim().toLowerCase()),
  );
  return input.requiredScopes.filter(
    (scope) => !granted.has(scope.trim().toLowerCase()),
  );
}

export async function findConnectedAccountForUserProvider(input: {
  workspaceId: string;
  userId: string;
  providerConfigId: string;
}): Promise<ConnectedAccountDocument | null> {
  const collection = await getConnectedAccountsCollection();
  return collection.findOne({
    workspaceId: input.workspaceId,
    userId: input.userId,
    providerConfigId: input.providerConfigId,
  });
}

export async function listConnectedAccountsForUser(input: {
  workspaceId: string;
  userId: string;
}): Promise<ConnectedAccountDocument[]> {
  const collection = await getConnectedAccountsCollection();
  return collection
    .find({ workspaceId: input.workspaceId, userId: input.userId })
    .sort({ updatedAt: -1 })
    .toArray();
}

export async function upsertConnectedAccount(input: {
  workspaceId: string;
  userId: string;
  providerConfigId: string;
  providerKey: string;
  source?: ConnectedAccountSource;
  externalSubject?: string | null;
  accountEmail?: string | null;
  accountName?: string | null;
  grantedScopes: string[];
  refreshTokenRef?: string | null;
  accessTokenRef?: string | null;
  accessTokenExpiresAt?: Date | null;
  tokenType?: string | null;
}): Promise<ConnectedAccountDocument> {
  const collection = await getConnectedAccountsCollection();
  const now = new Date();
  const existing = await collection.findOne({
    workspaceId: input.workspaceId,
    userId: input.userId,
    providerConfigId: input.providerConfigId,
  });

  const refreshTokenRef =
    input.refreshTokenRef !== undefined
      ? input.refreshTokenRef
      : existing?.refreshTokenRef ?? null;

  await collection.updateOne(
    {
      workspaceId: input.workspaceId,
      userId: input.userId,
      providerConfigId: input.providerConfigId,
    },
    {
      $set: {
        providerKey: input.providerKey,
        source: input.source ?? existing?.source ?? "customer_oauth",
        externalSubject:
          input.externalSubject !== undefined
            ? input.externalSubject
            : existing?.externalSubject ?? null,
        accountEmail:
          input.accountEmail !== undefined
            ? input.accountEmail
            : existing?.accountEmail ?? null,
        accountName:
          input.accountName !== undefined
            ? input.accountName
            : existing?.accountName ?? null,
        grantedScopes: uniqueScopes(input.grantedScopes),
        refreshTokenRef,
        accessTokenRef:
          input.accessTokenRef !== undefined
            ? input.accessTokenRef
            : existing?.accessTokenRef ?? null,
        accessTokenExpiresAt:
          input.accessTokenExpiresAt !== undefined
            ? input.accessTokenExpiresAt
            : existing?.accessTokenExpiresAt ?? null,
        tokenType:
          input.tokenType !== undefined
            ? input.tokenType
            : existing?.tokenType ?? null,
        revokedAt: refreshTokenRef ? null : existing?.revokedAt ?? null,
        lastRefreshError: null,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: existing?._id ?? new ObjectId().toHexString(),
        workspaceId: input.workspaceId,
        userId: input.userId,
        providerConfigId: input.providerConfigId,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  publishWorkspaceEvent({
    type: "integration.changed",
    workspaceId: input.workspaceId,
    scope: "integrations",
  });

  const account = await collection.findOne({
    workspaceId: input.workspaceId,
    userId: input.userId,
    providerConfigId: input.providerConfigId,
  });
  if (!account) throw new Error("Failed to upsert connected account.");
  return account;
}

export async function updateConnectedAccountTokenCache(input: {
  workspaceId: string;
  accountId: string;
  accessTokenRef: string | null;
  accessTokenExpiresAt: Date | null;
  tokenType?: string | null;
  refreshTokenRef?: string | null;
}): Promise<void> {
  const collection = await getConnectedAccountsCollection();
  const $set: Partial<ConnectedAccountDocument> = {
    accessTokenRef: input.accessTokenRef,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    lastRefreshAt: new Date(),
    lastRefreshError: null,
    updatedAt: new Date(),
  };
  if (input.tokenType !== undefined) $set.tokenType = input.tokenType;
  if (input.refreshTokenRef !== undefined) {
    $set.refreshTokenRef = input.refreshTokenRef;
    $set.revokedAt = null;
  }

  await collection.updateOne(
    { _id: input.accountId, workspaceId: input.workspaceId },
    { $set },
  );
}

export async function markConnectedAccountRefreshError(input: {
  workspaceId: string;
  accountId: string;
  error: string;
}): Promise<void> {
  const collection = await getConnectedAccountsCollection();
  await collection.updateOne(
    { _id: input.accountId, workspaceId: input.workspaceId },
    {
      $set: {
        lastRefreshError: input.error,
        updatedAt: new Date(),
      },
    },
  );
}

export async function markConnectedAccountRevoked(input: {
  workspaceId: string;
  accountId: string;
  reason?: string;
}): Promise<void> {
  const collection = await getConnectedAccountsCollection();
  await collection.updateOne(
    { _id: input.accountId, workspaceId: input.workspaceId },
    {
      $set: {
        revokedAt: new Date(),
        refreshTokenRef: null,
        accessTokenRef: null,
        accessTokenExpiresAt: null,
        lastRefreshError: input.reason ?? "reconnect_required",
        updatedAt: new Date(),
      },
    },
  );
  publishWorkspaceEvent({
    type: "integration.changed",
    workspaceId: input.workspaceId,
    scope: "integrations",
  });
}

export async function revokeConnectedAccountForUser(input: {
  workspaceId: string;
  userId: string;
  accountId: string;
}): Promise<ConnectedAccountDocument | null> {
  const collection = await getConnectedAccountsCollection();
  const account = await collection.findOne({
    _id: input.accountId,
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  if (!account) return null;

  await collection.updateOne(
    { _id: input.accountId, workspaceId: input.workspaceId, userId: input.userId },
    {
      $set: {
        revokedAt: new Date(),
        refreshTokenRef: null,
        accessTokenRef: null,
        accessTokenExpiresAt: null,
        updatedAt: new Date(),
      },
    },
  );

  publishWorkspaceEvent({
    type: "integration.changed",
    workspaceId: input.workspaceId,
    scope: "integrations",
  });

  return {
    ...account,
    revokedAt: new Date(),
    refreshTokenRef: account.refreshTokenRef,
    accessTokenRef: null,
    accessTokenExpiresAt: null,
  };
}
