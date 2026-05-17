#!/usr/bin/env node
import { createHash } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

function dbNameFromUri(mongodbUri) {
  const url = new URL(mongodbUri);
  const name = url.pathname.replace(/^\//, "").split("/")[0];
  if (!name) throw new Error("MONGODB_URI must include a database name.");
  return decodeURIComponent(name);
}

function sourceHash(files) {
  const hash = createHash("sha256");
  for (const [path, content] of Object.entries(files ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    hash.update(path);
    hash.update("\0");
    hash.update(String(content));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function sourceSize(files) {
  let total = 0;
  for (const content of Object.values(files ?? {})) {
    total += Buffer.byteLength(String(content), "utf-8");
  }
  return total;
}

function hasPreviewArtifact(files) {
  return [
    "index.html",
    "dist/index.html",
    "src/App.tsx",
    "src/App.jsx",
    "src/main.tsx",
    "src/main.jsx",
  ].some((path) => Object.prototype.hasOwnProperty.call(files ?? {}, path));
}

async function upsertSnapshot(collection, { workspaceId, appId, kind, files }) {
  const now = new Date();
  const summary = {
    sizeBytes: sourceSize(files),
    fileCount: Object.keys(files ?? {}).length,
    hash: sourceHash(files),
    hasPreviewArtifact: hasPreviewArtifact(files),
  };

  await collection.updateOne(
    { workspaceId, appId, kind },
    {
      $set: {
        files,
        ...summary,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: new ObjectId().toHexString(),
        workspaceId,
        appId,
        kind,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const snapshot = await collection.findOne(
    { workspaceId, appId, kind },
    { projection: { _id: 1, updatedAt: 1, ...Object.fromEntries(Object.keys(summary).map((key) => [key, 1])) } },
  );
  return snapshot;
}

const client = new MongoClient(uri);
await client.connect();

try {
  const db = client.db(dbNameFromUri(uri));
  const apps = db.collection("apps");
  const snapshots = db.collection("app_source_snapshots");
  const cursor = apps.find(
    {
      $or: [
        { sourceFiles: { $exists: true, $ne: null } },
        { publishedSourceFiles: { $exists: true, $ne: null } },
      ],
    },
    {
      projection: {
        _id: 1,
        workspaceId: 1,
        sourceFiles: 1,
        publishedSourceFiles: 1,
        publishedSourceFilesUpdatedAt: 1,
      },
    },
  );

  let migrated = 0;
  for await (const app of cursor) {
    const $set = {};
    const $unset = {};

    if (app.sourceFiles && Object.keys(app.sourceFiles).length > 0) {
      const draft = await upsertSnapshot(snapshots, {
        workspaceId: app.workspaceId,
        appId: app._id,
        kind: "draft",
        files: app.sourceFiles,
      });
      $set.draftSnapshotId = draft._id;
      $set.draftSourceUpdatedAt = draft.updatedAt;
      $set.draftSourceSizeBytes = draft.sizeBytes;
      $set.draftSourceHash = draft.hash;
      $set.draftHasPreviewArtifact = draft.hasPreviewArtifact;
      $unset.sourceFiles = "";
    }

    if (
      app.publishedSourceFiles &&
      Object.keys(app.publishedSourceFiles).length > 0
    ) {
      const published = await upsertSnapshot(snapshots, {
        workspaceId: app.workspaceId,
        appId: app._id,
        kind: "published",
        files: app.publishedSourceFiles,
      });
      $set.publishedSnapshotId = published._id;
      $set.publishedSourceFilesUpdatedAt =
        app.publishedSourceFilesUpdatedAt ?? published.updatedAt;
      $set.publishedSourceSizeBytes = published.sizeBytes;
      $set.publishedSourceHash = published.hash;
      $set.publishedHasPreviewArtifact = published.hasPreviewArtifact;
      $unset.publishedSourceFiles = "";
    }

    if (Object.keys($set).length > 0 || Object.keys($unset).length > 0) {
      await apps.updateOne(
        { _id: app._id, workspaceId: app.workspaceId },
        {
          ...(Object.keys($set).length > 0 ? { $set } : {}),
          ...(Object.keys($unset).length > 0 ? { $unset } : {}),
        },
      );
      migrated += 1;
    }
  }

  console.log(`Migrated ${migrated} app source snapshot document(s).`);
} finally {
  await client.close();
}
