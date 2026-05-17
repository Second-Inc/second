"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FileIcon,
  FileUpIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppLoader } from "@/components/app-loader";
import { cn } from "@/lib/utils";
import {
  attachmentPathFor,
  formatAttachmentSize,
  type AttachmentReference,
} from "@/lib/attachments";

export type ComposerAttachmentStatus =
  | "pending"
  | "uploading"
  | "uploaded"
  | "error";

export type ComposerAttachment = {
  id: string;
  file?: File;
  name: string;
  path: string;
  size: number;
  contentType?: string;
  status: ComposerAttachmentStatus;
  error?: string;
};

export function createComposerAttachment(file: File): ComposerAttachment {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    file,
    name: file.name,
    path: attachmentPathFor({ id, name: file.name }),
    size: file.size,
    contentType: file.type || undefined,
    status: "pending",
  };
}

export function attachmentReference(
  attachment: ComposerAttachment,
): AttachmentReference {
  return {
    id: attachment.id,
    name: attachment.name,
    path: attachment.path,
    size: attachment.size,
    ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
  };
}

export async function uploadComposerAttachments(input: {
  workspaceId: string;
  appId: string;
  runId?: string | null;
  attachments: ComposerAttachment[];
}): Promise<AttachmentReference[]> {
  const formData = new FormData();
  const attachmentIds: string[] = [];

  for (const attachment of input.attachments) {
    if (!attachment.file) continue;
    attachmentIds.push(attachment.id);
    formData.append("files", attachment.file, attachment.name);
  }

  formData.append("attachmentIds", JSON.stringify(attachmentIds));
  if (input.runId) {
    formData.append("runId", input.runId);
  }

  const response = await fetch(
    `/api/workspaces/${input.workspaceId}/apps/${input.appId}/attachments`,
    {
      method: "POST",
      body: formData,
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | { attachments?: AttachmentReference[]; error?: string }
    | null;

  if (!response.ok || !Array.isArray(payload?.attachments)) {
    throw new Error(payload?.error ?? "upload_failed");
  }

  return payload.attachments;
}

function hasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes("Files");
}

export function useWindowFileDrop(input: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const onFilesRef = useRef(input.onFiles);
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  useEffect(() => {
    onFilesRef.current = input.onFiles;
  }, [input.onFiles]);

  useEffect(() => {
    if (!input.enabled) {
      dragDepthRef.current = 0;
      return;
    }

    const handleDragEnter = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDraggingFiles(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setIsDraggingFiles(true);
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDraggingFiles(false);
    };

    const handleDrop = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);

      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) onFilesRef.current(files);
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [input.enabled]);

  return input.enabled && isDraggingFiles;
}

export function AttachmentDropOverlay({ visible }: { visible: boolean }) {
  if (!visible || typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 top-0 z-[2147483000] flex h-[100dvh] w-screen items-center justify-center bg-sky-500/10 p-6 backdrop-blur-[2px] ring-1 ring-inset ring-sky-400/30">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-sky-300/70 bg-background/90 px-8 py-7 text-center shadow-2xl shadow-sky-950/10 dark:border-sky-500/40 dark:bg-background/85">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-sky-300/70 bg-sky-500/10 text-sky-600 shadow-sm dark:border-sky-500/40 dark:text-sky-300">
          <FileUpIcon className="size-7" strokeWidth={1.7} />
        </div>
        <p className="text-sm font-medium text-foreground">Drop to attach</p>
      </div>
    </div>,
    document.body,
  );
}

export function ComposerAttachmentList({
  attachments,
  onRemove,
  className,
}: {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
  className?: string;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-2 py-1.5 text-xs shadow-[0_1px_0_rgba(0,0,0,0.03)]"
        >
          <div
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/30 text-muted-foreground",
              attachment.status === "error" &&
                "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            {attachment.status === "uploading" ? (
              <AppLoader size="xs" />
            ) : (
              <FileIcon className="size-3.5" strokeWidth={1.6} />
            )}
          </div>
          <span className="min-w-0 max-w-[260px] truncate font-medium text-foreground">
            {attachment.name}
          </span>
          <span
            className={cn(
              "mt-0.5 shrink-0 text-[11px] text-muted-foreground",
              attachment.status === "error" && "text-destructive",
            )}
          >
            {attachment.status === "uploading"
              ? "uploading"
              : attachment.status === "error"
                ? "failed"
                : formatAttachmentSize(attachment.size)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0 rounded-md text-muted-foreground opacity-80"
            onClick={() => onRemove(attachment.id)}
            aria-label={`Remove ${attachment.name}`}
          >
            <XIcon className="size-3.5" strokeWidth={1.7} />
          </Button>
        </div>
      ))}
    </div>
  );
}
