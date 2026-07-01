import { ObjectId } from "mongodb";
import {
  getAppsCollection,
  getSourceControlConnectionsCollection,
} from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import type {
  AppSourceControlMetadata,
  SourceControlConnectionDocument,
  SourceControlProviderKey,
} from "@/lib/db/types";

type ProviderInput = {
  workspaceId: string;
  provider?: SourceControlProviderKey;
};

export type SourceControlConnectionReadModel = {
  id: string;
  provider: SourceControlProviderKey;
  status: SourceControlConnectionDocument["status"];
  targetOwner: string;
  targetOwnerType: SourceControlConnectionDocument["targetOwnerType"];
  defaultVisibility: SourceControlConnectionDocument["defaultVisibility"];
  repoNamePrefix: string | null;
  sourceStorageMode: NonNullable<
    SourceControlConnectionDocument["sourceStorageMode"]
  >;
  connectedAccountLogin: string | null;
  connectedByName: string | null;
  permissionsState: SourceControlConnectionDocument["permissionsState"] | null;
  lastValidatedAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

function providerFromInput(input: ProviderInput): SourceControlProviderKey {
  return input.provider ?? "github";
}

export function serializeSourceControlConnection(
  connection: SourceControlConnectionDocument | null,
): SourceControlConnectionReadModel | null {
  if (!connection) return null;
  return {
    id: connection._id,
    provider: connection.provider,
    status: connection.status,
    targetOwner: connection.targetOwner,
    targetOwnerType: connection.targetOwnerType ?? "unknown",
    defaultVisibility: connection.defaultVisibility,
    repoNamePrefix: connection.repoNamePrefix ?? null,
    sourceStorageMode: connection.sourceStorageMode ?? "mongo",
    connectedAccountLogin: connection.connectedAccountLogin ?? null,
    connectedByName: connection.connectedByName ?? null,
    permissionsState: connection.permissionsState ?? null,
    lastValidatedAt: connection.lastValidatedAt?.toISOString() ?? null,
    lastErrorCode: connection.lastErrorCode ?? null,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

export async function getSourceControlConnection(
  input: ProviderInput,
): Promise<SourceControlConnectionDocument | null> {
  const collection = await getSourceControlConnectionsCollection();
  return collection.findOne({
    workspaceId: input.workspaceId,
    provider: providerFromInput(input),
  });
}

export async function getValidSourceControlConnection(
  input: ProviderInput,
): Promise<SourceControlConnectionDocument | null> {
  const connection = await getSourceControlConnection(input);
  return connection?.status === "valid" ? connection : null;
}

export async function hasValidSourceControlConnection(
  input: ProviderInput,
): Promise<boolean> {
  const collection = await getSourceControlConnectionsCollection();
  const connection = await collection.findOne(
    {
      workspaceId: input.workspaceId,
      provider: providerFromInput(input),
      status: "valid",
    },
    { projection: { _id: 1 } },
  );
  return Boolean(connection);
}

export async function upsertSourceControlConnection(input: {
  workspaceId: string;
  provider: SourceControlProviderKey;
  mode: SourceControlConnectionDocument["mode"];
  status: SourceControlConnectionDocument["status"];
  targetOwner: string;
  targetOwnerType?: SourceControlConnectionDocument["targetOwnerType"];
  defaultVisibility: SourceControlConnectionDocument["defaultVisibility"];
  repoNamePrefix?: string | null;
  sourceStorageMode?: SourceControlConnectionDocument["sourceStorageMode"];
  credentialRef: string;
  credentialKind: SourceControlConnectionDocument["credentialKind"];
  connectedAccountLogin?: string | null;
  connectedByUserId?: string | null;
  connectedByName?: string | null;
  permissionsState?: SourceControlConnectionDocument["permissionsState"];
  lastValidatedAt?: Date | null;
  lastErrorCode?: string | null;
}): Promise<SourceControlConnectionDocument> {
  const collection = await getSourceControlConnectionsCollection();
  const now = new Date();
  const existing = await collection.findOne({
    workspaceId: input.workspaceId,
    provider: input.provider,
  });
  const _id = existing?._id ?? new ObjectId().toHexString();
  const document: SourceControlConnectionDocument = {
    _id,
    workspaceId: input.workspaceId,
    provider: input.provider,
    mode: input.mode,
    status: input.status,
    targetOwner: input.targetOwner,
    targetOwnerType: input.targetOwnerType ?? "unknown",
    defaultVisibility: input.defaultVisibility,
    repoNamePrefix: input.repoNamePrefix ?? null,
    sourceStorageMode: input.sourceStorageMode ?? existing?.sourceStorageMode ?? "mongo",
    credentialRef: input.credentialRef,
    credentialKind: input.credentialKind,
    connectedAccountLogin: input.connectedAccountLogin ?? null,
    connectedByUserId: input.connectedByUserId ?? null,
    connectedByName: input.connectedByName ?? null,
    permissionsState: input.permissionsState,
    lastValidatedAt: input.lastValidatedAt ?? null,
    lastErrorCode: input.lastErrorCode ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await collection.updateOne(
    { workspaceId: input.workspaceId, provider: input.provider },
    { $set: document },
    { upsert: true },
  );

  publishWorkspaceEvent({
    type: "changed",
    workspaceId: input.workspaceId,
    scope: "workspace-settings",
  });

  return document;
}

export async function markSourceControlConnectionInvalid(input: {
  workspaceId: string;
  provider?: SourceControlProviderKey;
  status?: "invalid" | "revoked";
  errorCode: string;
}): Promise<void> {
  const collection = await getSourceControlConnectionsCollection();
  const result = await collection.updateOne(
    {
      workspaceId: input.workspaceId,
      provider: providerFromInput(input),
    },
    {
      $set: {
        status: input.status ?? "invalid",
        lastErrorCode: input.errorCode,
        updatedAt: new Date(),
      },
    },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "changed",
      workspaceId: input.workspaceId,
      scope: "workspace-settings",
    });
  }
}

export async function deleteSourceControlConnection(input: {
  workspaceId: string;
  provider?: SourceControlProviderKey;
}): Promise<SourceControlConnectionDocument | null> {
  const collection = await getSourceControlConnectionsCollection();
  const provider = providerFromInput(input);
  const existing = await collection.findOne({
    workspaceId: input.workspaceId,
    provider,
  });
  if (!existing) return null;
  await collection.deleteOne({
    workspaceId: input.workspaceId,
    provider,
  });
  publishWorkspaceEvent({
    type: "changed",
    workspaceId: input.workspaceId,
    scope: "workspace-settings",
  });
  return existing;
}

export async function updateAppSourceControlMetadata(input: {
  workspaceId: string;
  appId: string;
  sourceControl: AppSourceControlMetadata | null;
}): Promise<boolean> {
  const appsCollection = await getAppsCollection();
  const now = new Date();
  const result = await appsCollection.updateOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    input.sourceControl
      ? {
          $set: {
            sourceControl: input.sourceControl,
            updatedAt: now,
          },
        }
      : {
          $unset: { sourceControl: "" },
          $set: { updatedAt: now },
        },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "app.updated",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }
  return result.matchedCount > 0;
}

export async function patchAppSourceControlMetadata(input: {
  workspaceId: string;
  appId: string;
  patch: Partial<AppSourceControlMetadata>;
}): Promise<boolean> {
  const appsCollection = await getAppsCollection();
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(input.patch)) {
    $set[`sourceControl.${key}`] = value;
  }
  const result = await appsCollection.updateOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    { $set },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "app.updated",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }
  return result.matchedCount > 0;
}

export async function findInstalledSourceControlApp(input: {
  workspaceId: string;
  provider: SourceControlProviderKey;
  owner: string;
  repo: string;
}) {
  const appsCollection = await getAppsCollection();
  return appsCollection.findOne(
    {
      workspaceId: input.workspaceId,
      $or: [
        {
          "sourceControl.provider": input.provider,
          "sourceControl.owner": input.owner,
          "sourceControl.repo": input.repo,
        },
        {
          "sourceControl.installedFrom.provider": input.provider,
          "sourceControl.installedFrom.owner": input.owner,
          "sourceControl.installedFrom.repo": input.repo,
        },
      ],
    },
    {
      projection: {
        _id: 1,
        name: 1,
        sourceControl: 1,
      },
    },
  );
}

export async function listInstalledSourceControlApps(input: {
  workspaceId: string;
  provider?: SourceControlProviderKey;
}) {
  const appsCollection = await getAppsCollection();
  return appsCollection
    .find(
      {
        workspaceId: input.workspaceId,
        "sourceControl.installedFrom.provider": providerFromInput(input),
      },
      {
        projection: {
          _id: 1,
          name: 1,
          sourceControl: 1,
        },
      },
    )
    .toArray();
}
