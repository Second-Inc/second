import { type SDKMessage, type SessionConfig } from "./runner.js";
import {
  normalizeRuntimeSettings,
  runRuntimeAgent,
  type AgentRuntimeSettings,
} from "./runtimes/index.js";

export type GeneratedAppMetadata = {
  name: string;
  description: string;
};

const SYSTEM_PROMPT = [
  "You generate concise product metadata for Second apps.",
  "You must call the set_app_metadata tool exactly once.",
  "Do not write prose, markdown, code fences, or JSON in the assistant response.",
  "The name must be 2-48 characters, human-readable, and must not include duplicate suffixes like (1).",
  "The name must be a title for the workspace artifact, not a conversational reply to the user request.",
  "Do not copy request verbs or meta-prompts into the name, such as Suggest something, Build me, Create an app, or What should I build.",
  "If the request asks for build ideas, suggestions, brainstorming, or what to build, use a neutral artifact name such as Build Suggestions or App Ideas.",
  "The description must be one concise sentence that explains what the app does.",
].join("\n");

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textFromAssistantMessage(message: SDKMessage): string[] {
  if (message.type !== "assistant") return [];
  const inner = asRecord(message.message);
  const content = inner?.content;
  if (!Array.isArray(content)) return [];

  return content.flatMap((block) => {
    const record = asRecord(block);
    return record?.type === "text" && typeof record.text === "string"
      ? [record.text]
      : [];
  });
}

function metadataFromToolUse(message: SDKMessage): GeneratedAppMetadata | null {
  if (message.type !== "assistant") return null;
  const inner = asRecord(message.message);
  const content = inner?.content;
  if (!Array.isArray(content)) return null;

  for (const block of content) {
    const record = asRecord(block);
    const toolName = record?.name;
    if (
      record?.type !== "tool_use" ||
      toolName !== "set_app_metadata" &&
        toolName !== "mcp__second__set_app_metadata"
    ) {
      continue;
    }
    const input = asRecord(record.input);
    const name = normalizeGeneratedText(input?.name, 80);
    const description = normalizeGeneratedText(input?.description, 300);
    if (name && description) return { name, description };
  }

  return null;
}

function textFromStreamEventMessage(message: SDKMessage): string[] {
  if (message.type !== "stream_event") return [];
  const event = asRecord(message.event);
  const delta = asRecord(event?.delta);
  const contentBlock = asRecord(event?.content_block);
  const text = delta?.text ?? contentBlock?.text;

  return typeof text === "string" && text ? [text] : [];
}

function jsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
    ...jsonObjectCandidates(trimmed),
  ];

  for (const candidate of candidates) {
    try {
      return asRecord(JSON.parse(candidate));
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function firstStringValue(
  record: Record<string, unknown> | null,
  keys: string[],
): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function labeledValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const pattern = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im");
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function normalizeGeneratedText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength).trim()
    : "";
}

function normalizeForIntentMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBuildSuggestionRequest(prompt: string): boolean {
  const normalized = normalizeForIntentMatch(prompt);
  return (
    /\bsuggest(ion|ions)?\b/.test(normalized) &&
      /\b(app|apps|build|builder|tool|tools|something|idea|ideas)\b/.test(normalized)
  ) || /\bwhat should (i|we) build\b/.test(normalized) ||
    /\bbrainstorm\b/.test(normalized) &&
      /\b(app|apps|build|tool|tools|idea|ideas)\b/.test(normalized);
}

function echoesBuildSuggestionPrompt(name: string): boolean {
  const normalized = normalizeForIntentMatch(name);
  return normalized.startsWith("suggest ") ||
    normalized === "suggest something" ||
    normalized.includes("suggest something for") ||
    normalized.includes("for me to build") ||
    normalized.includes("for us to build") ||
    normalized.includes("what should i build") ||
    normalized.includes("what should we build");
}

function metadataForPrompt(
  metadata: GeneratedAppMetadata,
  prompt: string,
): GeneratedAppMetadata {
  if (!isBuildSuggestionRequest(prompt) || !echoesBuildSuggestionPrompt(metadata.name)) {
    return metadata;
  }
  return { ...metadata, name: "Build Suggestions" };
}

export async function generateAppMetadata(input: {
  appId: string;
  prompt: string;
  fallbackName: string;
  runtimeSettings: AgentRuntimeSettings;
  workingDirectory: string;
  workerBaseUrl: string;
}): Promise<GeneratedAppMetadata> {
  const startedAt = Date.now();
  const runtimeSettings = normalizeRuntimeSettings(input.runtimeSettings);
  console.info(
    `[metadata-generator] run start appId=${input.appId} runtime=${runtimeSettings.runtimeId} model=${runtimeSettings.model}`,
  );
  const sessionConfig: SessionConfig = {
    systemPrompt: SYSTEM_PROMPT,
    workingDirectory: input.workingDirectory,
    allowedTools: ["mcp__second__set_app_metadata"],
    maxTurns: 2,
    runtimeSessionKey: `${input.appId}__metadata`,
    appMetadataResult: {
      called: false,
      name: null,
      description: null,
    },
  };
  const userPrompt = [
    "Generate metadata for this app request.",
    "",
    "User request:",
    input.prompt,
    "",
    `Fallback current name: ${input.fallbackName}`,
  ].join("\n");

  const textParts: string[] = [];
  let messageCount = 0;
  let toolMetadata: GeneratedAppMetadata | null = null;
  for await (const message of runRuntimeAgent({
    prompt: userPrompt,
    config: sessionConfig,
    settings: runtimeSettings,
    workerBaseUrl: input.workerBaseUrl,
  })) {
    messageCount += 1;
    toolMetadata = toolMetadata ?? metadataFromToolUse(message);
    textParts.push(...textFromAssistantMessage(message));
    textParts.push(...textFromStreamEventMessage(message));
    if (message.type === "result" && typeof message.result === "string") {
      textParts.push(message.result);
    }
  }

  const text = textParts.join("\n");
  console.info(
    `[metadata-generator] run finished appId=${input.appId} messages=${messageCount} textLength=${text.length} elapsedMs=${Date.now() - startedAt}`,
  );
  const sinkName = normalizeGeneratedText(sessionConfig.appMetadataResult?.name, 80);
  const sinkDescription = normalizeGeneratedText(
    sessionConfig.appMetadataResult?.description,
    300,
  );
  if (sinkName && sinkDescription) {
    console.info(
      `[metadata-generator] tool captured appId=${input.appId} name=${JSON.stringify(sinkName)}`,
    );
    return metadataForPrompt(
      { name: sinkName, description: sinkDescription },
      input.prompt,
    );
  }
  if (toolMetadata) {
    console.info(
      `[metadata-generator] tool input captured appId=${input.appId} name=${JSON.stringify(toolMetadata.name)}`,
    );
    return metadataForPrompt(toolMetadata, input.prompt);
  }

  const parsed = extractJsonObject(text);
  console.info(
    `[metadata-generator] parse appId=${input.appId} parsed=${Boolean(parsed)} keys=${Object.keys(parsed ?? {}).join(",")}`,
  );
  const name = normalizeGeneratedText(
    firstStringValue(parsed, ["name", "title", "appName", "appTitle"]) ||
      labeledValue(text, ["name", "title", "app name", "app title"]),
    80,
  );
  const description = normalizeGeneratedText(
    firstStringValue(parsed, ["description", "appDescription", "summary"]) ||
      labeledValue(text, ["description", "app description", "summary"]),
    300,
  );

  if (!name || !description) {
    throw new Error("Metadata agent returned invalid app metadata.");
  }

  return metadataForPrompt({ name, description }, input.prompt);
}
