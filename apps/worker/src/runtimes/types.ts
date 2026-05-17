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
    return {
      runtimeId: "claude-code",
      model: settings.model || "claude-opus-4-6",
      params: {
        effort: settings.params.effort ?? "max",
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
    return {
      runtimeId: "opencode",
      model: settings.model || "openai/gpt-5.4",
      params: {},
    };
  }

  throw new Error(`Unsupported runtime: ${(settings as AgentRuntimeSettings).runtimeId}`);
}

export function isAgentRuntimeId(value: unknown): value is AgentRuntimeId {
  return (
    value === "claude-code" ||
    value === "codex-cli" ||
    value === "opencode"
  );
}
