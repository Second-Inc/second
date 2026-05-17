import { DEFAULT_RUNTIME_SETTINGS, getRuntime } from "./runtime-registry";

const thinkingControl = getRuntime("claude-code").params.find(
  (control) => control.id === "thinking",
);

export const THINKING_MODES = thinkingControl?.options ?? [];

export const DEFAULT_THINKING: string =
  DEFAULT_RUNTIME_SETTINGS.params.thinking ?? "enabled";

/** Thinking modes that require a specific model */
export const OPUS_ONLY_THINKING = new Set(["adaptive"]);
