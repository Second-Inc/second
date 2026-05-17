import {
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_FILES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  attachmentPathFor,
} from "@/lib/attachments";
import { workerFetch } from "@/lib/worker-client";

export type BuilderAttachmentFile = {
  name: string;
  size: number;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type UploadedBuilderAttachment = {
  id: string;
  name: string;
  path: string;
  size: number;
  contentType?: string;
};

type WorkerAttachmentPayload = UploadedBuilderAttachment & {
  dataBase64: string;
};

export type PreparedBuilderAttachment = WorkerAttachmentPayload & {
  buffer: Buffer;
};

export type BuilderAttachmentUploadResult =
  | {
      ok: true;
      attachments: UploadedBuilderAttachment[];
      fileExtensions: string[];
      totalBytes: number;
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

export type BuilderAttachmentPrepareResult =
  | {
      ok: true;
      files: PreparedBuilderAttachment[];
      fileExtensions: string[];
      totalBytes: number;
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

export type BuilderAttachmentCheckResult =
  | {
      ok: true;
      missing: UploadedBuilderAttachment[];
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

export function isUploadedAttachmentFile(
  value: FormDataEntryValue,
): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function" &&
    "name" in value &&
    typeof value.name === "string" &&
    "size" in value &&
    typeof value.size === "number"
  );
}

export function parseAttachmentIds(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const index = base.lastIndexOf(".");
  if (index <= 0 || index === base.length - 1) return "";
  return base.slice(index + 1).toLowerCase().slice(0, 16);
}

export function attachmentReferenceFromPrepared(
  file: PreparedBuilderAttachment,
): UploadedBuilderAttachment {
  return {
    id: file.id,
    name: file.name,
    path: file.path,
    size: file.size,
    ...(file.contentType ? { contentType: file.contentType } : {}),
  };
}

export async function prepareBuilderAttachmentFiles(input: {
  appId: string;
  files: BuilderAttachmentFile[];
  attachmentIds: string[];
}): Promise<BuilderAttachmentPrepareResult> {
  if (
    input.files.length === 0 ||
    input.files.length !== input.attachmentIds.length
  ) {
    return { ok: false, error: "missing_files", status: 400 };
  }
  if (input.files.length > MAX_ATTACHMENT_FILES) {
    return { ok: false, error: "too_many_files", status: 413 };
  }

  const workerFiles: PreparedBuilderAttachment[] = [];
  let totalBytes = 0;

  for (let index = 0; index < input.files.length; index += 1) {
    const file = input.files[index];
    const id = input.attachmentIds[index];
    if (!file || !id) {
      return { ok: false, error: "missing_files", status: 400 };
    }
    if (!file.name || file.size < 0) {
      return { ok: false, error: "invalid_file", status: 400 };
    }
    if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
      return { ok: false, error: "file_too_large", status: 413 };
    }
    totalBytes += file.size;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      return { ok: false, error: "upload_too_large", status: 413 };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    workerFiles.push({
      id,
      name: file.name,
      path: attachmentPathFor({ id, name: file.name }),
      size: buffer.byteLength,
      ...(file.type ? { contentType: file.type } : {}),
      dataBase64: buffer.toString("base64"),
      buffer,
    });
  }

  return {
    ok: true,
    files: workerFiles,
    totalBytes,
    fileExtensions: [
      ...new Set(workerFiles.map((item) => fileExtension(item.name))),
    ].filter(Boolean),
  };
}

export async function uploadPreparedBuilderAttachmentsToWorker(input: {
  appId: string;
  files: PreparedBuilderAttachment[];
  workerUrl?: string;
}): Promise<BuilderAttachmentUploadResult> {
  const workerResponse = await workerFetch(`/sessions/${input.appId}/attachments`, {
    workerUrl: input.workerUrl,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      files: input.files.map((file) => ({
        id: file.id,
        name: file.name,
        path: file.path,
        size: file.size,
        ...(file.contentType ? { contentType: file.contentType } : {}),
        dataBase64: file.dataBase64,
      })),
    }),
  }).catch(() => null);

  if (!workerResponse) {
    return { ok: false, error: "worker_unavailable", status: 502 };
  }

  const workerPayload = (await workerResponse.json().catch(() => null)) as
    | {
        attachments?: UploadedBuilderAttachment[];
        error?: string;
      }
    | null;

  if (!workerResponse.ok || !Array.isArray(workerPayload?.attachments)) {
    return {
      ok: false,
      error: workerPayload?.error ?? "upload_failed",
      status: workerResponse.status >= 400 ? workerResponse.status : 502,
    };
  }

  return {
    ok: true,
    attachments: workerPayload.attachments,
    totalBytes: input.files.reduce((total, file) => total + file.size, 0),
    fileExtensions: [
      ...new Set(workerPayload.attachments.map((item) => fileExtension(item.name))),
    ].filter(Boolean),
  };
}

export async function uploadBuilderAttachmentsToWorker(input: {
  appId: string;
  files: BuilderAttachmentFile[];
  attachmentIds: string[];
  workerUrl?: string;
}): Promise<BuilderAttachmentUploadResult> {
  const prepared = await prepareBuilderAttachmentFiles(input);
  if (!prepared.ok) return prepared;
  return uploadPreparedBuilderAttachmentsToWorker({
    appId: input.appId,
    files: prepared.files,
    workerUrl: input.workerUrl,
  });
}

export async function findMissingWorkerAttachments(input: {
  appId: string;
  workerUrl?: string;
  attachments: UploadedBuilderAttachment[];
}): Promise<BuilderAttachmentCheckResult> {
  if (input.attachments.length === 0) {
    return { ok: true, missing: [] };
  }

  const workerResponse = await workerFetch(
    `/sessions/${input.appId}/attachments/check`,
    {
      workerUrl: input.workerUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        paths: input.attachments.map((attachment) => attachment.path),
      }),
    },
  ).catch(() => null);

  if (!workerResponse) {
    return { ok: false, error: "worker_unavailable", status: 502 };
  }

  const payload = (await workerResponse.json().catch(() => null)) as
    | {
        missing?: unknown;
        error?: string;
      }
    | null;

  if (!workerResponse.ok || !Array.isArray(payload?.missing)) {
    return {
      ok: false,
      error: payload?.error ?? "attachment_check_failed",
      status: workerResponse.status >= 400 ? workerResponse.status : 502,
    };
  }

  const missingPaths = new Set(
    payload.missing.filter((item): item is string => typeof item === "string"),
  );

  return {
    ok: true,
    missing: input.attachments.filter((attachment) =>
      missingPaths.has(attachment.path),
    ),
  };
}
