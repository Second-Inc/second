import { ObjectId } from "mongodb";
import { getOAuthProviderConfigsCollection } from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import {
  readOAuthSecret,
  upsertOAuthSecret,
} from "@/lib/oauth/secret-store";
import type {
  OAuthProviderConfigDocument,
  OAuthTokenAuthMethod,
} from "@/lib/db/types";

export function normalizeOAuthProviderKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "provider";
}

export function normalizeOAuthTokenAuthMethod(
  value: unknown,
): OAuthTokenAuthMethod {
  return value === "client_secret_basic" || value === "none"
    ? value
    : "client_secret_post";
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function cleanStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== "string") continue;
    const cleanKey = key.trim();
    const cleanValue = rawValue.trim();
    if (!cleanKey || !cleanValue) continue;
    result[cleanKey] = cleanValue;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export async function upsertOAuthProviderConfigShell(input: {
  workspaceId: string;
  providerKey: string;
  displayName: string;
  authorizationUrl: string;
  tokenUrl: string;
  tokenAuthMethod?: OAuthTokenAuthMethod;
  defaultAuthorizationParams?: Record<string, string>;
  defaultTokenParams?: Record<string, string>;
  createdByUserId: string;
  createdByUserName: string;
}): Promise<OAuthProviderConfigDocument> {
  const collection = await getOAuthProviderConfigsCollection();
  const now = new Date();
  const providerKey = normalizeOAuthProviderKey(input.providerKey);
  const existing = await collection.findOne({
    workspaceId: input.workspaceId,
    providerKey,
  });

  if (existing?.configured) {
    await collection.updateOne(
      { _id: existing._id, workspaceId: input.workspaceId },
      {
        $set: {
          displayName: input.displayName.trim() || existing.displayName,
          updatedAt: now,
        },
      },
    );
    return {
      ...existing,
      displayName: input.displayName.trim() || existing.displayName,
      updatedAt: now,
    };
  }

  const configId = existing?._id ?? new ObjectId().toHexString();
  const update = {
    displayName: input.displayName.trim() || providerKey,
    authorizationUrl: input.authorizationUrl.trim(),
    tokenUrl: input.tokenUrl.trim(),
    tokenAuthMethod:
      input.tokenAuthMethod ?? existing?.tokenAuthMethod ?? "client_secret_post",
    defaultAuthorizationParams:
      input.defaultAuthorizationParams ?? existing?.defaultAuthorizationParams,
    defaultTokenParams: input.defaultTokenParams ?? existing?.defaultTokenParams,
    updatedAt: now,
  };

  await collection.updateOne(
    { workspaceId: input.workspaceId, providerKey },
    {
      $set: update,
      $setOnInsert: {
        _id: configId,
        workspaceId: input.workspaceId,
        providerKey,
        clientId: null,
        clientSecretRef: null,
        configured: false,
        createdByUserId: input.createdByUserId,
        createdByUserName: input.createdByUserName,
        configuredByUserId: null,
        configuredByUserName: null,
        configuredAt: null,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const config = await collection.findOne({
    workspaceId: input.workspaceId,
    providerKey,
  });
  if (!config) {
    throw new Error("Failed to upsert OAuth provider config.");
  }
  return config;
}

export async function configureOAuthProviderClient(input: {
  workspaceId: string;
  providerConfigId: string;
  clientId: string;
  clientSecret?: string | null;
  actor: { userId: string; userName: string };
}): Promise<OAuthProviderConfigDocument | null> {
  const collection = await getOAuthProviderConfigsCollection();
  const existing = await collection.findOne({
    _id: input.providerConfigId,
    workspaceId: input.workspaceId,
  });
  if (!existing) return null;

  const clientId = input.clientId.trim();
  if (!clientId) {
    throw new Error("clientId is required.");
  }

  const now = new Date();
  let clientSecretRef = existing.clientSecretRef ?? null;
  const clientSecret = input.clientSecret?.trim();
  if (clientSecret?.length) {
    clientSecretRef = await upsertOAuthSecret({
      workspaceId: input.workspaceId,
      name: `oauth_provider_client_${existing._id}_${existing.providerKey}`,
      value: clientSecret,
      existingRef: existing.clientSecretRef,
    });
  }

  if (existing.tokenAuthMethod !== "none" && !clientSecretRef) {
    throw new Error("clientSecret is required for this OAuth provider.");
  }

  await collection.updateOne(
    { _id: existing._id, workspaceId: input.workspaceId },
    {
      $set: {
        clientId,
        clientSecretRef,
        configured: true,
        configuredByUserId: input.actor.userId,
        configuredByUserName: input.actor.userName,
        configuredAt: now,
        updatedAt: now,
      },
    },
  );

  publishWorkspaceEvent({
    type: "integration.changed",
    workspaceId: input.workspaceId,
    scope: "integrations",
  });

  return collection.findOne({ _id: existing._id, workspaceId: input.workspaceId });
}

export async function findOAuthProviderConfigById(input: {
  workspaceId: string;
  providerConfigId: string;
}): Promise<OAuthProviderConfigDocument | null> {
  const collection = await getOAuthProviderConfigsCollection();
  return collection.findOne({
    _id: input.providerConfigId,
    workspaceId: input.workspaceId,
  });
}

export async function findOAuthProviderConfigForWorkspace(input: {
  workspaceId: string;
  providerKey: string;
}): Promise<OAuthProviderConfigDocument | null> {
  const collection = await getOAuthProviderConfigsCollection();
  return collection.findOne({
    workspaceId: input.workspaceId,
    providerKey: normalizeOAuthProviderKey(input.providerKey),
  });
}

export async function listOAuthProviderConfigsForWorkspace(
  workspaceId: string,
): Promise<OAuthProviderConfigDocument[]> {
  const collection = await getOAuthProviderConfigsCollection();
  return collection.find({ workspaceId }).sort({ updatedAt: -1 }).toArray();
}

export async function readOAuthProviderClientSecret(
  config: Pick<OAuthProviderConfigDocument, "clientSecretRef" | "tokenAuthMethod">,
): Promise<string | null> {
  if (config.tokenAuthMethod === "none") return null;
  if (!config.clientSecretRef) return null;
  return (await readOAuthSecret(config.clientSecretRef)).trim();
}

export function normalizeOAuthStringMap(value: unknown): Record<string, string> | undefined {
  return cleanStringMap(value);
}
