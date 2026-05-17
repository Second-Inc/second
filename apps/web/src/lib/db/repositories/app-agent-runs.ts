import { ObjectId, type Filter } from "mongodb";
import { getAppAgentRunsCollection } from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import { buildRunUsageIncrements, type RawRunUsageIncrement } from "./run-usage";
import type { AppAgentRunDocument, RunUsage } from "@/lib/db/types";

export type AppAgentRunUsageSummary = {
  usage: RunUsage | null;
  runCount: number;
  completedRunCount: number;
  usageRunCount: number;
};

export type AppAgentRunListItem = Pick<
  AppAgentRunDocument,
  | "_id"
  | "agentId"
  | "agentName"
  | "prompt"
  | "status"
  | "triggeredByUserId"
  | "triggeredByUserName"
  | "sourceVersion"
  | "createdAt"
  | "updatedAt"
>;

export type AppAgentRunSummary = Pick<
  AppAgentRunDocument,
  | "_id"
  | "agentId"
  | "agentName"
  | "prompt"
  | "status"
  | "result"
  | "usage"
  | "sourceVersion"
  | "createdAt"
>;

function emptyRunUsage(): RunUsage {
  return {
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    byModel: {},
  };
}

function finiteUsageNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function addRunUsage(total: RunUsage, usage: RunUsage): void {
  total.totalCostUsd += finiteUsageNumber(usage.totalCostUsd);
  total.totalInputTokens += finiteUsageNumber(usage.totalInputTokens);
  total.totalOutputTokens += finiteUsageNumber(usage.totalOutputTokens);
  total.totalCacheReadTokens += finiteUsageNumber(usage.totalCacheReadTokens);
  total.totalCacheCreationTokens += finiteUsageNumber(
    usage.totalCacheCreationTokens,
  );

  for (const [model, modelUsage] of Object.entries(usage.byModel ?? {})) {
    const existing = total.byModel[model] ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0,
    };
    existing.inputTokens += finiteUsageNumber(modelUsage.inputTokens);
    existing.outputTokens += finiteUsageNumber(modelUsage.outputTokens);
    existing.cacheReadInputTokens += finiteUsageNumber(
      modelUsage.cacheReadInputTokens,
    );
    existing.cacheCreationInputTokens += finiteUsageNumber(
      modelUsage.cacheCreationInputTokens,
    );
    existing.costUsd += finiteUsageNumber(modelUsage.costUsd);
    total.byModel[model] = existing;
  }
}

export async function createAppAgentRun(input: {
  appId: string;
  workspaceId: string;
  sourceVersion: "draft" | "published";
  agentId: string;
  agentName: string;
  triggeredBy: {
    userId: string;
    email: string;
    displayName: string;
  };
  prompt: string;
}): Promise<AppAgentRunDocument> {
  const collection = await getAppAgentRunsCollection();
  const now = new Date();
  const doc: AppAgentRunDocument = {
    _id: new ObjectId().toHexString(),
    appId: input.appId,
    workspaceId: input.workspaceId,
    sourceVersion: input.sourceVersion,
    agentId: input.agentId,
    agentName: input.agentName,
    triggeredByUserId: input.triggeredBy.userId,
    triggeredByUserEmail: input.triggeredBy.email,
    triggeredByUserName: input.triggeredBy.displayName,
    prompt: input.prompt,
    status: "pending",
    result: null,
    messages: [],
    sessionState: null,
    activeStreamId: null,
    usage: null,
    createdAt: now,
    updatedAt: now,
  };
  await collection.insertOne(doc);
  publishWorkspaceEvent({
    type: "run.created",
    workspaceId: input.workspaceId,
    scope: "agent-runs",
    appId: input.appId,
    runId: doc._id,
    sourceVersion: doc.sourceVersion ?? "published",
    runStatus: doc.status,
  });
  return doc;
}

export async function loadAppAgentRun(
  runId: string,
  workspaceId: string,
): Promise<AppAgentRunDocument | null> {
  const collection = await getAppAgentRunsCollection();
  return collection.findOne({ _id: runId, workspaceId });
}

export async function findAppAgentRunById(
  runId: string,
): Promise<AppAgentRunDocument | null> {
  const collection = await getAppAgentRunsCollection();
  return collection.findOne({ _id: runId });
}

export async function loadAppAgentRunForApp(
  runId: string,
  workspaceId: string,
  appId: string,
): Promise<AppAgentRunDocument | null> {
  const collection = await getAppAgentRunsCollection();
  return collection.findOne({ _id: runId, workspaceId, appId });
}

export async function loadAppAgentRunSummaryForApp(
  runId: string,
  workspaceId: string,
  appId: string,
): Promise<AppAgentRunSummary | null> {
  const collection = await getAppAgentRunsCollection();
  return collection.findOne(
    { _id: runId, workspaceId, appId },
    {
      projection: {
        _id: 1,
        agentId: 1,
        agentName: 1,
        prompt: 1,
        status: 1,
        result: 1,
        usage: 1,
        sourceVersion: 1,
        createdAt: 1,
      },
    },
  ) as Promise<AppAgentRunSummary | null>;
}

export async function loadAppAgentRunStreamStateForApp(
  runId: string,
  workspaceId: string,
  appId: string,
): Promise<
  Pick<
    AppAgentRunDocument,
    "_id" | "status" | "activeStreamId" | "messages" | "sourceVersion" | "updatedAt"
  > | null
> {
  const collection = await getAppAgentRunsCollection();
  return collection.findOne(
    { _id: runId, workspaceId, appId },
    {
      projection: {
        _id: 1,
        status: 1,
        activeStreamId: 1,
        messages: 1,
        sourceVersion: 1,
        updatedAt: 1,
      },
    },
  );
}

export async function loadAppAgentRunTriggerForTool(input: {
  runId: string;
  workspaceId: string;
  appId: string;
}): Promise<
  Pick<
    AppAgentRunDocument,
    | "_id"
    | "workspaceId"
    | "appId"
    | "sourceVersion"
    | "agentId"
    | "triggeredByUserId"
    | "triggeredByUserEmail"
    | "triggeredByUserName"
  > | null
> {
  const collection = await getAppAgentRunsCollection();
  return collection.findOne(
    { _id: input.runId, workspaceId: input.workspaceId, appId: input.appId },
    {
      projection: {
        _id: 1,
        workspaceId: 1,
        appId: 1,
        sourceVersion: 1,
        agentId: 1,
        triggeredByUserId: 1,
        triggeredByUserEmail: 1,
        triggeredByUserName: 1,
      },
    },
  );
}

export async function listAppAgentRuns(
  appId: string,
  workspaceId: string,
  sourceVersion?: "draft" | "published",
): Promise<AppAgentRunListItem[]> {
  const collection = await getAppAgentRunsCollection();
  const query: Filter<AppAgentRunDocument> = { appId, workspaceId };
  if (sourceVersion === "published") {
    query.$or = [
      { sourceVersion: "published" },
      { sourceVersion: { $exists: false } },
    ];
  } else if (sourceVersion === "draft") {
    query.sourceVersion = "draft";
  }
  return collection
    .find(query, {
      projection: {
        _id: 1,
        agentId: 1,
        agentName: 1,
        prompt: 1,
        status: 1,
        triggeredByUserId: 1,
        triggeredByUserName: 1,
        sourceVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray() as Promise<AppAgentRunListItem[]>;
}

export async function listActiveAppAgentRuns(
  appId: string,
  workspaceId: string,
): Promise<AppAgentRunDocument[]> {
  const collection = await getAppAgentRunsCollection();
  return collection
    .find({
      appId,
      workspaceId,
      status: { $in: ["pending", "running", "streaming"] },
    })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function summarizeAppAgentRunUsage(
  appId: string,
  workspaceId: string,
  sourceVersion?: "draft" | "published",
): Promise<AppAgentRunUsageSummary> {
  const collection = await getAppAgentRunsCollection();
  const query: Filter<AppAgentRunDocument> = { appId, workspaceId };
  if (sourceVersion === "published") {
    query.$or = [
      { sourceVersion: "published" },
      { sourceVersion: { $exists: false } },
    ];
  } else if (sourceVersion === "draft") {
    query.sourceVersion = "draft";
  }

  const runs = await collection
    .find(query, { projection: { status: 1, usage: 1 } })
    .toArray();

  const usage = emptyRunUsage();
  let usageRunCount = 0;
  let completedRunCount = 0;

  for (const run of runs) {
    if (run.status === "completed") completedRunCount += 1;
    if (!run.usage) continue;
    usageRunCount += 1;
    addRunUsage(usage, run.usage);
  }

  return {
    usage: usageRunCount > 0 ? usage : null,
    runCount: runs.length,
    completedRunCount,
    usageRunCount,
  };
}

export async function updateAppAgentRunStatus(
  runId: string,
  status: AppAgentRunDocument["status"],
  result?: unknown,
): Promise<void> {
  const collection = await getAppAgentRunsCollection();
  const run = await collection.findOne(
    { _id: runId },
    { projection: { workspaceId: 1, appId: 1, sourceVersion: 1 } },
  );
  const $set: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };
  if (result !== undefined) {
    $set.result = result;
  }
  const updateResult = await collection.updateOne({ _id: runId }, { $set });
  if (updateResult.modifiedCount > 0 && run) {
    publishWorkspaceEvent({
      type:
        status === "completed"
          ? "run.completed"
          : status === "failed"
            ? "run.failed"
            : "run.starting",
      workspaceId: run.workspaceId,
      scope: "agent-runs",
      appId: run.appId,
      runId,
      sourceVersion: run.sourceVersion ?? "published",
      runStatus: status,
    });
  }
}

export async function startAppAgentRunStream(input: {
  runId: string;
  workspaceId: string;
  appId: string;
}): Promise<boolean> {
  const collection = await getAppAgentRunsCollection();
  const result = await collection.updateOne(
    {
      _id: input.runId,
      workspaceId: input.workspaceId,
      appId: input.appId,
      status: "pending",
    },
    {
      $set: {
        status: "streaming" as const,
        activeStreamId: null,
        updatedAt: new Date(),
      },
    },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "run.starting",
      workspaceId: input.workspaceId,
      scope: "agent-runs",
      appId: input.appId,
      runId: input.runId,
      sourceVersion:
        (await collection.findOne(
          { _id: input.runId },
          { projection: { sourceVersion: 1 } },
        ))?.sourceVersion ?? "published",
      runStatus: "streaming",
    });
  }
  return result.modifiedCount > 0;
}

export async function saveAppAgentRunMessages(
  runId: string,
  messages: unknown[],
  activeStreamId: string | null,
): Promise<void> {
  const collection = await getAppAgentRunsCollection();
  await collection.updateOne(
    { _id: runId },
    {
      $set: {
        messages,
        activeStreamId,
        updatedAt: new Date(),
      },
    },
  );
}

export async function setAppAgentRunActiveStream(
  runId: string,
  activeStreamId: string,
): Promise<boolean> {
  const collection = await getAppAgentRunsCollection();
  const run = await collection.findOne(
    { _id: runId },
    { projection: { workspaceId: 1, appId: 1, sourceVersion: 1 } },
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
      sourceVersion: run.sourceVersion ?? "published",
      runStatus: "streaming",
    });
  }
  return result.modifiedCount > 0;
}

export async function clearAppAgentRunActiveStream(
  runId: string,
  activeStreamId: string,
): Promise<boolean> {
  const collection = await getAppAgentRunsCollection();
  const result = await collection.updateOne(
    { _id: runId, activeStreamId, status: "streaming" },
    {
      $set: {
        activeStreamId: null,
        updatedAt: new Date(),
      },
    },
  );
  return result.modifiedCount > 0;
}

export async function completeAppAgentRun(
  runId: string,
  messages: unknown[],
  result: unknown,
): Promise<void> {
  const collection = await getAppAgentRunsCollection();
  const run = await collection.findOne(
    { _id: runId },
    { projection: { workspaceId: 1, appId: 1, sourceVersion: 1 } },
  );
  await collection.updateOne(
    { _id: runId },
    {
      $set: {
        messages,
        result,
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
      sourceVersion: run.sourceVersion ?? "published",
      runStatus: "completed",
    });
  }
}

export async function failAppAgentRun(
  runId: string,
  error: string,
): Promise<void> {
  const collection = await getAppAgentRunsCollection();
  const run = await collection.findOne(
    { _id: runId },
    { projection: { workspaceId: 1, appId: 1, sourceVersion: 1 } },
  );
  const result = await collection.updateOne(
    { _id: runId, status: { $in: ["pending", "running", "streaming"] } },
    {
      $set: {
        activeStreamId: null,
        status: "failed" as const,
        result: { error },
        updatedAt: new Date(),
      },
    },
  );
  if (result.modifiedCount > 0 && run) {
    publishWorkspaceEvent({
      type: "run.failed",
      workspaceId: run.workspaceId,
      scope: "agent-runs",
      appId: run.appId,
      runId,
      sourceVersion: run.sourceVersion ?? "published",
      runStatus: "failed",
    });
  }
}

export async function accumulateAppAgentRunUsage(
  runId: string,
  queryUsage: RawRunUsageIncrement,
): Promise<void> {
  const collection = await getAppAgentRunsCollection();

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

export async function getAppAgentRunActiveStreamId(
  runId: string,
): Promise<string | null> {
  const collection = await getAppAgentRunsCollection();
  const run = await collection.findOne(
    { _id: runId },
    { projection: { activeStreamId: 1, status: 1 } },
  );
  if (!run || run.status !== "streaming") return null;
  return run.activeStreamId ?? null;
}
