import { encodeUsageModelKey } from "@/lib/agent/usage-keys";

type RawModelUsageRecord = {
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadInputTokens?: unknown;
  cacheCreationInputTokens?: unknown;
  costUsd?: unknown;
  costUSD?: unknown;
};

export type RawRunUsageIncrement = {
  totalCostUsd?: unknown;
  modelUsage?: Record<string, RawModelUsageRecord | null | undefined> | null;
};

function finiteUsageNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function firstFiniteUsageNumber(...values: unknown[]): number {
  for (const value of values) {
    const normalized = finiteUsageNumber(value);
    if (normalized > 0) return normalized;
  }
  return 0;
}

export function buildRunUsageIncrements(
  queryUsage: RawRunUsageIncrement,
): Record<string, number> {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  const perModelUsage: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUsd: number;
  }> = [];

  for (const [model, usage] of Object.entries(queryUsage.modelUsage ?? {})) {
    if (!model || !usage) continue;
    const normalized = {
      model,
      inputTokens: finiteUsageNumber(usage.inputTokens),
      outputTokens: finiteUsageNumber(usage.outputTokens),
      cacheReadInputTokens: finiteUsageNumber(usage.cacheReadInputTokens),
      cacheCreationInputTokens: finiteUsageNumber(usage.cacheCreationInputTokens),
      costUsd: firstFiniteUsageNumber(usage.costUsd, usage.costUSD),
    };

    const hasUsage =
      normalized.inputTokens > 0 ||
      normalized.outputTokens > 0 ||
      normalized.cacheReadInputTokens > 0 ||
      normalized.cacheCreationInputTokens > 0 ||
      normalized.costUsd > 0;
    if (!hasUsage) continue;

    inputTokens += normalized.inputTokens;
    outputTokens += normalized.outputTokens;
    cacheReadTokens += normalized.cacheReadInputTokens;
    cacheCreationTokens += normalized.cacheCreationInputTokens;
    perModelUsage.push(normalized);
  }

  const increments: Record<string, number> = {
    "usage.totalCostUsd": finiteUsageNumber(queryUsage.totalCostUsd),
    "usage.totalInputTokens": inputTokens,
    "usage.totalOutputTokens": outputTokens,
    "usage.totalCacheReadTokens": cacheReadTokens,
    "usage.totalCacheCreationTokens": cacheCreationTokens,
  };

  for (const usage of perModelUsage) {
    const prefix = `usage.byModel.${encodeUsageModelKey(usage.model)}`;
    increments[`${prefix}.inputTokens`] = usage.inputTokens;
    increments[`${prefix}.outputTokens`] = usage.outputTokens;
    increments[`${prefix}.cacheReadInputTokens`] = usage.cacheReadInputTokens;
    increments[`${prefix}.cacheCreationInputTokens`] =
      usage.cacheCreationInputTokens;
    increments[`${prefix}.costUsd`] = usage.costUsd;
  }

  return increments;
}
