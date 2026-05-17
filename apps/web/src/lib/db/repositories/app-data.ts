import { ObjectId } from "mongodb";
import { getAppDataCollection } from "@/lib/db/collections";
import type { AppDataDocument } from "@/lib/db/types";

export async function listAppData(
  workspaceId: string,
  appId: string,
  collection: string,
): Promise<AppDataDocument[]> {
  const col = await getAppDataCollection();
  return col
    .find({ workspaceId, appId, collection })
    .sort({ updatedAt: -1 })
    .toArray();
}

export async function listAppDataForApp(
  workspaceId: string,
  appId: string,
): Promise<AppDataDocument[]> {
  const col = await getAppDataCollection();
  return col
    .find({ workspaceId, appId })
    .sort({ collection: 1, updatedAt: -1 })
    .toArray();
}

export async function getAppDataDoc(
  workspaceId: string,
  appId: string,
  collection: string,
  docId: string,
): Promise<AppDataDocument | null> {
  const col = await getAppDataCollection();
  return col.findOne({ _id: docId, workspaceId, appId, collection });
}

export async function insertAppData(
  workspaceId: string,
  appId: string,
  collection: string,
  data: Record<string, unknown>,
): Promise<AppDataDocument> {
  const col = await getAppDataCollection();
  const now = new Date();
  const doc: AppDataDocument = {
    _id: new ObjectId().toHexString(),
    workspaceId,
    appId,
    collection,
    data,
    createdAt: now,
    updatedAt: now,
  };
  await col.insertOne(doc);
  return doc;
}

export async function updateAppData(
  workspaceId: string,
  appId: string,
  collection: string,
  docId: string,
  data: Record<string, unknown>,
): Promise<AppDataDocument | null> {
  const col = await getAppDataCollection();
  const result = await col.findOneAndUpdate(
    { _id: docId, workspaceId, appId, collection },
    {
      $set: {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [`data.${k}`, v]),
        ),
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  return result ?? null;
}

export async function deleteAppData(
  workspaceId: string,
  appId: string,
  collection: string,
  docId: string,
): Promise<boolean> {
  const col = await getAppDataCollection();
  const result = await col.deleteOne({
    _id: docId,
    workspaceId,
    appId,
    collection,
  });
  return result.deletedCount > 0;
}

export async function upsertAppData(
  workspaceId: string,
  appId: string,
  collection: string,
  filter: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<AppDataDocument> {
  const col = await getAppDataCollection();
  const now = new Date();

  // Build the filter with data. prefix for nested fields
  const dataFilter: Record<string, unknown> = { workspaceId, appId, collection };
  for (const [k, v] of Object.entries(filter)) {
    dataFilter[`data.${k}`] = v;
  }

  const result = await col.findOneAndUpdate(
    dataFilter,
    {
      $set: {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [`data.${k}`, v]),
        ),
        updatedAt: now,
      },
      $setOnInsert: {
        _id: new ObjectId().toHexString(),
        workspaceId,
        appId,
        collection,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  return result!;
}
