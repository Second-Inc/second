import { ObjectId } from "mongodb";
import { getAgentRunsCollection } from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import { parseDoneBuildingOutput } from "@/lib/agent/done-building";
import { buildRunUsageIncrements, type RawRunUsageIncrement } from "./run-usage";
import type {
  AgentRunFailure,
  AgentRunDocument,
  AgentRunRecoveryContext,
  AgentRunStreamLease,
  BuilderAttachmentReference,
  ProviderSessionState,
  RunUsage,
} from "@/lib/db/types";

export type LatestRunState = {
  status: AgentRunDocument["status"];
  toolRecoveryStatus: "fixing" | null;
};

export type StartRunStreamResult =
  | {
      type: "claimed";
      leaseId: string;
      recoveredStale: false;
    }
  | {
      type: "already_streaming";
      activeStreamId: string | null;
      leaseId: string | null;
      persistedMessageCount: number;
      requestMessageCount: number;
    }
  | {
      type: "stale_stream_recovered";
      activeStreamId: string | null;
      leaseId: string | null;
      failure: AgentRunFailure;
      persistedMessageCount: number;
      requestMessageCount: number;
    }
  | {
      type: "stale_input";
      runStatus: AgentRunDocument["status"];
      persistedMessageCount: number;
      requestMessageCount: number;
    }
  | { type: "not_found" };

const STARTING_STREAM_STALE_MS = 2 * 60 * 1000;
const ACTIVE_STREAM_STALE_MS = 20 * 60 * 1000;
const STREAM_HEARTBEAT_THROTTLE_MS = 20 * 1000;

function compactFailure(input: AgentRunFailure): AgentRunFailure {
  return {
    code: input.code,
    phase: input.phase,
    message: input.message.replace(/\s+/g, " ").trim().slice(0, 240),
    retryable: input.retryable,
    occurredAt: input.occurredAt,
    ...(input.reported ? { reported: input.reported } : {}),
  };
}

function newStreamLease(now = new Date()): AgentRunStreamLease {
  return {
    id: new ObjectId().toHexString(),
    startedAt: now,
    heartbeatAt: now,
  };
}

function runLeaseId(
  run: Pick<AgentRunDocument, "streamLease">,
): string | null {
  return run.streamLease?.id ?? null;
}

function expectedLeaseFilter(expectedLeaseId?: string | null) {
  if (expectedLeaseId === undefined) return {};
  if (expectedLeaseId === null) {
    return {
      $or: [
        { streamLease: null },
        { streamLease: { $exists: false } },
        { "streamLease.id": null },
      ],
    };
  }
  return { "streamLease.id": expectedLeaseId };
}

function isStreamingRunStale(
  run: Pick<
    AgentRunDocument,
    "status" | "activeStreamId" | "streamLease" | "updatedAt"
  >,
  now = new Date(),
): boolean {
  if (run.status !== "streaming") return false;

  const updatedAtMs = run.updatedAt?.getTime?.() ?? 0;
  const heartbeatAtMs =
    run.streamLease?.heartbeatAt?.getTime?.() ??
    run.streamLease?.startedAt?.getTime?.() ??
    updatedAtMs;
  const ageMs = now.getTime() - heartbeatAtMs;

  if (!run.activeStreamId) {
    return now.getTime() - updatedAtMs >= STARTING_STREAM_STALE_MS;
  }

  return ageMs >= ACTIVE_STREAM_STALE_MS;
}

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
    streamLease: null,
    failure: null,
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
  Pick<
    AgentRunDocument,
    "_id" | "status" | "activeStreamId" | "streamLease" | "failure" | "updatedAt"
  > | null
> {
  const collection = await getAgentRunsCollection();
  return collection.findOne(
    { _id: runId, workspaceId, appId },
    {
      projection: {
        _id: 1,
        status: 1,
        activeStreamId: 1,
        streamLease: 1,
        failure: 1,
        updatedAt: 1,
      },
    },
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
): Promise<StartRunStreamResult> {
  const collection = await getAgentRunsCollection();
  const now = new Date();
  const lease = newStreamLease(now);
  const hasRecoveryContextInput = Object.prototype.hasOwnProperty.call(
    input,
    "recoveryContext",
  );
  const run = await collection.findOne(
    { _id: input.runId, workspaceId: input.workspaceId, appId: input.appId },
    {
      projection: {
        status: 1,
        activeStreamId: 1,
        streamLease: 1,
        messages: 1,
        recoveryContext: 1,
        updatedAt: 1,
      },
    },
  );
  if (!run) return { type: "not_found" };

  const effectiveRecoveryContext = hasRecoveryContextInput
    ? input.recoveryContext
    : run?.recoveryContext;
  const $set: Record<string, unknown> = {
    messages: input.messages,
    activeStreamId: input.activeStreamId,
    streamLease: lease,
    failure: null,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(hasRecoveryContextInput
      ? { recoveryContext: input.recoveryContext ?? null }
      : {}),
    pendingAttachments: [],
    // Mark eagerly before consumeSseStream assigns the streamId. Tabs opening
    // during the request should see that a stream is in progress, but stale
    // back/forward POSTs must not overwrite a completed run with old messages.
    status: "streaming",
    updatedAt: now,
  };

  const publishStarting = () => {
    publishWorkspaceEvent({
      type: "run.starting",
      workspaceId: input.workspaceId,
      scope: "agent-runs",
      appId: input.appId,
      runId: input.runId,
      runStatus: "streaming",
      runReason: runReasonFromRecoveryContext(effectiveRecoveryContext),
    });
  };

  if (run.status === "streaming") {
    const persistedMessageCount = run.messages.length;
    if (isStreamingRunStale(run, now)) {
      const failure = compactFailure({
        code: "stale_stream_recovered",
        phase: "claim",
        message:
          "The previous agent stream disconnected before it could finish. Retry the message to continue.",
        retryable: true,
        occurredAt: now,
      });
      const result = await collection.updateOne(
        {
          _id: input.runId,
          workspaceId: input.workspaceId,
          appId: input.appId,
          status: "streaming",
          activeStreamId: run.activeStreamId ?? null,
          ...expectedLeaseFilter(runLeaseId(run)),
        },
        {
          $set: {
            messages: input.messages,
            activeStreamId: null,
            streamLease: null,
            failure,
            status: "failed" as const,
            updatedAt: now,
          },
        },
      );
      if (result.modifiedCount > 0) {
        publishWorkspaceEvent({
          type: "run.failed",
          workspaceId: input.workspaceId,
          scope: "agent-runs",
          appId: input.appId,
          runId: input.runId,
          runStatus: "failed",
          runReason: runReasonFromRecoveryContext(run.recoveryContext),
        });
        return {
          type: "stale_stream_recovered",
          activeStreamId: run.activeStreamId,
          leaseId: runLeaseId(run),
          failure,
          persistedMessageCount,
          requestMessageCount: input.messages.length,
        };
      }
    }

    return {
      type: "already_streaming",
      activeStreamId: run.activeStreamId ?? null,
      leaseId: runLeaseId(run),
      persistedMessageCount,
      requestMessageCount: input.messages.length,
    };
  }

  const canClaim =
    run.status === "pending" ||
    ((run.status === "completed" || run.status === "failed") &&
      run.messages.length < input.messages.length);

  if (!canClaim) {
    return {
      type: "stale_input",
      runStatus: run.status,
      persistedMessageCount: run.messages.length,
      requestMessageCount: input.messages.length,
    };
  }

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
    publishStarting();
    return {
      type: "claimed",
      leaseId: lease.id,
      recoveredStale: false,
    };
  }

  const latest = await collection.findOne(
    { _id: input.runId, workspaceId: input.workspaceId, appId: input.appId },
    {
      projection: {
        status: 1,
        activeStreamId: 1,
        streamLease: 1,
        messages: 1,
      },
    },
  );
  if (!latest) return { type: "not_found" };
  if (latest.status === "streaming") {
    return {
      type: "already_streaming",
      activeStreamId: latest.activeStreamId ?? null,
      leaseId: runLeaseId(latest),
      persistedMessageCount: latest.messages.length,
      requestMessageCount: input.messages.length,
    };
  }
  return {
    type: "stale_input",
    runStatus: latest.status,
    persistedMessageCount: latest.messages.length,
    requestMessageCount: input.messages.length,
  };
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
      streamLease: null,
      failure: null,
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
  input: {
    runId: string;
    workspaceId: string;
    appId: string;
    activeStreamId: string;
    expectedLeaseId?: string | null;
  },
): Promise<boolean> {
  const collection = await getAgentRunsCollection();
  const run = await collection.findOne(
    { _id: input.runId, workspaceId: input.workspaceId, appId: input.appId },
    { projection: { workspaceId: 1, appId: 1, recoveryContext: 1 } },
  );
  const now = new Date();
  const result = await collection.updateOne(
    {
      _id: input.runId,
      workspaceId: input.workspaceId,
      appId: input.appId,
      status: "streaming",
      ...expectedLeaseFilter(input.expectedLeaseId),
    },
    {
      $set: {
        activeStreamId: input.activeStreamId,
        "streamLease.heartbeatAt": now,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount > 0 && run) {
    publishWorkspaceEvent({
      type: "run.stream_ready",
      workspaceId: run.workspaceId,
      scope: "agent-runs",
      appId: run.appId,
      runId: input.runId,
      runStatus: "streaming",
      runReason: runReasonFromRecoveryContext(run.recoveryContext),
    });
  }
  return result.modifiedCount > 0;
}

export async function updateRunStreamHeartbeat(input: {
  runId: string;
  workspaceId: string;
  appId: string;
  expectedLeaseId?: string | null;
}): Promise<boolean> {
  const collection = await getAgentRunsCollection();
  const now = new Date();
  const throttleBefore = new Date(now.getTime() - STREAM_HEARTBEAT_THROTTLE_MS);
  const leaseFilter = expectedLeaseFilter(input.expectedLeaseId);
  const heartbeatFilter = {
    $or: [
      { "streamLease.heartbeatAt": { $exists: false } },
      { "streamLease.heartbeatAt": null },
      { "streamLease.heartbeatAt": { $lte: throttleBefore } },
    ],
  };
  const result = await collection.updateOne(
    {
      _id: input.runId,
      workspaceId: input.workspaceId,
      appId: input.appId,
      status: "streaming",
      ...(Object.prototype.hasOwnProperty.call(leaseFilter, "$or")
        ? { $and: [leaseFilter, heartbeatFilter] }
        : { ...leaseFilter, ...heartbeatFilter }),
    },
    {
      $set: {
        "streamLease.heartbeatAt": now,
        updatedAt: now,
      },
    },
  );
  return result.modifiedCount > 0;
}

export async function completeRun(
  input: {
    runId: string;
    workspaceId: string;
    appId: string;
    messages: unknown[];
    expectedLeaseId?: string | null;
  },
): Promise<boolean> {
  const collection = await getAgentRunsCollection();
  const run = await collection.findOne(
    { _id: input.runId, workspaceId: input.workspaceId, appId: input.appId },
    { projection: { workspaceId: 1, appId: 1, recoveryContext: 1 } },
  );
  const result = await collection.updateOne(
    {
      _id: input.runId,
      workspaceId: input.workspaceId,
      appId: input.appId,
      status: "streaming",
      ...expectedLeaseFilter(input.expectedLeaseId),
    },
    {
      $set: {
        messages: input.messages,
        activeStreamId: null,
        streamLease: null,
        failure: null,
        status: "completed" as const,
        updatedAt: new Date(),
      },
    },
  );
  if (result.modifiedCount > 0 && run) {
    publishWorkspaceEvent({
      type: "run.completed",
      workspaceId: run.workspaceId,
      scope: "agent-runs",
      appId: run.appId,
      runId: input.runId,
      runStatus: "completed",
      runReason: runReasonFromRecoveryContext(run.recoveryContext),
    });
  }
  return result.modifiedCount > 0;
}

export async function failRun(
  input: {
    runId: string;
    workspaceId: string;
    appId: string;
    messages: unknown[];
    expectedLeaseId?: string | null;
    failure?: AgentRunFailure;
  },
): Promise<boolean> {
  const collection = await getAgentRunsCollection();
  const run = await collection.findOne(
    { _id: input.runId, workspaceId: input.workspaceId, appId: input.appId },
    { projection: { workspaceId: 1, appId: 1, recoveryContext: 1 } },
  );
  const now = new Date();
  const failure = compactFailure(
    input.failure ?? {
      code: "unknown",
      phase: "worker_stream",
      message: "The agent run failed.",
      retryable: true,
      occurredAt: now,
    },
  );
  const result = await collection.updateOne(
    {
      _id: input.runId,
      workspaceId: input.workspaceId,
      appId: input.appId,
      status: { $ne: "completed" },
      ...expectedLeaseFilter(input.expectedLeaseId),
    },
    {
      $set: {
        messages: input.messages,
        activeStreamId: null,
        streamLease: null,
        failure,
        status: "failed" as const,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount > 0 && run) {
    publishWorkspaceEvent({
      type: "run.failed",
      workspaceId: run.workspaceId,
      scope: "agent-runs",
      appId: run.appId,
      runId: input.runId,
      runStatus: "failed",
      runReason: runReasonFromRecoveryContext(run.recoveryContext),
    });
  }
  return result.modifiedCount > 0;
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
