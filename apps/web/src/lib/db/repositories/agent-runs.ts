import { ObjectId } from "mongodb";
import { getAgentRunsCollection } from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import { parseDoneBuildingOutput } from "@/lib/agent/done-building";
import { buildRunUsageIncrements, type RawRunUsageIncrement } from "./run-usage";
import type {
  AgentRunDocument,
  AgentRunRecoveryContext,
  BuilderAttachmentReference,
  ProviderSessionState,
  RunUsage,
} from "@/lib/db/types";

export type LatestRunState = {
  status: AgentRunDocument["status"];
  toolRecoveryStatus: "fixing" | null;
};

function runReasonFromRecoveryContext(
  recoveryContext: AgentRunRecoveryContext | null | undefined,
): "app_tool_failure" | undefined {
  return recoveryContext?.type === "app_tool_failure"
    ? "app_tool_failure"
    : undefined;
}

function toolRecoveryStatusFromRun(
  run: Pick<AgentRunDocument, "status" | "recoveryContext">,
): LatestRunState["toolRecoveryStatus"] {
  return run.recoveryContext?.type === "app_tool_failure" &&
    (run.status === "pending" || run.status === "streaming")
    ? "fixing"
    : null;
}

export async function createRun(input: {
  appId: string;
  workspaceId: string;
  mode?: AgentRunDocument["mode"];
  selectedSkillRefs?: AgentRunDocument["selectedSkillRefs"];
  workspaceAgentSnapshot?: AgentRunDocument["workspaceAgentSnapshot"];
  autoStartPrompt?: string | null;
  recoveryContext?: AgentRunRecoveryContext | null;
}): Promise<AgentRunDocument> {
  const collection = await getAgentRunsCollection();
  const now = new Date();
  const run: AgentRunDocument = {
    _id: new ObjectId().toHexString(),
    appId: input.appId,
    workspaceId: input.workspaceId,
    mode: input.mode ?? "builder",
    selectedSkillRefs: input.selectedSkillRefs ?? [],
    workspaceAgentSnapshot: input.workspaceAgentSnapshot ?? null,
    attachments: [],
    pendingAttachments: [],
    messages: [],
    sessionState: null,
    activeStreamId: null,
    status: "pending",
    usage: null,
    autoStartPrompt: input.autoStartPrompt ?? null,
    recoveryContext: input.recoveryContext ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await collection.insertOne(run);
  publishWorkspaceEvent({
    type: "run.created",
    workspaceId: input.workspaceId,
    scope: "agent-runs",
    appId: input.appId,
    runId: run._id,
    runStatus: run.status,
    runReason: runReasonFromRecoveryContext(run.recoveryContext),
  });
  return run;
}

export async function loadRun(
  runId: string,
  workspaceId: string,
): Promise<AgentRunDocument | null> {
  const collection = await getAgentRunsCollection();
  return collection.findOne({ _id: runId, workspaceId });
}

export async function loadRunForApp(
  runId: string,
  workspaceId: string,
  appId: string,
): Promise<AgentRunDocument | null> {
  const collection = await getAgentRunsCollection();
  return collection.findOne({ _id: runId, workspaceId, appId });
}

export async function loadRunStreamStateForApp(
  runId: string,
  workspaceId: string,
  appId: string,
): Promise<
  Pick<AgentRunDocument, "_id" | "status" | "activeStreamId" | "updatedAt"> | null
> {
  const collection = await getAgentRunsCollection();
  return collection.findOne(
    { _id: runId, workspaceId, appId },
    { projection: { _id: 1, status: 1, activeStreamId: 1, updatedAt: 1 } },
  );
}

export async function startRunStream(
  input: {
    runId: string;
    workspaceId: string;
    appId: string;
    messages: unknown[];
    activeStreamId: string | null;
    attachments?: BuilderAttachmentReference[];
    recoveryContext?: AgentRunRecoveryContext | null;
  },
): Promise<boolean> {
  const collection = await getAgentRunsCollection();
  const hasRecoveryContextInput = Object.prototype.hasOwnProperty.call(
    input,
    "recoveryContext",
  );
  const run = await collection.findOne(
    { _id: input.runId, workspaceId: input.workspaceId, appId: input.appId },
    { projection: { recoveryContext: 1 } },
  );
  const effectiveRecoveryContext = hasRecoveryContextInput
    ? input.recoveryContext
    : run?.recoveryContext;
  const $set: Record<string, unknown> = {
    messages: input.messages,
    activeStreamId: input.activeStreamId,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(hasRecoveryContextInput
      ? { recoveryContext: input.recoveryContext ?? null }
      : {}),
    pendingAttachments: [],
    // Mark eagerly before consumeSseStream assigns the streamId. Tabs opening
    // during the request should see that a stream is in progress, but stale
    // back/forward POSTs must not overwrite a completed run with old messages.
    status: "streaming",
    updatedAt: new Date(),
  };
  const result = await collection.updateOne(
    {
      _id: input.runId,
      workspaceId: input.workspaceId,
      appId: input.appId,
      $or: [
        { status: "pending" },
        {
          status: { $in: ["completed", "failed"] },
          $expr: {
            $lt: [{ $size: "$messages" }, input.messages.length],
          },
        },
      ],
    },
    { $set },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "run.starting",
      workspaceId: input.workspaceId,
      scope: "agent-runs",
      appId: input.appId,
      runId: input.runId,
      runStatus: "streaming",
      runReason: runReasonFromRecoveryContext(effectiveRecoveryContext),
    });
  }
  return result.modifiedCount > 0;
}

export async function scheduleRunAutoStart(input: {
  runId: string;
  workspaceId: string;
  appId: string;
  autoStartPrompt: string;
  recoveryContext?: AgentRunRecoveryContext | null;
}): Promise<boolean> {
  const collection = await getAgentRunsCollection();
  const hasRecoveryContextInput = Object.prototype.hasOwnProperty.call(
    input,
    "recoveryContext",
  );
  const $set: Record<string, unknown> = {
    autoStartPrompt: input.autoStartPrompt,
    status: "pending",
    activeStreamId: null,
    updatedAt: new Date(),
    ...(hasRecoveryContextInput
      ? { recoveryContext: input.recoveryContext ?? null }
      : {}),
  };
  const result = await collection.updateOne(
    {
      _id: input.runId,
      workspaceId: input.workspaceId,
      appId: input.appId,
      status: { $ne: "streaming" },
    },
    { $set },
  );

  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "run.autostart_scheduled",
      workspaceId: input.workspaceId,
      scope: "agent-runs",
      appId: input.appId,
      runId: input.runId,
      runStatus: "pending",
      runReason: runReasonFromRecoveryContext(input.recoveryContext),
    });
  }

  return result.modifiedCount > 0;
}

export async function setRunPendingAttachments(input: {
  runId: string;
  workspaceId: string;
  appId: string;
  attachments: BuilderAttachmentReference[];
}): Promise<boolean> {
  const collection = await getAgentRunsCollection();
  const result = await collection.updateOne(
    {
      _id: input.runId,
      workspaceId: input.workspaceId,
      appId: input.appId,
    },
    {
      $set: {
        pendingAttachments: input.attachments,
        attachments: input.attachments,
        updatedAt: new Date(),
      },
    },
  );
  return result.matchedCount > 0;
}

export async function setRunActiveStream(
  runId: string,
  activeStreamId: string,
): Promise<boolean> {
  const collection = await getAgentRunsCollection();
  const run = await collection.findOne(
    { _id: runId },
    { projection: { workspaceId: 1, appId: 1, recoveryContext: 1 } },
  );
  const result = await collection.updateOne(
    { _id: runId, status: "streaming" },
    {
      $set: {
        activeStreamId,
        updatedAt: new Date(),
      },
    },
  );
  if (result.modifiedCount > 0 && run) {
    publishWorkspaceEvent({
      type: "run.stream_ready",
      workspaceId: run.workspaceId,
      scope: "agent-runs",
      appId: run.appId,
      runId,
      runStatus: "streaming",
      runReason: runReasonFromRecoveryContext(run.recoveryContext),
    });
  }
  return result.modifiedCount > 0;
}

export async function completeRun(
  runId: string,
  messages: unknown[],
): Promise<void> {
  const collection = await getAgentRunsCollection();
  const run = await collection.findOne(
    { _id: runId },
    { projection: { workspaceId: 1, appId: 1, recoveryContext: 1 } },
  );
  await collection.updateOne(
    { _id: runId },
    {
      $set: {
        messages,
        activeStreamId: null,
        status: "completed" as const,
        updatedAt: new Date(),
      },
    },
  );
  if (run) {
    publishWorkspaceEvent({
      type: "run.completed",
      workspaceId: run.workspaceId,
      scope: "agent-runs",
      appId: run.appId,
      runId,
      runStatus: "completed",
      runReason: runReasonFromRecoveryContext(run.recoveryContext),
    });
  }
}

export async function failRun(
  runId: string,
  messages: unknown[],
): Promise<void> {
  const collection = await getAgentRunsCollection();
  const run = await collection.findOne(
    { _id: runId },
    { projection: { workspaceId: 1, appId: 1, recoveryContext: 1 } },
  );
  await collection.updateOne(
    { _id: runId },
    {
      $set: {
        messages,
        activeStreamId: null,
        status: "failed" as const,
        updatedAt: new Date(),
      },
    },
  );
  if (run) {
    publishWorkspaceEvent({
      type: "run.failed",
      workspaceId: run.workspaceId,
      scope: "agent-runs",
      appId: run.appId,
      runId,
      runStatus: "failed",
      runReason: runReasonFromRecoveryContext(run.recoveryContext),
    });
  }
}

export async function saveRunSessionState(
  runId: string,
  state: ProviderSessionState,
  options?: { uiMessageCount?: number },
): Promise<void> {
  const collection = await getAgentRunsCollection();
  const stateWithMetadata: ProviderSessionState =
    typeof options?.uiMessageCount === "number"
      ? {
          ...state,
          metadata: {
            ...state.metadata,
            uiMessageCount: options.uiMessageCount,
          },
        }
      : state;

  await collection.updateOne(
    { _id: runId },
    {
      $set: {
        sessionState: stateWithMetadata,
        [`runtimeSessionStates.${state.runtimeId}`]: stateWithMetadata,
        updatedAt: new Date(),
      },
    },
  );
}

export async function getActiveStreamId(
  runId: string,
): Promise<string | null> {
  const collection = await getAgentRunsCollection();
  const run = await collection.findOne(
    { _id: runId },
    { projection: { activeStreamId: 1, status: 1 } },
  );
  // Never return a stream ID for a completed/failed run — prevents
  // resume from replaying data that's already in initialMessages.
  if (!run || run.status !== "streaming") return null;
  return run.activeStreamId ?? null;
}

export async function getLatestRun(
  appId: string,
  workspaceId: string,
): Promise<AgentRunDocument | null> {
  const collection = await getAgentRunsCollection();
  return collection.findOne(
    { appId, workspaceId },
    { sort: { createdAt: -1 } },
  );
}

export async function listLatestRunStatusesForWorkspace(
  workspaceId: string,
): Promise<Record<string, AgentRunDocument["status"]>> {
  const states = await listLatestRunStatesForWorkspace(workspaceId);
  return Object.fromEntries(
    Object.entries(states).map(([appId, state]) => [appId, state.status]),
  );
}

export async function listLatestRunStatesForWorkspace(
  workspaceId: string,
): Promise<Record<string, LatestRunState>> {
  const collection = await getAgentRunsCollection();
  const rows = await collection
    .aggregate<{
      _id: string;
      status: AgentRunDocument["status"];
      recoveryContext?: AgentRunRecoveryContext | null;
    }>([
      { $match: { workspaceId } },
      { $sort: { appId: 1, createdAt: -1 } },
      {
        $group: {
          _id: "$appId",
          status: { $first: "$status" },
          recoveryContext: { $first: "$recoveryContext" },
        },
      },
    ])
    .toArray();

  return Object.fromEntries(
    rows.map((row) => [
      row._id,
      {
        status: row.status,
        toolRecoveryStatus: toolRecoveryStatusFromRun(row),
      },
    ]),
  );
}

export async function listRunsForApp(
  appId: string,
  workspaceId: string,
): Promise<AgentRunDocument[]> {
  const collection = await getAgentRunsCollection();
  return collection
    .find({ appId, workspaceId })
    .sort({ createdAt: -1 })
    .toArray();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function doneBuildingSummariesFromMessages(messages: unknown[]): string[] {
  const summaries: string[] = [];

  for (const message of messages) {
    const record = asRecord(message);
    const parts = record?.parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      const partRecord = asRecord(part);
      if (
        partRecord?.type !== "dynamic-tool" ||
        partRecord.toolName !== "mcp__second__done_building" ||
        partRecord.state !== "output-available" ||
        partRecord.preliminary === true
      ) {
        continue;
      }

      const payload = parseDoneBuildingOutput(partRecord.output);
      const summary = payload?.status === "complete"
        ? payload.summary?.trim().replace(/\s+/g, " ")
        : null;
      if (summary) summaries.push(summary.slice(0, 500));
    }
  }

  return summaries;
}

export async function listDoneBuildingSummariesForApp(input: {
  workspaceId: string;
  appId: string;
}): Promise<string[]> {
  const collection = await getAgentRunsCollection();
  const runs = await collection
    .find(
      {
        workspaceId: input.workspaceId,
        appId: input.appId,
        status: "completed",
        $or: [{ mode: "builder" }, { mode: { $exists: false } }],
      },
      { projection: { messages: 1, createdAt: 1 } },
    )
    .sort({ createdAt: 1 })
    .toArray();

  return runs.flatMap((run) => doneBuildingSummariesFromMessages(run.messages));
}

/**
 * Accumulates usage from a single query() result into the run's usage totals.
 * Called after each stream completes. Uses $inc for atomic accumulation so
 * concurrent calls (unlikely but possible) don't clobber each other.
 */
export async function accumulateRunUsage(
  runId: string,
  queryUsage: RawRunUsageIncrement,
): Promise<void> {
  const collection = await getAgentRunsCollection();

  // First ensure the usage object exists (idempotent)
  await collection.updateOne(
    { _id: runId, usage: null },
    {
      $set: {
        usage: {
          totalCostUsd: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheReadTokens: 0,
          totalCacheCreationTokens: 0,
          byModel: {},
        } satisfies RunUsage,
      },
    },
  );

  const $inc = buildRunUsageIncrements(queryUsage);

  await collection.updateOne(
    { _id: runId },
    { $inc, $set: { updatedAt: new Date() } },
  );
}
