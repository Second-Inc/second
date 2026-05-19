import { claudeRuntimeAdapter } from "./claude.js";
import { codexCliRuntimeAdapter } from "./codex-cli.js";
import { openCodeRuntimeAdapter } from "./opencode.js";
import {
  normalizeRuntimeSettings,
  type AgentRuntimeSettings,
  type ProviderSessionState,
  type RuntimeAdapter,
  type RuntimeRunResultMessage,
} from "./types.js";
import type { SessionConfig } from "../runner.js";

const adapters: Record<RuntimeAdapter["id"], RuntimeAdapter> = {
  "claude-code": claudeRuntimeAdapter,
  "codex-cli": codexCliRuntimeAdapter,
  opencode: openCodeRuntimeAdapter,
};

export async function* runRuntimeAgent(input: {
  prompt: string;
  config: SessionConfig;
  settings: AgentRuntimeSettings;
  sessionState?: ProviderSessionState | null;
  workerBaseUrl?: string;
  signal?: AbortSignal;
}): AsyncGenerator<RuntimeRunResultMessage> {
  const settings = normalizeRuntimeSettings(input.settings);
  const adapter = adapters[settings.runtimeId];
  if (!adapter) throw new Error(`Unsupported runtime: ${settings.runtimeId}`);

  yield* adapter.run({
    prompt: input.prompt,
    config: input.config,
    settings,
    sessionState: input.sessionState,
    workerBaseUrl: input.workerBaseUrl,
    signal: input.signal,
  });
}

export async function prewarmRuntimeAgent(input: {
  prompt?: string;
  config: SessionConfig;
  settings: AgentRuntimeSettings;
  sessionState?: ProviderSessionState | null;
  workerBaseUrl?: string;
}): Promise<void> {
  const settings = normalizeRuntimeSettings(input.settings);
  const adapter = adapters[settings.runtimeId];
  if (!adapter?.prewarm) return;

  await adapter.prewarm({
    prompt: input.prompt ?? "",
    config: input.config,
    settings,
    sessionState: input.sessionState,
    workerBaseUrl: input.workerBaseUrl,
  });
}

export {
  normalizeRuntimeSettings,
  type AgentRuntimeSettings,
  type ProviderSessionState,
};
