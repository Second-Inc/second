export type AttachmentReference = {
  id: string;
  name: string;
  path: string;
  size: number;
  contentType?: string;
};

export const MAX_ATTACHMENT_FILES = 10;
export const MAX_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;

export function sanitizeAttachmentId(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64);
  return cleaned || "file";
}

export function sanitizeAttachmentFileName(value: string): string {
  const baseName = value.split(/[\\/]/).pop()?.trim() || "file";
  const cleaned = baseName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || "file";
}

export function attachmentPathFor(input: {
  id: string;
  name: string;
}): string {
  return `attachments/${sanitizeAttachmentId(input.id)}-${sanitizeAttachmentFileName(input.name)}`;
}

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
