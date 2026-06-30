import { spawnSync } from "node:child_process";

export type OpenCodeModelSupportStatus =
  | "supported"
  | "recommended"
  | "available";

export type OpenCodeDiscoveredModel = {
  id: string;
  providerId: string;
  modelId: string;
  name: string;
  family?: string;
  status?: string;
  toolcall: boolean;
  reasoning: boolean;
  attachment: boolean;
  contextLimit?: number;
  outputLimit?: number;
  variants: string[];
  supportStatus: OpenCodeModelSupportStatus;
  supportLabel: string;
  description: string;
};

export type OpenCodeModelDiscoveryResult = {
  available: boolean;
  models: OpenCodeDiscoveredModel[];
  totalCount: number;
  filteredOutCount: number;
  refreshed: boolean;
  error?: string;
};

type RawOpenCodeModel = {
  id?: unknown;
  providerID?: unknown;
  name?: unknown;
  family?: unknown;
  status?: unknown;
  limit?: unknown;
  capabilities?: unknown;
  variants?: unknown;
};

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function jsonBraceDelta(line: string): number {
  let delta = 0;
  let inString = false;
  let escaped = false;

  for (const char of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") delta += 1;
    if (char === "}") delta -= 1;
  }

  return delta;
}

export function parseOpenCodeModelsVerbose(output: string): OpenCodeDiscoveredModel[] {
  const lines = stripAnsi(output).split(/\r?\n/);
  const models: OpenCodeDiscoveredModel[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const fullId = lines[index]?.trim() ?? "";
    if (!/^[a-z0-9_.-]+\/[^/\s]+$/i.test(fullId)) continue;

    let jsonStart = index + 1;
    while (jsonStart < lines.length && !lines[jsonStart]?.trim()) {
      jsonStart += 1;
    }
    if (lines[jsonStart]?.trim() !== "{") continue;

    const jsonLines: string[] = [];
    let depth = 0;
    let jsonEnd = jsonStart;
    for (; jsonEnd < lines.length; jsonEnd += 1) {
      const line = lines[jsonEnd] ?? "";
      jsonLines.push(line);
      depth += jsonBraceDelta(line);
      if (depth === 0) break;
    }
    index = jsonEnd;

    try {
      const raw = JSON.parse(jsonLines.join("\n")) as RawOpenCodeModel;
      const normalized = normalizeOpenCodeModel(fullId, raw);
      if (normalized) models.push(normalized);
    } catch {
      // Ignore malformed entries; a partial catalog is still useful.
    }
  }

  return models;
}

function normalizeOpenCodeModel(
  fullId: string,
  raw: RawOpenCodeModel,
): OpenCodeDiscoveredModel | null {
  const [providerIdFromLine, modelIdFromLine] = fullId.split("/");
  if (!providerIdFromLine || !modelIdFromLine) return null;

  const providerId = stringValue(raw.providerID) ?? providerIdFromLine;
  const modelId = stringValue(raw.id) ?? modelIdFromLine;
  const name = stringValue(raw.name) ?? modelIdFromLine;
  const family = stringValue(raw.family);
  const status = stringValue(raw.status);
  const capabilities = isRecord(raw.capabilities) ? raw.capabilities : {};
  const limit = isRecord(raw.limit) ? raw.limit : {};
  const variants = isRecord(raw.variants)
    ? Object.keys(raw.variants).filter(Boolean).sort(sortVariants)
    : [];
  const support = classifyOpenCodeModel({
    id: fullId,
    providerId,
    modelId,
    name,
    family,
  });

  return {
    id: fullId,
    providerId,
    modelId,
    name,
    ...(family ? { family } : {}),
    ...(status ? { status } : {}),
    toolcall: capabilities.toolcall === true,
    reasoning: capabilities.reasoning === true,
    attachment: capabilities.attachment === true,
    ...(numberValue(limit.context) !== undefined
      ? { contextLimit: numberValue(limit.context) }
      : {}),
    ...(numberValue(limit.output) !== undefined
      ? { outputLimit: numberValue(limit.output) }
      : {}),
    variants,
    supportStatus: support.status,
    supportLabel: support.label,
    description: support.description,
  };
}

function sortVariants(a: string, b: string): number {
  const order = ["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const aIndex = order.indexOf(a);
  const bIndex = order.indexOf(b);
  if (aIndex !== -1 || bIndex !== -1) {
    return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
      (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
  }
  return a.localeCompare(b);
}

function classifyOpenCodeModel(input: {
  id: string;
  providerId: string;
  modelId: string;
  name: string;
  family?: string;
}): { status: OpenCodeModelSupportStatus; label: string; description: string } {
  const haystack = `${input.id} ${input.name} ${input.family ?? ""}`.toLowerCase();

  if (input.id === "openai/gpt-5.5") {
    return {
      status: "supported",
      label: "Second tested",
      description: "Verified with Second app-building through OpenCode.",
    };
  }

  if (input.providerId === "opencode") {
    return {
      status: "supported",
      label: "OpenCode verified",
      description: "Provided through OpenCode Zen/Go curated coding models.",
    };
  }

  if (
    haystack.includes("claude") ||
    haystack.includes("gpt-5.5") ||
    haystack.includes("gpt-5.4") ||
    haystack.includes("codex")
  ) {
    return {
      status: "recommended",
      label: "Known coding model",
      description: "Popular frontier coding model exposed by OpenCode.",
    };
  }

  if (
    haystack.includes("qwen") ||
    haystack.includes("deepseek") ||
    haystack.includes("kimi") ||
    haystack.includes("glm") ||
    haystack.includes("minimax") ||
    haystack.includes("mimo") ||
    haystack.includes("nemotron")
  ) {
    return {
      status: "recommended",
      label: "Popular open model",
      description: "Popular open/open-weight coding model family.",
    };
  }

  return {
    status: "available",
    label: "Unverified",
    description: "Tool-call capable in OpenCode, but not specifically verified by Second.",
  };
}

let cachedDiscovery:
  | {
      command: string;
      value: OpenCodeModelDiscoveryResult;
      expiresAt: number;
    }
  | null = null;

export function discoverOpenCodeModels(input: {
  command: string;
  refresh?: boolean;
}): OpenCodeModelDiscoveryResult {
  const now = Date.now();
  if (
    !input.refresh &&
    cachedDiscovery?.command === input.command &&
    cachedDiscovery.expiresAt > now
  ) {
    return cachedDiscovery.value;
  }

  const args = ["models", "--verbose", ...(input.refresh ? ["--refresh"] : [])];
  const result = spawnSync(input.command, args, {
    timeout: input.refresh ? 20_000 : 10_000,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error || result.status !== 0) {
    const message = stripAnsi(
      result.error?.message ||
        `${result.stderr ?? ""}`.trim() ||
        `${result.stdout ?? ""}`.trim() ||
        "Could not list OpenCode models.",
    );
    return {
      available: false,
      models: [],
      totalCount: 0,
      filteredOutCount: 0,
      refreshed: Boolean(input.refresh),
      error: message,
    };
  }

  const parsed = parseOpenCodeModelsVerbose(result.stdout ?? "");
  const models = parsed
    .filter((model) => model.toolcall && model.status !== "deprecated")
    .sort(compareOpenCodeModels);
  const value = {
    available: true,
    models,
    totalCount: parsed.length,
    filteredOutCount: parsed.length - models.length,
    refreshed: Boolean(input.refresh),
  };

  cachedDiscovery = {
    command: input.command,
    value,
    expiresAt: now + 60_000,
  };

  return value;
}

function compareOpenCodeModels(
  a: OpenCodeDiscoveredModel,
  b: OpenCodeDiscoveredModel,
): number {
  const statusOrder: Record<OpenCodeModelSupportStatus, number> = {
    supported: 0,
    recommended: 1,
    available: 2,
  };
  const byStatus = statusOrder[a.supportStatus] - statusOrder[b.supportStatus];
  if (byStatus !== 0) return byStatus;
  const byProvider = a.providerId.localeCompare(b.providerId);
  if (byProvider !== 0) return byProvider;
  return a.name.localeCompare(b.name);
}

export function resolveOpenCodeVariant(input: {
  command: string;
  model: string;
  requested?: string;
}): string | null {
  const requested = input.requested?.trim();
  if (!requested || requested === "auto") return null;

  const discovery = discoverOpenCodeModels({ command: input.command });
  if (!discovery.available) return requested;

  const model = discovery.models.find((candidate) => candidate.id === input.model);
  if (!model) return requested;
  return model.variants.includes(requested) ? requested : null;
}

export function buildOpenCodeRunArgs(input: {
  model: string;
  agent: string;
  prompt: string;
  sessionId?: string | null;
  variant?: string | null;
}): string[] {
  return [
    "run",
    "--format",
    "json",
    "--model",
    input.model,
    ...(input.variant ? ["--variant", input.variant] : []),
    "--agent",
    input.agent,
    ...(input.sessionId ? ["--session", input.sessionId] : []),
    input.prompt,
  ];
}
