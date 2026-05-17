import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { getAppSourceSnapshotsCollection } from "@/lib/db/collections";
import type {
  AppSourceSnapshotDocument,
  AppSourceSnapshotKind,
} from "@/lib/db/types";

const PREVIEW_ARTIFACT_PATHS = new Set([
  "index.html",
  "dist/index.html",
  "src/App.tsx",
  "src/App.jsx",
  "src/main.tsx",
  "src/main.jsx",
]);

function sourceFilesHash(files: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const [path, content] of Object.entries(files).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    hash.update(path);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function sourceFilesSizeBytes(files: Record<string, string>): number {
  let total = 0;
  for (const content of Object.values(files)) {
    total += Buffer.byteLength(content, "utf-8");
  }
  return total;
}

function hasPreviewArtifact(files: Record<string, string>): boolean {
  for (const path of PREVIEW_ARTIFACT_PATHS) {
    if (Object.prototype.hasOwnProperty.call(files, path)) return true;
  }
  return false;
}

export type SourceSnapshotSummary = Pick<
  AppSourceSnapshotDocument,
  | "_id"
  | "kind"
  | "sizeBytes"
  | "fileCount"
  | "hash"
  | "hasPreviewArtifact"
  | "updatedAt"
>;

export function buildSourceSnapshotSummary(input: {
  _id: string;
  kind: AppSourceSnapshotKind;
  files: Record<string, string>;
  updatedAt: Date;
}): SourceSnapshotSummary {
  return {
    _id: input._id,
    kind: input.kind,
    sizeBytes: sourceFilesSizeBytes(input.files),
    fileCount: Object.keys(input.files).length,
    hash: sourceFilesHash(input.files),
    hasPreviewArtifact: hasPreviewArtifact(input.files),
    updatedAt: input.updatedAt,
  };
}

export async function upsertAppSourceSnapshot(input: {
  workspaceId: string;
  appId: string;
  kind: AppSourceSnapshotKind;
  files: Record<string, string>;
}): Promise<SourceSnapshotSummary> {
  const collection = await getAppSourceSnapshotsCollection();
  const now = new Date();
  const snapshotId = new ObjectId().toHexString();
  const summary = buildSourceSnapshotSummary({
    _id: snapshotId,
    kind: input.kind,
    files: input.files,
    updatedAt: now,
  });

  await collection.updateOne(
    {
      workspaceId: input.workspaceId,
      appId: input.appId,
      kind: input.kind,
    },
    {
      $set: {
        files: input.files,
        sizeBytes: summary.sizeBytes,
        fileCount: summary.fileCount,
        hash: summary.hash,
        hasPreviewArtifact: summary.hasPreviewArtifact,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: snapshotId,
        workspaceId: input.workspaceId,
        appId: input.appId,
        kind: input.kind,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const saved = await collection.findOne(
    {
      workspaceId: input.workspaceId,
      appId: input.appId,
      kind: input.kind,
    },
    {
      projection: {
        _id: 1,
        kind: 1,
        sizeBytes: 1,
        fileCount: 1,
        hash: 1,
        hasPreviewArtifact: 1,
        updatedAt: 1,
      },
    },
  );

  if (!saved) {
    throw new Error("[db] Failed to upsert app source snapshot.");
  }

  return saved;
}

export async function getAppSourceSnapshotFiles(input: {
  workspaceId: string;
  appId: string;
  kind: AppSourceSnapshotKind;
}): Promise<Record<string, string> | null> {
  const collection = await getAppSourceSnapshotsCollection();
  const snapshot = await collection.findOne(
    {
      workspaceId: input.workspaceId,
      appId: input.appId,
      kind: input.kind,
    },
    { projection: { files: 1 } },
  );

  return snapshot?.files ?? null;
}

export async function findAppSourceSnapshotSummary(input: {
  workspaceId: string;
  appId: string;
  kind: AppSourceSnapshotKind;
}): Promise<SourceSnapshotSummary | null> {
  const collection = await getAppSourceSnapshotsCollection();
  return collection.findOne(
    {
      workspaceId: input.workspaceId,
      appId: input.appId,
      kind: input.kind,
    },
    {
      projection: {
        _id: 1,
        kind: 1,
        sizeBytes: 1,
        fileCount: 1,
        hash: 1,
        hasPreviewArtifact: 1,
        updatedAt: 1,
      },
    },
  );
}
