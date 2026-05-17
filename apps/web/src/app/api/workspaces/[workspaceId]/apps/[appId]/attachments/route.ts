import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import {
  getLatestRun,
  loadRunForApp,
  setRunPendingAttachments,
} from "@/lib/db";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  isUploadedAttachmentFile,
  parseAttachmentIds,
  prepareBuilderAttachmentFiles,
  uploadPreparedBuilderAttachmentsToWorker,
} from "@/lib/builder-attachment-upload";
import { storeBuilderAttachmentPayloads } from "@/lib/builder-attachment-store";

export const runtime = "nodejs";

type AttachmentsRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

export async function POST(
  request: Request,
  context: AttachmentsRouteContext,
) {
  const { workspaceId, appId } = await context.params;

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) {
      return guardErrorToApiResponse(error);
    }
    throw error;
  }

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!access.canCollaborate) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const files = formData.getAll("files").filter(isUploadedAttachmentFile);
  const attachmentIds = parseAttachmentIds(formData.get("attachmentIds"));
  const runIdValue = formData.get("runId");
  const runId = typeof runIdValue === "string" && runIdValue.trim()
    ? runIdValue.trim()
    : null;
  let attachmentRunId = runId;

  if (attachmentRunId) {
    const run = await loadRunForApp(
      attachmentRunId,
      workspaceContext.workspaceId,
      appId,
    );
    if (!run) {
      return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    }
  } else {
    const latestRun = await getLatestRun(appId, workspaceContext.workspaceId);
    if (
      latestRun?.status === "pending" &&
      latestRun.messages.length === 0
    ) {
      attachmentRunId = latestRun._id;
    }
  }

  const prepared = await prepareBuilderAttachmentFiles({
    appId,
    files,
    attachmentIds,
  });
  if (!prepared.ok) {
    return NextResponse.json(
      { error: prepared.error },
      { status: prepared.status },
    );
  }

  await storeBuilderAttachmentPayloads({
    workspaceId: workspaceContext.workspaceId,
    appId,
    runId: attachmentRunId,
    files: prepared.files,
  });

  const upload = await uploadPreparedBuilderAttachmentsToWorker({
    appId,
    files: prepared.files,
  });
  if (!upload.ok) {
    return NextResponse.json(
      { error: upload.error },
      { status: upload.status },
    );
  }

  if (attachmentRunId) {
    const updated = await setRunPendingAttachments({
      runId: attachmentRunId,
      workspaceId: workspaceContext.workspaceId,
      appId,
      attachments: upload.attachments,
    });
    if (!updated) {
      return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    }
  }

  void recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "builder_attachments.uploaded",
    category: "apps",
    severity: "info",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId,
      appName: access.app.name,
    }),
    target: { type: "app", id: appId, name: access.app.name },
    action: "uploaded",
    summary: `Uploaded ${upload.attachments.length} builder attachment${
      upload.attachments.length === 1 ? "" : "s"
    } for ${access.app.name}.`,
    metadata: {
      fileCount: upload.attachments.length,
      totalBytes: upload.totalBytes,
      fileExtensions: upload.fileExtensions,
    },
    relatedIds: attachmentRunId ? { appId, runId: attachmentRunId } : { appId },
  });

  return NextResponse.json(
    { attachments: upload.attachments },
    { headers: { "Cache-Control": "no-store" } },
  );
}
