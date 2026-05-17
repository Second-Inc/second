import { NextResponse } from "next/server";
import {
  buildWorkspaceCookie,
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  listAppsVisibleToWorkspaceContext,
} from "@/lib/auth";
import { PUBLIC_URL } from "@/lib/config";
import {
  createAppForWorkspace,
  createRun,
  createWorkspaceAgentRunSnapshot,
  findRunnableWorkspaceAgentForViewer,
  getAppPublishStatus,
  resolveRuntimeSkillsForViewer,
  setRunPendingAttachments,
} from "@/lib/db";
import {
  DEFAULT_RUNTIME_SETTINGS,
  parseRuntimeSettings,
} from "@/lib/agent/runtime-registry";
import { generateAndUpdateAppMetadata } from "@/lib/app-metadata";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import { validateAppName } from "@/lib/validation";
import {
  createWorkspaceResourceViewer,
  normalizeStringList,
} from "@/lib/workspace-resources";
import {
  isUploadedAttachmentFile,
  parseAttachmentIds,
  prepareBuilderAttachmentFiles,
  uploadPreparedBuilderAttachmentsToWorker,
  type BuilderAttachmentFile,
} from "@/lib/builder-attachment-upload";
import { storeBuilderAttachmentPayloads } from "@/lib/builder-attachment-store";
import type { RunSkillReference } from "@/lib/db/types";

type WorkspaceAppsRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

function serializeApp(
  app: Awaited<ReturnType<typeof createAppForWorkspace>>,
  initialRun?: Awaited<ReturnType<typeof createRun>> | null,
) {
  return {
    id: app._id,
    workspaceId: app.workspaceId,
    name: app.name,
    description: app.description ?? null,
    createdByUserId: app.createdByUserId,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    publishStatus: getAppPublishStatus(app),
    teamIds: app.teamIds ?? [],
    collaboratorUserIds: app.collaboratorUserIds ?? [],
    initialRun: initialRun
      ? {
          id: initialRun._id,
          status: initialRun.status,
        }
      : null,
  };
}

function toRunSkillRefs(
  skills: Array<RunSkillReference & { bodyMarkdown?: string }>,
): RunSkillReference[] {
  return skills.map((skill) => ({
    skillId: skill.skillId,
    revisionId: skill.revisionId,
    revisionNumber: skill.revisionNumber,
    revisionHash: skill.revisionHash,
    slug: skill.slug,
    displayName: skill.displayName,
    description: skill.description,
  }));
}

function formString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseJsonRecord(value: FormDataEntryValue | null): Record<string, string> | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return undefined;
  }
}

export async function GET(
  request: Request,
  context: WorkspaceAppsRouteContext,
) {
  const { workspaceId } = await context.params;

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

  const apps = await listAppsVisibleToWorkspaceContext(workspaceContext);

  return NextResponse.json({
    items: apps.map((app) => serializeApp(app)),
  });
}

export async function POST(
  request: Request,
  context: WorkspaceAppsRouteContext,
) {
  const { workspaceId } = await context.params;

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

  const contentType = request.headers.get("content-type") ?? "";
  const isJsonRequest = contentType.includes("application/json");
  let respondWithJson = isJsonRequest;

  let appName: string | null;
  let prompt: string | undefined;
  let runtimeSettings = DEFAULT_RUNTIME_SETTINGS;
  let createInitialRun = false;
  let selectedAgentId: string | null = null;
  let selectedSkillIds: string[] = [];
  let attachmentFiles: BuilderAttachmentFile[] = [];
  let attachmentIds: string[] = [];

  if (isJsonRequest) {
    const body = (await request.json().catch(() => null)) as
      | {
          appName?: string;
          prompt?: string;
          runtimeId?: string;
          runtimeModel?: string;
          runtimeParams?: Record<string, string>;
          createInitialRun?: boolean;
          selectedAgentId?: string | null;
          selectedSkillIds?: unknown;
        }
      | null;

    appName = validateAppName(body?.appName ?? null);
    prompt = typeof body?.prompt === "string" ? body.prompt : undefined;
    const parsedRuntimeSettings = parseRuntimeSettings({
      runtimeId: body?.runtimeId,
      model: body?.runtimeModel,
      params: body?.runtimeParams,
    });
    if (!parsedRuntimeSettings) {
      return NextResponse.json(
        { error: "invalid_runtime_settings" },
        { status: 400 },
      );
    }
    runtimeSettings = parsedRuntimeSettings;
    createInitialRun = body?.createInitialRun === true;
    selectedAgentId =
      typeof body?.selectedAgentId === "string" && body.selectedAgentId.trim()
        ? body.selectedAgentId.trim()
        : null;
    selectedSkillIds = normalizeStringList(body?.selectedSkillIds, 50, 80);
  } else {
    const formData = await request.formData();
    respondWithJson = formData.get("response") === "json";
    appName = validateAppName(formData.get("appName"));
    prompt = formString(formData.get("prompt"));
    const runtimeId = formString(formData.get("runtimeId"));
    const runtimeModel = formString(formData.get("runtimeModel"));
    const runtimeParams = parseJsonRecord(formData.get("runtimeParams"));
    if (runtimeId || runtimeModel || runtimeParams) {
      const parsedRuntimeSettings = parseRuntimeSettings({
        runtimeId,
        model: runtimeModel,
        params: runtimeParams,
      });
      if (!parsedRuntimeSettings) {
        return NextResponse.json(
          { error: "invalid_runtime_settings" },
          { status: 400 },
        );
      }
      runtimeSettings = parsedRuntimeSettings;
    }
    createInitialRun = formData.get("createInitialRun") === "true";
    const formSelectedAgentId = formString(formData.get("selectedAgentId"));
    selectedAgentId = formSelectedAgentId?.trim() ? formSelectedAgentId.trim() : null;
    selectedSkillIds = normalizeStringList(
      (() => {
        const value = formString(formData.get("selectedSkillIds"));
        if (!value) return [];
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return [];
        }
      })(),
      50,
      80,
    );
    attachmentFiles = formData.getAll("files").filter(isUploadedAttachmentFile);
    attachmentIds = parseAttachmentIds(formData.get("attachmentIds"));
  }

  if (!appName) {
    if (respondWithJson) {
      return NextResponse.json({ error: "invalid_app_name" }, { status: 400 });
    }

    return NextResponse.redirect(
      new URL(
        `/w/${workspaceContext.workspaceId}?error=invalid_app_name`,
        PUBLIC_URL,
      ),
      303,
    );
  }
  if (attachmentFiles.length > 0 && !createInitialRun) {
    return NextResponse.json(
      { error: "attachments_require_initial_run" },
      { status: 400 },
    );
  }

  const viewer = await createWorkspaceResourceViewer(workspaceContext);
  const selectedAgent = selectedAgentId
    ? await findRunnableWorkspaceAgentForViewer({
        workspaceId: workspaceContext.workspaceId,
        agentId: selectedAgentId,
        viewer,
      })
    : null;
  if (selectedAgentId && !selectedAgent) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  const runtimeSkillIds = selectedAgent
    ? [
        ...new Set([
          ...selectedAgent.selectedSkillIds,
          ...selectedSkillIds,
        ]),
      ]
    : selectedSkillIds;
  const runtimeSkills = await resolveRuntimeSkillsForViewer({
    workspaceId: workspaceContext.workspaceId,
    skillIds: runtimeSkillIds,
    viewer,
    requirePublished: true,
  });
  if (!runtimeSkills) {
    return NextResponse.json({ error: "skill_not_found" }, { status: 404 });
  }
  const selectedSkillRefs = toRunSkillRefs(runtimeSkills);

  const app = await createAppForWorkspace({
    workspaceId: workspaceContext.workspaceId,
    name: appName,
    createdByUserId: workspaceContext.user._id,
    prompt,
    runtimeId: runtimeSettings.runtimeId,
    runtimeModel: runtimeSettings.model,
    runtimeParams: runtimeSettings.params,
  });
  const metadataPrompt = prompt?.trim();
  if (metadataPrompt) {
    console.info(
      `[apps] metadata task scheduled appId=${app._id} workspaceId=${workspaceContext.workspaceId} runtime=${runtimeSettings.runtimeId} model=${runtimeSettings.model}`,
    );
    void generateAndUpdateAppMetadata({
      workspaceId: workspaceContext.workspaceId,
      appId: app._id,
      prompt: metadataPrompt,
      fallbackName: app.name,
      runtimeSettings,
    });
  }
  const initialRun = createInitialRun
    ? await createRun({
        appId: app._id,
        workspaceId: workspaceContext.workspaceId,
        mode: selectedAgent ? "workspace_agent" : "builder",
        selectedSkillRefs,
        workspaceAgentSnapshot: selectedAgent
          ? createWorkspaceAgentRunSnapshot({
              agent: selectedAgent,
              selectedSkillRefs,
            })
          : null,
      })
    : null;

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app.created",
    category: "apps",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId: app._id,
      appName: app.name,
    }),
    target: { type: "app", id: app._id, name: app.name },
    action: "created",
    summary: `Created app ${app.name}.`,
    metadata: {
      runtimeId: app.runtimeId,
      runtimeModel: app.runtimeModel,
      createdInitialRun: Boolean(initialRun),
    },
    relatedIds: {
      appId: app._id,
      runId: initialRun?._id,
    },
  });

  if (initialRun) {
    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "builder_run.created",
      category: "apps",
      severity: "info",
      outcome: "started",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        appId: app._id,
        appName: app.name,
        runId: initialRun._id,
      }),
      target: { type: "run", id: initialRun._id, parentType: "app", parentId: app._id },
      action: "created",
      summary: `Created initial builder run for ${app.name}.`,
      metadata: {
        status: initialRun.status,
        messageCount: initialRun.messages.length,
      },
      relatedIds: {
        appId: app._id,
        runId: initialRun._id,
      },
    });
  }

  if (attachmentFiles.length > 0 && initialRun) {
    const prepared = await prepareBuilderAttachmentFiles({
      appId: app._id,
      files: attachmentFiles,
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
      appId: app._id,
      runId: initialRun._id,
      files: prepared.files,
    });

    const upload = await uploadPreparedBuilderAttachmentsToWorker({
      appId: app._id,
      files: prepared.files,
    });
    if (!upload.ok) {
      return NextResponse.json(
        { error: upload.error },
        { status: upload.status },
      );
    }

    const updated = await setRunPendingAttachments({
      runId: initialRun._id,
      workspaceId: workspaceContext.workspaceId,
      appId: app._id,
      attachments: upload.attachments,
    });
    if (!updated) {
      return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    }

    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "builder_attachments.uploaded",
      category: "apps",
      severity: "info",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        appId: app._id,
        appName: app.name,
        runId: initialRun._id,
      }),
      target: { type: "app", id: app._id, name: app.name },
      action: "uploaded",
      summary: `Uploaded ${upload.attachments.length} builder attachment${
        upload.attachments.length === 1 ? "" : "s"
      } for ${app.name}.`,
      metadata: {
        fileCount: upload.attachments.length,
        totalBytes: upload.totalBytes,
        fileExtensions: upload.fileExtensions,
      },
      relatedIds: {
        appId: app._id,
        runId: initialRun._id,
      },
    });
  }

  if (respondWithJson) {
    const response = NextResponse.json(serializeApp(app, initialRun), { status: 201 });

    response.cookies.set(
      buildWorkspaceCookie({
        headers: request.headers,
        url: request.url,
        workspaceId: workspaceContext.workspaceId,
      }),
    );

    return response;
  }

  const response = NextResponse.redirect(
    new URL(`/w/${workspaceContext.workspaceId}`, PUBLIC_URL),
    303,
  );

  response.cookies.set(
    buildWorkspaceCookie({
      headers: request.headers,
      url: request.url,
      workspaceId: workspaceContext.workspaceId,
    }),
  );

  return response;
}
