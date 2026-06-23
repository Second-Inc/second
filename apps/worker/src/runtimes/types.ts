import type { SDKMessage, SessionConfig } from "../runner.js";

export type AgentRuntimeId = "claude-code" | "codex-cli" | "opencode";

export type AgentRuntimeSettings = {
  runtimeId: AgentRuntimeId;
  model: string;
  params: Record<string, string>;
};

export type ProviderSessionState = {
  runtimeId: AgentRuntimeId;
  sessionId: string | null;
  data?: string | null;
  format?: string;
  metadata?: Record<string, unknown>;
};

export type QueryUsage = {
  totalCostUsd: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  modelUsage: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUSD: number;
    }
  >;
};

export type RuntimeRunInput = {
  prompt: string;
  config: SessionConfig;
  settings: AgentRuntimeSettings;
  sessionState?: ProviderSessionState | null;
  workerBaseUrl?: string;
  signal?: AbortSignal;
};

export type RuntimeRunResultMessage = SDKMessage & {
  providerSessionState?: ProviderSessionState;
};

export type RuntimeAdapter = {
  id: AgentRuntimeId;
  prewarm?: (input: RuntimeRunInput) => Promise<void>;
  run(input: RuntimeRunInput): AsyncGenerator<RuntimeRunResultMessage>;
};

export function normalizeRuntimeSettings(
  settings: AgentRuntimeSettings,
): AgentRuntimeSettings {
  if (settings.runtimeId === "claude-code") {
    const model = settings.model || "claude-opus-4-8";
    return {
      runtimeId: "claude-code",
      model,
      params: {
        effort: normalizeClaudeEffortForModel(model, settings.params.effort),
        thinking: settings.params.thinking ?? "adaptive",
      },
    };
  }

  if (settings.runtimeId === "codex-cli") {
    return {
      runtimeId: "codex-cli",
      model: settings.model || "gpt-5.5",
      params: {
        reasoningEffort: settings.params.reasoningEffort ?? "high",
        sandbox: settings.params.sandbox ?? "workspace-write",
      },
    };
  }

  if (settings.runtimeId === "opencode") {
    const variant = settings.params.variant?.trim();
    return {
      runtimeId: "opencode",
      model: settings.model || "openai/gpt-5.5",
      params: {
        variant: variant || "auto",
      },
    };
  }

  throw new Error(`Unsupported runtime: ${(settings as AgentRuntimeSettings).runtimeId}`);
}

function normalizeClaudeEffortForModel(
  model: string,
  effort: string | undefined,
): string {
  const normalizedModel = model.trim().replace(/^anthropic\//, "");
  const isOpus48 = normalizedModel === "claude-opus-4-8" ||
    normalizedModel.startsWith("claude-opus-4-8-");

  if (!effort) return isOpus48 ? "xhigh" : "high";
  if (effort === "xhigh" && !isOpus48) return "high";

  return effort;
}

export function isAgentRuntimeId(value: unknown): value is AgentRuntimeId {
  return (
    value === "claude-code" ||
    value === "codex-cli" ||
    value === "opencode"
  );
}
