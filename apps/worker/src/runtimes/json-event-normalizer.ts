import type {
  AgentRuntimeId,
  AgentRuntimeSettings,
  ProviderSessionState,
  RuntimeRunResultMessage,
} from "./types.js";

type NormalizeInput = {
  runtimeId: AgentRuntimeId;
  event: unknown;
  settings: AgentRuntimeSettings;
  sessionState?: ProviderSessionState | null;
  pendingToolCalls: Map<string, string>;
};

let syntheticCounter = 0;

function nextId(prefix: string): string {
  syntheticCounter += 1;
  return `${prefix}_${syntheticCounter}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textFrom(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  const record = asRecord(value);
  for (const key of ["text", "message", "content", "delta", "summary"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

function normalizeToolName(rawName: string, runtimeId: AgentRuntimeId): string {
  if (rawName.startsWith("mcp__")) return rawName;
  if (rawName.includes("__")) return rawName;
  if (
    rawName === "present_plan" ||
    rawName === "present_suggestions" ||
    rawName === "present_agents" ||
    rawName === "present_integration_setup" ||
    rawName === "list_app_integration_keys" ||
    rawName === "done_building" ||
    rawName === "set_app_metadata" ||
    rawName === "set_onboarding_context"
  ) {
    return `mcp__second__${rawName}`;
  }
  if (rawName === "update_app_data" || rawName === "read_app_data") {
    return `mcp__app_data__${rawName}`;
  }
  if (rawName.startsWith("second.")) return `mcp__second__${rawName.slice("second.".length)}`;
  if (rawName.startsWith("app_tools.")) return `mcp__app_tools__${rawName.slice("app_tools.".length)}`;
  if (rawName.startsWith("app_data.")) return `mcp__app_data__${rawName.slice("app_data.".length)}`;
  const lower = rawName.toLowerCase();
  const builtin: Record<string, string> = {
    bash: "Bash",
    shell: "Bash",
    command: "Bash",
    edit: "Edit",
    write: "Write",
    read: "Read",
    grep: "Grep",
    glob: "Glob",
    apply_patch: "Edit",
    webfetch: "WebFetch",
    web_fetch: "WebFetch",
    websearch: "WebSearch",
    web_search: "WebSearch",
  };
  if (builtin[lower]) return builtin[lower];
  if (runtimeId === "codex-cli" && lower.includes("mcp") && lower.includes("present_plan")) {
    return "mcp__second__present_plan";
  }
  if (runtimeId === "codex-cli" && lower.includes("mcp") && lower.includes("present_suggestions")) {
    return "mcp__second__present_suggestions";
  }
  return rawName;
}

function usageMessage(
  settings: AgentRuntimeSettings,
  usage: Record<string, unknown>,
): RuntimeRunResultMessage {
  const inputTokens = Number(
    usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? usage.promptTokens ?? 0,
  );
  const outputTokens = Number(
    usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? usage.completionTokens ?? 0,
  );
  return {
    type: "result",
    total_cost_usd: Number(usage.cost_usd ?? usage.costUsd ?? 0),
    duration_ms: Number(usage.duration_ms ?? usage.durationMs ?? 0),
    duration_api_ms: Number(usage.duration_api_ms ?? usage.durationApiMs ?? 0),
    num_turns: Number(usage.num_turns ?? usage.numTurns ?? 1),
    modelUsage: {
      [settings.model]: {
        inputTokens,
        outputTokens,
        cacheReadInputTokens: Number(usage.cache_read_input_tokens ?? 0),
        cacheCreationInputTokens: Number(usage.cache_creation_input_tokens ?? 0),
        costUSD: Number(usage.cost_usd ?? usage.costUsd ?? 0),
      },
    },
  };
}

function toolUseMessage(
  id: string,
  name: string,
  input: unknown,
): RuntimeRunResultMessage {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id,
          name,
          input,
        },
      ],
    },
  };
}

function toolResultMessage(id: string, content: unknown): RuntimeRunResultMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content,
        },
      ],
    },
  };
}

function textMessage(text: string): RuntimeRunResultMessage {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

export function generateSyntheticSdkMessagesFromJsonEvent(
  input: NormalizeInput,
): RuntimeRunResultMessage[] {
  const event = asRecord(input.event);
  const type = String(event.type ?? event.event ?? event.kind ?? "");
  const item = asRecord(event.item);
  const data = asRecord(event.data);
  const messages: RuntimeRunResultMessage[] = [];

  const sessionId =
    event.thread_id ??
    event.threadId ??
    event.session_id ??
    event.sessionId ??
    data.sessionID ??
    data.sessionId ??
    item.thread_id ??
    item.sessionID;
  if (typeof sessionId === "string" && sessionId) {
    messages.push({
      type: "system",
      subtype: "init",
      session_id: sessionId,
      providerSessionState: {
        runtimeId: input.runtimeId,
        sessionId,
        format: `${input.runtimeId}-session`,
      },
    });
  }

  const usage = asRecord(event.usage ?? data.usage ?? item.usage);
  if (Object.keys(usage).length > 0 || type.includes("turn.completed")) {
    messages.push(usageMessage(input.settings, usage));
  }

  const text =
    textFrom(event.delta) ??
    textFrom(event.message) ??
    textFrom(event.text) ??
    textFrom(data.part) ??
    textFrom(item);
  const isTextEvent =
    /message|text|assistant|output|response/.test(type) &&
    !/tool|command|usage/.test(type);
  if (text && isTextEvent) messages.push(textMessage(text));

  const rawTool = asRecord(event.tool ?? item.tool ?? data.tool);
  const rawName =
    event.tool_name ??
    event.toolName ??
    rawTool.name ??
    item.name ??
    data.name;
  const hasToolShape =
    typeof rawName === "string" ||
    /tool|command|bash|exec|mcp/.test(type);
  if (hasToolShape && !/result|output|completed|finish/.test(type)) {
    const toolCallId = String(
      event.call_id ??
      event.callId ??
      event.id ??
      item.id ??
      nextId("tool"),
    );
    const toolName = normalizeToolName(
      typeof rawName === "string" ? rawName : String(type || "unknown"),
      input.runtimeId,
    );
    const toolInput =
      event.arguments ??
      event.input ??
      data.input ??
      item.input ??
      rawTool.input ??
      {};
    input.pendingToolCalls.set(toolCallId, toolName);
    messages.push(toolUseMessage(toolCallId, toolName, toolInput));
  }

  const maybeToolResult =
    event.output ??
    event.result ??
    data.output ??
    data.result ??
    item.output ??
    item.result;
  if (
    maybeToolResult !== undefined &&
    (/tool|command|bash|exec|mcp|completed/.test(type) || input.pendingToolCalls.size > 0)
  ) {
    const toolCallId = String(
      event.call_id ??
      event.callId ??
      event.id ??
      item.id ??
      Array.from(input.pendingToolCalls.keys()).at(-1) ??
      nextId("tool"),
    );
    messages.push(toolResultMessage(toolCallId, maybeToolResult));
  }

  if (messages.length === 0 && text) {
    messages.push(textMessage(text));
  }

  return messages;
}
