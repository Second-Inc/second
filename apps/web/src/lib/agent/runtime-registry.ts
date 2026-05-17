export type AgentRuntimeId = "claude-code" | "codex-cli" | "opencode";

export type AgentRuntimeSettings = {
  runtimeId: AgentRuntimeId;
  model: string;
  params: Record<string, string>;
};

export type RuntimeParamOption = {
  id: string;
  name: string;
  description: string;
};

export type RuntimeParamControl = {
  id: string;
  name: string;
  description: string;
  icon: "gauge" | "brain" | "shield";
  defaultValue: string;
  options: RuntimeParamOption[];
  disabledForModelIds?: string[];
};

export type RuntimeModel = {
  id: string;
  name: string;
  description: string;
  experimental?: boolean;
};

export type RuntimeRegistryEntry = {
  id: AgentRuntimeId;
  name: string;
  shortName: string;
  description: string;
  icon?: string;
  docsUrl: string;
  detectionKey: "claudeCli" | "codexCli" | "opencodeCli";
  models: readonly RuntimeModel[];
  defaultModel: string;
  params: readonly RuntimeParamControl[];
};

const CLAUDE_DEFAULT_MODEL = "claude-opus-4-6";

export const AGENT_RUNTIMES = [
  {
    id: "claude-code",
    name: "Claude Code",
    shortName: "Claude",
    description: "Claude Code CLI and Anthropic API backed builds.",
    icon: "/icons/claude.png",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/overview",
    detectionKey: "claudeCli",
    defaultModel: CLAUDE_DEFAULT_MODEL,
    models: [
      { id: "claude-opus-4-6", name: "Opus 4.6", description: "Most capable for ambitious work" },
      { id: "claude-sonnet-4-6", name: "Sonnet 4.6", description: "Most efficient for everyday tasks" },
      { id: "claude-haiku-4-5", name: "Haiku 4.5", description: "Fastest for quick answers" },
    ],
    params: [
      {
        id: "effort",
        name: "Effort",
        description: "Reasoning effort for Claude Code.",
        icon: "gauge",
        defaultValue: "max",
        options: [
          { id: "low", name: "Low", description: "Fast, minimal reasoning" },
          { id: "medium", name: "Medium", description: "Balanced speed and quality" },
          { id: "high", name: "High", description: "Thorough, deeper reasoning" },
          { id: "max", name: "Max", description: "Maximum effort (Opus only)" },
        ],
        disabledForModelIds: ["claude-sonnet-4-6", "claude-haiku-4-5"],
      },
      {
        id: "thinking",
        name: "Thinking",
        description: "Extended thinking mode for Claude Code.",
        icon: "brain",
        defaultValue: "adaptive",
        options: [
          { id: "disabled", name: "Off", description: "No extended thinking" },
          { id: "enabled", name: "Enabled", description: "Fixed thinking budget" },
          { id: "adaptive", name: "Adaptive", description: "Model decides (Opus only)" },
        ],
        disabledForModelIds: ["claude-sonnet-4-6", "claude-haiku-4-5"],
      },
    ],
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    shortName: "Codex",
    description: "OpenAI Codex non-interactive CLI builds with Second MCP tools.",
    icon: "/icons/codex.png",
    docsUrl: "https://developers.openai.com/codex/cli/reference",
    detectionKey: "codexCli",
    defaultModel: "gpt-5.5",
    models: [
      { id: "gpt-5.5", name: "GPT-5.5", description: "Most capable Codex option for complex work" },
      { id: "gpt-5.4", name: "GPT-5.4", description: "Balanced Codex build default" },
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", description: "Faster lower-cost Codex option" },
    ],
    params: [
      {
        id: "reasoningEffort",
        name: "Reasoning",
        description: "Codex reasoning effort.",
        icon: "gauge",
        defaultValue: "high",
        options: [
          { id: "low", name: "Low", description: "Fast, lighter reasoning" },
          { id: "medium", name: "Medium", description: "Balanced speed and quality" },
          { id: "high", name: "High", description: "Deeper reasoning for app builds" },
          { id: "xhigh", name: "Extra high", description: "Maximum depth for complex work" },
        ],
      },
      {
        id: "sandbox",
        name: "Sandbox",
        description: "Codex shell sandbox policy.",
        icon: "shield",
        defaultValue: "workspace-write",
        options: [
          { id: "workspace-write", name: "Workspace write", description: "Allow edits inside the app workspace" },
          { id: "read-only", name: "Read only", description: "Inspect only; cannot build apps end to end" },
        ],
      },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    shortName: "OpenCode",
    description: "OpenCode CLI builds with scoped Second MCP tools.",
    icon: undefined,
    docsUrl: "https://opencode.ai/docs/cli/",
    detectionKey: "opencodeCli",
    defaultModel: "openai/gpt-5.4",
    models: [
      { id: "openai/gpt-5.5", name: "OpenAI GPT-5.5", description: "OpenAI through OpenCode" },
      { id: "openai/gpt-5.4", name: "OpenAI GPT-5.4", description: "OpenAI through OpenCode" },
      { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6", description: "Anthropic through OpenCode" },
    ],
    params: [],
  },
] as const satisfies readonly RuntimeRegistryEntry[];

export const DEFAULT_RUNTIME_SETTINGS: AgentRuntimeSettings = {
  runtimeId: "claude-code",
  model: CLAUDE_DEFAULT_MODEL,
  params: {
    effort: "max",
    thinking: "adaptive",
  },
};

export const PREFERRED_RUNTIME_SETTINGS_STORAGE_KEY =
  "second:preferred-runtime-settings";

export const RUNTIME_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  AGENT_RUNTIMES.map((runtime) => [runtime.id, runtime.name]),
);

export const MODEL_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  AGENT_RUNTIMES.flatMap((runtime) =>
    runtime.models.map((model) => [model.id, model.name]),
  ),
);

const MODEL_DISPLAY_NAME_ALIASES: Record<string, string> = {
  "claude-opus-4-6-20251101": "Opus 4.6",
  "claude-sonnet-4-6-20251101": "Sonnet 4.6",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "anthropic/claude-opus-4-6": "Claude Opus 4.6",
  "anthropic/claude-sonnet-4-6": "Claude Sonnet 4.6",
  "anthropic/claude-haiku-4-5": "Claude Haiku 4.5",
};

export function normalizeRuntimeModelId(model: string): string {
  const bareModel = model.replace(/^anthropic\//, "");
  if (bareModel.startsWith("claude-opus-4-6")) return "claude-opus-4-6";
  if (bareModel.startsWith("claude-sonnet-4-6")) return "claude-sonnet-4-6";
  if (bareModel.startsWith("claude-haiku-4-5")) return "claude-haiku-4-5";
  return model;
}

export function getRuntime(runtimeId: AgentRuntimeId): RuntimeRegistryEntry {
  const runtime = AGENT_RUNTIMES.find((entry) => entry.id === runtimeId);
  if (!runtime) {
    throw new Error(`Unknown runtime: ${runtimeId}`);
  }
  return runtime;
}

export function isAgentRuntimeId(value: unknown): value is AgentRuntimeId {
  return (
    typeof value === "string" &&
    AGENT_RUNTIMES.some((runtime) => runtime.id === value)
  );
}

export function findRuntimeForModel(model: string): RuntimeRegistryEntry | null {
  const normalizedModel = normalizeRuntimeModelId(model);
  return AGENT_RUNTIMES.find((runtime) =>
    runtime.models.some((candidate) => candidate.id === normalizedModel),
  ) ?? null;
}

export function getModelDisplayName(model: string): string {
  return (
    MODEL_DISPLAY_NAMES[model] ??
    MODEL_DISPLAY_NAMES[normalizeRuntimeModelId(model)] ??
    MODEL_DISPLAY_NAME_ALIASES[model] ??
    model
  );
}

export function getRuntimeModel(
  runtimeId: AgentRuntimeId,
  model: string,
): RuntimeModel | null {
  return getRuntime(runtimeId).models.find((candidate) => candidate.id === model) ?? null;
}

export function getDefaultRuntimeSettings(
  runtimeId: AgentRuntimeId = DEFAULT_RUNTIME_SETTINGS.runtimeId,
): AgentRuntimeSettings {
  const runtime = getRuntime(runtimeId);
  return normalizeRuntimeSettings({
    runtimeId,
    model: runtime.defaultModel,
    params: Object.fromEntries(
      runtime.params.map((control) => [control.id, control.defaultValue]),
    ),
  });
}

export function normalizeRuntimeSettings(
  settings: AgentRuntimeSettings,
): AgentRuntimeSettings {
  const runtime = getRuntime(settings.runtimeId);
  const model = getRuntimeModel(settings.runtimeId, settings.model)
    ? settings.model
    : runtime.defaultModel;
  const params: Record<string, string> = {};

  for (const control of runtime.params) {
    const requested = settings.params[control.id] ?? control.defaultValue;
    const option = control.options.find((candidate) => candidate.id === requested);
    const value = option ? requested : control.defaultValue;
    const disabled =
      control.disabledForModelIds?.includes(model) &&
      (control.id === "effort" ? value === "max" : value === "adaptive");
    params[control.id] = disabled ? disabledRuntimeParamFallback(control) : value;
  }

  return {
    runtimeId: settings.runtimeId,
    model,
    params,
  };
}

function disabledRuntimeParamFallback(control: RuntimeParamControl): string {
  if (control.id === "effort") return "high";
  if (control.id === "thinking") return "enabled";
  return control.defaultValue;
}

export function parseRuntimeSettings(value: unknown): AgentRuntimeSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const runtimeId = record.runtimeId;
  const model = record.model ?? record.runtimeModel;
  const params = record.params ?? record.runtimeParams;

  if (!isAgentRuntimeId(runtimeId) || typeof model !== "string") return null;

  const paramsRecord =
    params && typeof params === "object" && !Array.isArray(params)
      ? Object.fromEntries(
          Object.entries(params as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : {};

  return normalizeRuntimeSettings({
    runtimeId,
    model,
    params: paramsRecord,
  });
}

export function runtimeParamIsDisabledForModel(
  control: RuntimeParamControl,
  model: string,
  value: string,
): boolean {
  if (!control.disabledForModelIds?.includes(model)) return false;
  if (control.id === "effort") return value === "max";
  if (control.id === "thinking") return value === "adaptive";
  return false;
}

export function readPreferredRuntimeSettings(): AgentRuntimeSettings {
  if (typeof window === "undefined") return DEFAULT_RUNTIME_SETTINGS;

  try {
    const stored = window.localStorage.getItem(PREFERRED_RUNTIME_SETTINGS_STORAGE_KEY);
    const parsed = stored ? parseRuntimeSettings(JSON.parse(stored)) : null;
    return parsed ?? DEFAULT_RUNTIME_SETTINGS;
  } catch {
    return DEFAULT_RUNTIME_SETTINGS;
  }
}

export function writePreferredRuntimeSettings(settings: AgentRuntimeSettings): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      PREFERRED_RUNTIME_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeRuntimeSettings(settings)),
    );
  } catch {
    // Preference persistence is best-effort.
  }
}
