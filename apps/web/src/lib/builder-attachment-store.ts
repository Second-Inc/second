import { GridFSBucket, type ObjectId } from "mongodb";
import { getMongoDatabase } from "@/lib/db/client";
import {
  attachmentReferenceFromPrepared,
  type PreparedBuilderAttachment,
  type UploadedBuilderAttachment,
} from "@/lib/builder-attachment-upload";

const BUILDER_ATTACHMENTS_BUCKET = "builder_attachments";

type BuilderAttachmentMetadata = {
  workspaceId: string;
  appId: string;
  runId?: string;
  attachmentId: string;
  name: string;
  path: string;
  size: number;
  contentType?: string;
  uploadedAt: Date;
};

type BuilderAttachmentGridFile = {
  _id: ObjectId;
  uploadDate: Date;
  metadata?: Partial<BuilderAttachmentMetadata>;
};

function isValidStoredAttachment(
  value: unknown,
): value is UploadedBuilderAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.path === "string" &&
    record.path.startsWith("attachments/") &&
    !record.path.split("/").includes("..") &&
    typeof record.size === "number" &&
    Number.isFinite(record.size) &&
    record.size >= 0 &&
    (record.contentType === undefined || typeof record.contentType === "string")
  );
}

function fileMetadata(input: {
  workspaceId: string;
  appId: string;
  runId?: string | null;
  file: PreparedBuilderAttachment;
}): BuilderAttachmentMetadata {
  return {
    workspaceId: input.workspaceId,
    appId: input.appId,
    ...(input.runId ? { runId: input.runId } : {}),
    attachmentId: input.file.id,
    name: input.file.name,
    path: input.file.path,
    size: input.file.size,
    ...(input.file.contentType ? { contentType: input.file.contentType } : {}),
    uploadedAt: new Date(),
  };
}

async function writeGridFile(input: {
  bucket: GridFSBucket;
  file: PreparedBuilderAttachment;
  metadata: BuilderAttachmentMetadata;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = input.bucket.openUploadStream(input.file.path, {
      metadata: input.metadata,
    });
    stream.once("error", reject);
    stream.once("finish", () => resolve());
    stream.end(input.file.buffer);
  });
}

async function readGridFile(
  bucket: GridFSBucket,
  id: ObjectId,
): Promise<Buffer> {
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    const stream = bucket.openDownloadStream(id);
    stream.on("data", (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.once("error", reject);
    stream.once("end", () => resolve());
  });

  return Buffer.concat(chunks);
}

export async function storeBuilderAttachmentPayloads(input: {
  workspaceId: string;
  appId: string;
  runId?: string | null;
  files: PreparedBuilderAttachment[];
}): Promise<void> {
  if (input.files.length === 0) return;

  const db = await getMongoDatabase();
  const bucket = new GridFSBucket(db, {
    bucketName: BUILDER_ATTACHMENTS_BUCKET,
  });
  const filesCollection = db.collection<BuilderAttachmentGridFile>(
    `${BUILDER_ATTACHMENTS_BUCKET}.files`,
  );

  for (const file of input.files) {
    const existing = await filesCollection
      .find({
        "metadata.workspaceId": input.workspaceId,
        "metadata.appId": input.appId,
        "metadata.attachmentId": file.id,
      })
      .project<{ _id: ObjectId }>({ _id: 1 })
      .toArray();

    await Promise.all(existing.map((item) => bucket.delete(item._id)));
    await writeGridFile({
      bucket,
      file,
      metadata: fileMetadata({
        workspaceId: input.workspaceId,
        appId: input.appId,
        runId: input.runId,
        file,
      }),
    });
  }
}

export async function loadStoredBuilderAttachmentPayloads(input: {
  workspaceId: string;
  appId: string;
  attachments: UploadedBuilderAttachment[];
}): Promise<PreparedBuilderAttachment[]> {
  if (input.attachments.length === 0) return [];

  const attachmentIds = input.attachments.map((attachment) => attachment.id);
  const db = await getMongoDatabase();
  const bucket = new GridFSBucket(db, {
    bucketName: BUILDER_ATTACHMENTS_BUCKET,
  });
  const filesCollection = db.collection<BuilderAttachmentGridFile>(
    `${BUILDER_ATTACHMENTS_BUCKET}.files`,
  );
  const records = await filesCollection
    .find({
      "metadata.workspaceId": input.workspaceId,
      "metadata.appId": input.appId,
      "metadata.attachmentId": { $in: attachmentIds },
    })
    .sort({ uploadDate: -1 })
    .toArray();
  const latestByAttachmentId = new Map<string, BuilderAttachmentGridFile>();

  for (const record of records) {
    const attachmentId = record.metadata?.attachmentId;
    if (!attachmentId || latestByAttachmentId.has(attachmentId)) continue;
    latestByAttachmentId.set(attachmentId, record);
  }

  const files: PreparedBuilderAttachment[] = [];
  for (const requested of input.attachments) {
    const record = latestByAttachmentId.get(requested.id);
    const metadata = record?.metadata;
    if (!record || !metadata) continue;

    const reference = {
      id: metadata.attachmentId,
      name: metadata.name,
      path: metadata.path,
      size: metadata.size,
      ...(metadata.contentType ? { contentType: metadata.contentType } : {}),
    };
    if (!isValidStoredAttachment(reference)) continue;

    const buffer = await readGridFile(bucket, record._id);
    files.push({
      ...reference,
      size: buffer.byteLength,
      dataBase64: buffer.toString("base64"),
      buffer,
    });
  }

  return files;
}

export function storedAttachmentReferences(
  files: PreparedBuilderAttachment[],
): UploadedBuilderAttachment[] {
  return files.map(attachmentReferenceFromPrepared);
}
