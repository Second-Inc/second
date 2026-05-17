import { DEFAULT_RUNTIME_SETTINGS, getRuntime } from "./runtime-registry";

const effortControl = getRuntime("claude-code").params.find(
  (control) => control.id === "effort",
);

export const EFFORT_LEVELS = effortControl?.options ?? [];

export const DEFAULT_EFFORT: string =
  DEFAULT_RUNTIME_SETTINGS.params.effort ?? "high";

/** Effort levels that require a specific model */
export const OPUS_ONLY_EFFORT = new Set(["max"]);
