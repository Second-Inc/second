import { after, NextResponse } from "next/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  type UIMessage,
} from "ai";
import { createResumableStreamContext } from "resumable-stream";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import {
  accumulateRunUsage,
  completeRun,
  failRun,
  findWorkspaceById,
  findRunnableWorkspaceAgentForViewer,
  getAppSourceFiles,
  loadRuntimeSkillsByRefs,
  loadRunForApp,
  markAppDraftEdited,
  markPendingAppReviewRequestSuperseded,
  saveAppSourceFiles,
  saveRunSessionState,
  setRunActiveStream,
  startRunStream,
  resolveRuntimeSkillsForViewer,
} from "@/lib/db";
import { isWorkerRestoreNeeded, streamFromWorker } from "@/lib/agent/worker-bridge";
import { tryReadAgentsJsonSnapshot } from "@/lib/agents/agents-governance";
import { parseRuntimeSettings } from "@/lib/agent/runtime-registry";
import {
  buildRuntimePrompt,
  getRuntimePromptHandoffDebug,
  providerSessionCoveredMessageCount,
} from "@/lib/agent/conversation-handoff";
import {
  findMissingWorkerAttachments,
  uploadPreparedBuilderAttachmentsToWorker,
} from "@/lib/builder-attachment-upload";
import { loadStoredBuilderAttachmentPayloads } from "@/lib/builder-attachment-store";
import { getSystemPrompt } from "@/lib/agent/system-prompt";
import {
  appendSelectedSkillGuidance,
  getWorkspaceAgentSystemPrompt,
} from "@/lib/agent/workspace-agent-prompt";
import { appendOnboardingContextSection } from "@/lib/agent/onboarding-context-prompt";
import { getRedisClient, runEventsChannel } from "@/lib/redis";
import { getWorkerUrl } from "@/lib/worker-client";
import { createWorkspaceResourceViewer } from "@/lib/workspace-resources";
import {
  captureRunReplayStream,
  markRunReplayTerminal,
  resetRunReplayBuffer,
} from "@/lib/streams/run-replay";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import { auditSha256 } from "@/lib/audit/redaction";
import type {
  BuilderAttachmentReference,
  ProviderSessionState,
} from "@/lib/db/types";

type ChatRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
    runId: string;
  }>;
};

const REVIEW_INVALIDATED_HEADER = "x-second-review-invalidated";
const DRAFT_CREATED_HEADER = "x-second-draft-created";
const REVIEW_INVALIDATED_MESSAGE =
  "This app changed after it was sent for review. The review was closed automatically; send it for review again when it is ready.";

function sourceSnapshotMetadata(sourceFiles: Record<string, string>) {
  return {
    fileCount: Object.keys(sourceFiles).length,
    sizeBytes: Object.values(sourceFiles).reduce(
      (total, content) => total + Buffer.byteLength(content, "utf-8"),
      0,
    ),
    hash: auditSha256(sourceFiles),
    hasPreviewArtifact: Boolean(
      sourceFiles["dist/index.html"] ??
        sourceFiles["index.html"] ??
        sourceFiles["src/App.tsx"] ??
        sourceFiles["src/main.tsx"],
    ),
  };
}

function normalizeBuilderAttachments(value: unknown): BuilderAttachmentReference[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 10).flatMap((item): BuilderAttachmentReference[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const size =
      typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0
        ? record.size
        : null;
    const contentType =
      typeof record.contentType === "string" ? record.contentType.trim() : undefined;

    if (
      !id ||
      !name ||
      size === null ||
      !path.startsWith("attachments/") ||
      path.split("/").includes("..") ||
      path.includes("\0")
    ) {
      return [];
    }

    return [{
      id,
      name,
      path,
      size,
      ...(contentType ? { contentType } : {}),
    }];
  });
}

function attachmentPromptValue(value: string): string {
  return value.replace(/[\r\n`]/g, " ").replace(/\s+/g, " ").slice(0, 160);
}

function appendAttachedFilesSystemPromptSection(
  systemPrompt: string,
  attachments: BuilderAttachmentReference[],
): string {
  if (attachments.length === 0) return systemPrompt;

  const fileLines = attachments.map((file) =>
    `- path: \`${attachmentPromptValue(file.path)}\`; original name: ${attachmentPromptValue(file.name)}; size: ${file.size} bytes${file.contentType ? `; content type: ${attachmentPromptValue(file.contentType)}` : ""}`,
  );

  return `${systemPrompt}\n\n## Attached files\nThe user attached files in this conversation. They are already uploaded into your current working directory.\n\nUse these exact cwd-relative paths when relevant:\n${fileLines.join("\n")}\n\nImportant attachment handling rules:\n- Start by opening the exact \`path\` value above, relative to your current working directory.\n- Do not prefix attachment paths with guessed roots such as \`/root/app\`, \`/workspace\`, or \`/app\`.\n- Do not run a broad filesystem search for an attached file unless the exact cwd-relative path above fails.\n- Do not ask the user to upload the same files again.`;
}

function latestUserMessageAttachmentValue(messages: UIMessage[]): unknown {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const metadata = message.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return undefined;
    }
    return (metadata as Record<string, unknown>).attachments;
  }
  return undefined;
}

function mergeBuilderAttachments(
  ...groups: BuilderAttachmentReference[][]
): BuilderAttachmentReference[] {
  const merged = new Map<string, BuilderAttachmentReference>();
  for (const group of groups) {
    for (const attachment of group) {
      merged.set(attachment.id, attachment);
      if (merged.size >= 10) break;
    }
    if (merged.size >= 10) break;
  }
  return [...merged.values()];
}

function withLatestUserMessageAttachments(
  messages: UIMessage[],
  attachments: BuilderAttachmentReference[],
): UIMessage[] {
  if (attachments.length === 0) return messages;

  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  if (latestUserIndex < 0) return messages;

  return messages.map((message, index) => {
    if (index !== latestUserIndex) return message;
    const metadata =
      message.metadata &&
      typeof message.metadata === "object" &&
      !Array.isArray(message.metadata)
        ? (message.metadata as Record<string, unknown>)
        : {};
    const existingAttachments = normalizeBuilderAttachments(
      metadata.attachments,
    );

    return {
      ...message,
      metadata: {
        ...metadata,
        attachments: mergeBuilderAttachments(
          attachments,
          existingAttachments,
        ),
      },
    };
  });
}

function isDurableAcrossWorkerRestore(
  state: ProviderSessionState | null,
): boolean {
  if (!state) return false;
  return state.runtimeId === "claude-code" && Boolean(state.data);
}

function providerSessionLogSummary(state: ProviderSessionState | null) {
  if (!state) return null;
  return {
    runtimeId: state.runtimeId,
    sessionId: state.sessionId,
    format: state.format,
    uiMessageCount: state.metadata?.uiMessageCount ?? null,
    dataBytes:
      typeof state.data === "string"
        ? Buffer.byteLength(state.data, "utf8")
        : null,
  };
}

async function supersedePendingReview(input: {
  workspaceId: string;
  appId: string;
}): Promise<{ reviewInvalidated: boolean; draftCreatedFromPublished: boolean }> {
  const result = await markAppDraftEdited(input);
  if (result.reviewInvalidated) {
    await markPendingAppReviewRequestSuperseded({
      ...input,
      message: REVIEW_INVALIDATED_MESSAGE,
    });
  }
  return result;
}

export async function POST(request: Request, context: ChatRouteContext) {
  const { workspaceId, appId, runId } = await context.params;

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
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }
  if (!access.canCollaborate) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const app = access.app;

  const run = await loadRunForApp(runId, workspaceContext.workspaceId, appId);
  if (!run) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }
  const isWorkspaceAgentRun = run.mode === "workspace_agent";
  if (isWorkspaceAgentRun && !run.workspaceAgentSnapshot) {
    return NextResponse.json(
      { error: "workspace_agent_snapshot_missing" },
      { status: 409 },
    );
  }

  // DefaultChatTransport sends { id, messages, trigger, messageId }
  const body = (await request.json()) as {
    id: string;
    messages: UIMessage[];
    trigger: string;
    messageId?: string;
    runtimeId?: string;
    runtimeModel?: string;
    runtimeParams?: Record<string, string>;
    attachments?: unknown;
  };

  const { messages } = body;
  const runAttachments = normalizeBuilderAttachments(run.attachments);
  const pendingAttachments = normalizeBuilderAttachments(run.pendingAttachments);
  const bodyAttachments = normalizeBuilderAttachments(body.attachments);
  const messageAttachments = normalizeBuilderAttachments(
    latestUserMessageAttachmentValue(messages),
  );
  const latestUserMessageAttachments = mergeBuilderAttachments(
    bodyAttachments,
    messageAttachments,
    pendingAttachments,
  );
  const requestAttachments = mergeBuilderAttachments(
    latestUserMessageAttachments,
    runAttachments,
  );
  const messagesForRun = withLatestUserMessageAttachments(
    messages,
    latestUserMessageAttachments,
  );
  const runtimeSettings =
    parseRuntimeSettings({
      runtimeId: body.runtimeId,
      model: body.runtimeModel,
      params: body.runtimeParams,
    }) ??
    parseRuntimeSettings({
      runtimeId: app.runtimeId,
      model: app.runtimeModel,
      params: app.runtimeParams,
    });
  if (!runtimeSettings) {
    return NextResponse.json(
      { error: "invalid_runtime_settings" },
      { status: 400 },
    );
  }
  const persistedMessageCount = run.messages.length;
  const hasNewInput =
    run.status === "pending" || messages.length > persistedMessageCount;
  const hasNewBuilderInput = hasNewInput && !isWorkspaceAgentRun;
  const viewer = await createWorkspaceResourceViewer(workspaceContext);
  const selectedSkillIds = (run.selectedSkillRefs ?? []).map(
    (ref) => ref.skillId,
  );
  if (selectedSkillIds.length > 0) {
    const visibleSkills = await resolveRuntimeSkillsForViewer({
      workspaceId: workspaceContext.workspaceId,
      skillIds: selectedSkillIds,
      viewer,
      requirePublished: true,
    });
    if (!visibleSkills) {
      return NextResponse.json({ error: "skill_not_available" }, { status: 403 });
    }
  }
  if (isWorkspaceAgentRun && run.workspaceAgentSnapshot) {
    const runnableAgent = await findRunnableWorkspaceAgentForViewer({
      workspaceId: workspaceContext.workspaceId,
      agentId: run.workspaceAgentSnapshot.agentId,
      viewer,
    });
    if (!runnableAgent) {
      return NextResponse.json({ error: "agent_not_available" }, { status: 403 });
    }
  }
  const workerUrl = getWorkerUrl();
  if (requestAttachments.length > 0) {
    const check = await findMissingWorkerAttachments({
      workerUrl,
      appId,
      attachments: requestAttachments,
    });
    if (!check.ok) {
      return NextResponse.json(
        { error: check.error },
        { status: check.status },
      );
    }

    if (check.missing.length > 0) {
      const restoredAttachments = await loadStoredBuilderAttachmentPayloads({
        workspaceId: workspaceContext.workspaceId,
        appId,
        attachments: check.missing,
      });
      const restoredIds = new Set(
        restoredAttachments.map((attachment) => attachment.id),
      );
      const stillMissing = check.missing.filter(
        (attachment) => !restoredIds.has(attachment.id),
      );
      if (stillMissing.length > 0) {
        return NextResponse.json(
          { error: "attachment_unavailable" },
          { status: 409 },
        );
      }

      const upload = await uploadPreparedBuilderAttachmentsToWorker({
        workerUrl,
        appId,
        files: restoredAttachments,
      });
      if (!upload.ok) {
        return NextResponse.json(
          { error: upload.error },
          { status: upload.status },
        );
      }
    }
  }
  const draftEditResult = hasNewBuilderInput
    ? await supersedePendingReview({
        workspaceId: workspaceContext.workspaceId,
        appId,
      })
    : { reviewInvalidated: false, draftCreatedFromPublished: false };
  const isScheduledRecoveryStart =
    !isWorkspaceAgentRun &&
    run.status === "pending" &&
    run.recoveryContext?.type === "app_tool_failure";
  const shouldClearRecoveryContext =
    hasNewBuilderInput && !isWorkspaceAgentRun && !isScheduledRecoveryStart;

  // Claim this run for a single active stream. Route remounts during the
  // pre-stream initialization window can POST the same initial message again;
  // only the first POST should start a worker query.
  const claimedRun = await startRunStream({
    runId,
    workspaceId: workspaceContext.workspaceId,
    appId,
    messages: messagesForRun,
    activeStreamId: null,
    attachments: requestAttachments,
    ...(shouldClearRecoveryContext ? { recoveryContext: null } : {}),
  });
  if (!claimedRun) {
    const stream = createUIMessageStream({
      originalMessages: messagesForRun,
      execute: async () => {},
    });
    return createUIMessageStreamResponse({
      headers: {
        ...(draftEditResult.reviewInvalidated
          ? { [REVIEW_INVALIDATED_HEADER]: "true" }
          : {}),
        ...(draftEditResult.draftCreatedFromPublished
          ? { [DRAFT_CREATED_HEADER]: "true" }
          : {}),
      },
      stream,
    });
  }
  if (!isWorkspaceAgentRun) {
    void recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "builder_run.started",
      category: "apps",
      severity: "info",
      outcome: "started",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        kind: "builder_agent",
        trust: "internal_trusted",
        appId,
        appName: app.name,
        runId,
      }),
      target: { type: "run", id: runId, parentType: "app", parentId: appId },
      action: "started",
      summary: `Started builder run for ${app.name}.`,
      metadata: {
        messageCount: messages.length,
        persistedMessageCount,
        runtimeId: runtimeSettings.runtimeId,
        runtimeModel: runtimeSettings.model,
      },
      relatedIds: { appId, runId },
    });
  }
  if (hasNewBuilderInput) {
    void recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "builder_message.submitted",
      category: "apps",
      severity: "info",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        kind: "web_server",
        trust: "server_trusted",
        appId,
        appName: app.name,
        runId,
      }),
      target: { type: "run", id: runId, parentType: "app", parentId: appId },
      action: "submitted",
      summary: `Submitted builder message for ${app.name}.`,
      metadata: {
        messageCount: messages.length,
        previousMessageCount: persistedMessageCount,
      },
      relatedIds: { appId, runId },
    });
  }
  if (draftEditResult.reviewInvalidated) {
    void recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "review.superseded",
      category: "reviews",
      severity: "notice",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        appId,
        appName: app.name,
        runId,
      }),
      target: { type: "app", id: appId, name: app.name },
      action: "superseded",
      summary: `Superseded pending review for ${app.name} because the draft changed.`,
      metadata: {
        reason: "builder_message_submitted",
      },
      relatedIds: { appId, runId },
    });
  }
  await resetRunReplayBuffer(runId).catch(() => {});

  // Conditional hydration: only load/send source files when the worker reports
  // that the workspace needs restoration (cold start, recycled container, etc.).
  const restoreNeeded = !isWorkspaceAgentRun
    ? await isWorkerRestoreNeeded(workerUrl, appId)
    : false;
  const existingSourceFiles = restoreNeeded
    ? await getAppSourceFiles({
        workspaceId: workspaceContext.workspaceId,
        appId,
      })
    : null;

  const persistedSessionState =
    run.runtimeSessionStates?.[runtimeSettings.runtimeId] ??
    (run.sessionState?.runtimeId === runtimeSettings.runtimeId
      ? run.sessionState
      : null);
  const selectedSessionState =
    restoreNeeded && !isDurableAcrossWorkerRestore(persistedSessionState)
      ? null
      : persistedSessionState;
  const isLegacyActiveSessionState =
    selectedSessionState !== null &&
    run.sessionState?.runtimeId === selectedSessionState.runtimeId &&
    run.sessionState?.sessionId === selectedSessionState.sessionId &&
    typeof selectedSessionState.metadata?.uiMessageCount !== "number";
  const nativeHistoryMessageCount = providerSessionCoveredMessageCount(
    selectedSessionState,
    isLegacyActiveSessionState ? run.messages.length : 0,
  );
  const runtimePromptInput = {
    messages: messagesForRun,
    nativeHistoryMessageCount,
    targetRuntimeId: runtimeSettings.runtimeId,
    targetModel: runtimeSettings.model,
    conversationKind: isWorkspaceAgentRun ? "workspace_agent" : "builder",
  } as const;
  const handoffDebug = getRuntimePromptHandoffDebug(runtimePromptInput);
  const prompt = buildRuntimePrompt(runtimePromptInput);

  if (
    handoffDebug.approvalContextIncluded ||
    process.env.SECOND_AGENT_HANDOFF_TRACE === "1"
  ) {
    console.info(
      "[chat] runtime prompt handoff",
      JSON.stringify({
        workspaceId: workspaceContext.workspaceId,
        appId,
        runId,
        mode: run.mode ?? "builder",
        runStatusAtRequestStart: run.status,
        restoreNeeded,
        persistedMessageCount,
        requestMessageCount: messagesForRun.length,
        runtimeId: runtimeSettings.runtimeId,
        runtimeModel: runtimeSettings.model,
        selectedSessionState: providerSessionLogSummary(selectedSessionState),
        persistedSessionState: providerSessionLogSummary(persistedSessionState),
        handoff: handoffDebug,
      }),
    );
  }

  const workspace = await findWorkspaceById(workspaceContext.workspaceId);
  const workspaceName = workspace?.name ?? "Workspace";
  const runtimeSkills = await loadRuntimeSkillsByRefs({
    workspaceId: workspaceContext.workspaceId,
    refs: run.selectedSkillRefs ?? [],
  });
  const baseSystemPrompt = isWorkspaceAgentRun && run.workspaceAgentSnapshot
    ? getWorkspaceAgentSystemPrompt({
        workspaceId: workspaceContext.workspaceId,
        workspaceName,
        agent: run.workspaceAgentSnapshot,
        skills: runtimeSkills,
        runtimeId: runtimeSettings.runtimeId,
        runtimeModel: runtimeSettings.model,
      })
    : appendSelectedSkillGuidance({
        systemPrompt: getSystemPrompt(
          workspaceContext.workspaceId,
          workspaceName,
          undefined,
          runtimeSettings.runtimeId,
          runtimeSettings.model,
        ),
        skills: runtimeSkills,
        runtimeId: runtimeSettings.runtimeId,
      });
  const contextualSystemPrompt = appendOnboardingContextSection({
    systemPrompt: baseSystemPrompt,
    workspace,
    user: workspaceContext.user,
  });
  const systemPrompt = appendAttachedFilesSystemPromptSection(
    contextualSystemPrompt,
    requestAttachments,
  );

  const streamId = generateId();
  const runFailed = { current: false };
  let latestSessionState: ProviderSessionState | null = null;
  const workspaceAgentAllowedTools = run.workspaceAgentSnapshot
    ? [
        "Skill",
        ...run.workspaceAgentSnapshot.builtinTools.filter((tool) =>
          tool === "WebSearch" || tool === "WebFetch"
        ),
      ]
    : undefined;
  const effectiveRuntimeSettings =
    isWorkspaceAgentRun && runtimeSettings.runtimeId === "codex-cli"
      ? {
          ...runtimeSettings,
          params: {
            ...runtimeSettings.params,
            // TODO: Agents may need write access later to create helper scripts
            // or temporary files for their own work.
            sandbox: "read-only",
          },
        }
      : runtimeSettings;

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const bridgeResult = await streamFromWorker(writer, {
          workerUrl,
          appId,
          workspaceId: workspaceContext.workspaceId,
          appName: app.name,
          requestedByUserId: workspaceContext.user._id,
          requestedByUserName: workspaceContext.user.displayName,
          prompt,
          systemPrompt,
          runtimeSettings: effectiveRuntimeSettings,
          runtimeMode: isWorkspaceAgentRun ? "workspace_agent" : "builder",
          selectedSkills: runtimeSkills,
          allowedTools: isWorkspaceAgentRun ? workspaceAgentAllowedTools : undefined,
          sessionState: selectedSessionState ?? undefined,
          sourceFiles: !isWorkspaceAgentRun
            ? existingSourceFiles ?? undefined
            : undefined,
        }).catch(async (error) => {
          runFailed.current = true;
          await failRun(runId, messagesForRun);
          if (!isWorkspaceAgentRun) {
            void recordAuditEvent({
              workspaceId: workspaceContext.workspaceId,
              eventName: "builder_run.failed",
              category: "apps",
              severity: "warning",
              outcome: "failure",
              actor: auditActorFromWorkspaceContext(workspaceContext),
              source: auditSourceFromRequest(request, {
                kind: "builder_agent",
                trust: "internal_trusted",
                appId,
                appName: app.name,
                runId,
              }),
              target: {
                type: "run",
                id: runId,
                parentType: "app",
                parentId: appId,
              },
              action: "failed",
              summary: `Builder run failed for ${app.name}.`,
              metadata: {
                error:
                  error instanceof Error
                    ? error.message
                    : "Worker stream failed",
                messageCount: messages.length,
              },
              relatedIds: { appId, runId },
            });
          }
          await markRunReplayTerminal({ runId, status: "failed" }).catch(
            () => {},
          );
          redis
            .publish(runEventsChannel(runId), JSON.stringify({ type: "failed" }))
            .catch(() => {});
          writer.write({
            type: "error",
            errorText:
              error instanceof Error ? error.message : "Worker stream failed",
          });
          return null;
        });

      if (!bridgeResult) return;

      // Post-stream persistence — wrapped in try/catch so failures here
      // don't kill the already-delivered stream.
      try {
        if (bridgeResult.sessionState) {
          latestSessionState = bridgeResult.sessionState;
        }

        // Persist usage from this query() call
        if (bridgeResult.usage) {
          await accumulateRunUsage(runId, {
            totalCostUsd: bridgeResult.usage.totalCostUsd,
            modelUsage: bridgeResult.usage.modelUsage,
          });
        }

        // Persist source files if agent called done_building
        if (!isWorkspaceAgentRun && bridgeResult.sourceFiles) {
          const previousAgentsApprovalHash = app.agentsJsonApprovalHash ?? null;
          const nextAgentsSnapshot = tryReadAgentsJsonSnapshot(
            bridgeResult.sourceFiles,
          );
          const nextAgentsJsonPresent = Boolean(
            bridgeResult.sourceFiles["agents.json"]?.trim(),
          );
          const agentsApprovalBecameStale = Boolean(
            previousAgentsApprovalHash &&
              (!nextAgentsSnapshot ||
                nextAgentsSnapshot.hash !== previousAgentsApprovalHash),
          );
          await supersedePendingReview({
            workspaceId: workspaceContext.workspaceId,
            appId,
          });
          await saveAppSourceFiles({
            workspaceId: workspaceContext.workspaceId,
            appId,
            sourceFiles: bridgeResult.sourceFiles,
          });
          const snapshot = sourceSnapshotMetadata(bridgeResult.sourceFiles);
          void recordAuditEvent({
            workspaceId: workspaceContext.workspaceId,
            eventName: "app.source_snapshot.updated",
            category: "apps",
            severity: "notice",
            outcome: "success",
            actor: {
              kind: "agent",
              agentName: "Builder agent",
            },
            source: auditSourceFromRequest(request, {
              kind: "builder_agent",
              trust: "internal_trusted",
              appId,
              appName: app.name,
              runId,
            }),
            target: {
              type: "source_snapshot",
              id: appId,
              name: `${app.name} draft snapshot`,
              parentType: "app",
              parentId: appId,
            },
            action: "updated",
            summary: `Updated draft source snapshot for ${app.name}.`,
            metadata: snapshot,
            changes: {
              changedFields: [
                "draftSnapshotId",
                "draftSourceHash",
                "draftSourceSizeBytes",
              ],
              afterHash: snapshot.hash,
            },
            relatedIds: { appId, runId },
          });
          if (agentsApprovalBecameStale) {
            void recordAuditEvent({
              workspaceId: workspaceContext.workspaceId,
              eventName: "app.agents_config.stale",
              category: "agents",
              severity: "notice",
              outcome: "success",
              actor: {
                kind: "agent",
                agentName: "Builder agent",
              },
              source: auditSourceFromRequest(request, {
                kind: "builder_agent",
                trust: "internal_trusted",
                appId,
                appName: app.name,
                runId,
              }),
              target: {
                type: "agent",
                id: appId,
                name: `${app.name} agents.json`,
                parentType: "app",
                parentId: appId,
              },
              action: "stale",
              summary: `Marked app-agent runtime policy stale for ${app.name}.`,
              metadata: {
                reason: "source_snapshot_updated",
                nextAgentsJsonPresent,
                nextAgentsJsonValid: Boolean(nextAgentsSnapshot),
              },
              changes: {
                changedFields: [
                  "agentsJsonApprovalHash",
                  "agentsJsonApprovedPayload",
                ],
                beforeHash: previousAgentsApprovalHash ?? undefined,
                afterHash: nextAgentsSnapshot?.hash,
              },
              relatedIds: { appId, runId },
            });
          }
        }
      } catch (err) {
        console.error("[chat] Post-stream persistence error:", err);
      }
    },

    originalMessages: messagesForRun,

    onFinish: async ({ messages: finalMessages }) => {
      if (runFailed.current) return;
      const finalMessagesForPersistence = withLatestUserMessageAttachments(
        finalMessages,
        latestUserMessageAttachments,
      );
      if (latestSessionState) {
        try {
          await saveRunSessionState(runId, latestSessionState, {
            uiMessageCount: finalMessagesForPersistence.length,
          });
        } catch (err) {
          console.error("[chat] Session state persistence error:", err);
        }
      }
      await completeRun(runId, finalMessagesForPersistence);
      if (!isWorkspaceAgentRun) {
        void recordAuditEvent({
          workspaceId: workspaceContext.workspaceId,
          eventName: "builder_run.completed",
          category: "apps",
          severity: "info",
          outcome: "completed",
          actor: auditActorFromWorkspaceContext(workspaceContext),
          source: auditSourceFromRequest(request, {
            kind: "builder_agent",
            trust: "internal_trusted",
            appId,
            appName: app.name,
            runId,
          }),
          target: { type: "run", id: runId, parentType: "app", parentId: appId },
          action: "completed",
          summary: `Completed builder run for ${app.name}.`,
          metadata: {
            finalMessageCount: finalMessagesForPersistence.length,
            hadSessionState: Boolean(latestSessionState),
          },
          relatedIds: { appId, runId },
        });
      }
      await markRunReplayTerminal({ runId, status: "completed" }).catch(
        () => {},
      );
      // Notify other tabs that the run completed
      redis.publish(
        runEventsChannel(runId),
        JSON.stringify({ type: "completed" }),
      ).catch(() => {});
    },
  });

  const redis = getRedisClient();
  const resumableStreamContext = createResumableStreamContext({
    waitUntil: after,
    subscriber: redis.duplicate(),
    publisher: redis.duplicate(),
  });

  return createUIMessageStreamResponse({
    headers: {
      ...(draftEditResult.reviewInvalidated
        ? { [REVIEW_INVALIDATED_HEADER]: "true" }
        : {}),
      ...(draftEditResult.draftCreatedFromPublished
        ? { [DRAFT_CREATED_HEADER]: "true" }
        : {}),
    },
    stream,
    consumeSseStream: async ({ stream: sseStream }) => {
      await resumableStreamContext.createNewResumableStream(
        streamId,
        () => captureRunReplayStream({ runId, stream: sseStream }),
      );
      const streamAttached = await setRunActiveStream(runId, streamId);
      if (streamAttached) {
        // Notify other tabs that a new stream started.
        redis.publish(
          runEventsChannel(runId),
          JSON.stringify({ type: "stream_started", streamId }),
        ).catch(() => {});
      }
    },
  });
}

export async function GET(request: Request, context: ChatRouteContext) {
  const { workspaceId, appId, runId } = await context.params;
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
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }
  if (!access.canCollaborate) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }

  const run = await loadRunForApp(runId, workspaceContext.workspaceId, appId);
  if (!run) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      messages: run.messages,
      status: run.status,
      attachments: run.attachments ?? [],
      usage: run.usage,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
