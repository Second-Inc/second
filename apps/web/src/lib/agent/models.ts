import {
  AGENT_RUNTIMES,
  DEFAULT_RUNTIME_SETTINGS,
  MODEL_DISPLAY_NAMES,
  getModelDisplayName,
} from "./runtime-registry";

export const CLAUDE_MODELS =
  AGENT_RUNTIMES.find((runtime) => runtime.id === "claude-code")?.models ?? [];

export const DEFAULT_MODEL: string = DEFAULT_RUNTIME_SETTINGS.model;

export { MODEL_DISPLAY_NAMES, getModelDisplayName };
