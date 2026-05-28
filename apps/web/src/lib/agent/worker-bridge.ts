import {
  createUIMessageStream,
  generateId,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import { isDoneBuildingSuccessOutput } from "./done-building";
import { workerFetch } from "@/lib/worker-client";
import type { AgentRuntimeSettings } from "@/lib/agent/runtime-registry";
import type { ProviderSessionState } from "@/lib/db/types";
import type { RuntimeSkillReference } from "@/lib/db";

export type WorkerBridgeOptions = {
  workerUrl: string;
  appId: string;
  runId?: string;
  appName?: string;
  requestedByUserId?: string;
  requestedByUserName?: string;
  prompt: string;
  systemPrompt: string;
  runtimeSettings: AgentRuntimeSettings;
  runtimeMode?: "builder" | "workspace_agent";
  selectedSkills?: RuntimeSkillReference[];
  workingDirectory?: string;
  allowedTools?: string[];
  maxTurns?: number;
  sessionState?: ProviderSessionState;
  /** Source files to restore in the workspace (after container TTL) */
  sourceFiles?: Record<string, string>;
  signal?: AbortSignal;
  /** Agent config from agents.json — enables custom MCP tools in the worker */
  agentConfig?: {
    id: string;
    name: string;
    systemPrompt: string;
    tools: Array<{
      type: string;
      name: string;
      displayName?: string;
      description?: string;
      enabled: boolean;
      integration?: { name: string; domain: string } | null;
      endpoint?: { method: string; url: string; headers?: Record<string, string>; queryParams?: Record<string, string>; body?: unknown } | null;
      mockData?: unknown;
    }>;
    dataCollections?: string[];
  };
  /** Workspace ID for custom tool execution */
  workspaceId?: string;
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
      costUsd: number;
    }
  >;
};

export type WorkerBridgeResult = {
  sessionState: ProviderSessionState | null;
  usage: QueryUsage | null;
  /** Source files collected after agent called done_building */
  sourceFiles: Record<string, string> | null;
  /** Tool calls observed while translating worker events into UI message parts. */
  toolCalls: WorkerToolCallSummary[];
};

export type WorkerToolCallSummary = {
  toolCallId: string;
  toolName: string;
  inputAvailable: boolean;
  outputAvailable: boolean;
  flushedWithoutOutput: boolean;
  outputKind?: string;
};

type WorkerStatusResponse = {
  exists: boolean;
  restoreNeeded?: boolean;
  workspaceHasFiles?: boolean;
};

type PendingToolCallMap = Map<string, { toolCallId: string; toolName: string }>;

const TOOL_PROGRESS_OUTPUT_LIMIT = 20_000;

type BridgeTrace = (event: string, details?: Record<string, unknown>) => void;

type SDKMessageRecord = Record<string, unknown>;

function compactTraceObject(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as Record<string, unknown>).length === 0
    ) {
      continue;
    }
    output[key] = value;
  }
  return output;
}

function traceString(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function asTraceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function summarizeToolInputForTrace(input: unknown): Record<string, unknown> {
  const record = asTraceRecord(input);
  return compactTraceObject({
    command: traceString(record.command),
    file_path: traceString(record.file_path),
    pattern: traceString(record.pattern),
    query: traceString(record.query),
    url: traceString(record.url),
    changesCount: Array.isArray(record.changes) ? record.changes.length : undefined,
    firstChangePath: Array.isArray(record.changes)
      ? traceString(asTraceRecord(record.changes[0]).path)
      : undefined,
  });
}

function summarizeWorkerMessageForTrace(msg: Record<string, unknown>): Record<string, unknown> | null {
  if (msg.type === "stream_event") {
    const event = asTraceRecord(msg.event);
    const block = asTraceRecord(event.content_block);
    const delta = asTraceRecord(event.delta);
    const deltaType = typeof delta.type === "string" ? delta.type : undefined;
    if (event.type === "content_block_delta" && deltaType !== "input_json_delta") {
      return null;
    }
    return compactTraceObject({
      type: msg.type,
      eventType: event.type,
      blockType: block.type,
      toolCallId: block.id,
      toolName: block.name,
      deltaType,
      inputJsonChars: typeof delta.partial_json === "string"
        ? delta.partial_json.length
        : undefined,
    });
  }

  if (msg.type === "user") {
    const content = Array.isArray(asTraceRecord(msg.message).content)
      ? (asTraceRecord(msg.message).content as unknown[])
      : [];
    const result = asTraceRecord(content.find((block) => asTraceRecord(block).type === "tool_result"));
    return compactTraceObject({
      type: msg.type,
      toolResultId: result.tool_use_id,
      contentKind: typeof result.content,
      content: summarizeToolInputForTrace(result.content),
    });
  }

  if (msg.type === "tool_output_delta") {
    return compactTraceObject({
      type: msg.type,
      toolCallId: msg.tool_use_id ?? msg.toolCallId,
      toolName: msg.toolName,
      outputChars: typeof msg.output === "string" ? msg.output.length : undefined,
      deltaChars: typeof msg.delta === "string" ? msg.delta.length : undefined,
      status: msg.status,
    });
  }

  if (msg.type === "tool_use_summary") {
    return compactTraceObject({
      type: msg.type,
      summary: traceString(msg.summary),
    });
  }

  if (msg.type === "result" || msg.type === "error" || msg.type === "system") {
    return compactTraceObject({
      type: msg.type,
      subtype: msg.subtype,
      sessionId: msg.session_id,
      durationMs: msg.duration_ms,
    });
  }

  return null;
}

function trimStreamingToolOutput(output: string): string {
  if (output.length <= TOOL_PROGRESS_OUTPUT_LIMIT) return output;
  return `[output truncated]\n${output.slice(-TOOL_PROGRESS_OUTPUT_LIMIT)}`;
}

function writeToolOutputProgress(
  writer: UIMessageStreamWriter,
  msg: Record<string, unknown>,
  pendingToolCalls: PendingToolCallMap,
  resolvedToolCalls: Set<string>,
  trace?: BridgeTrace,
): boolean {
  const toolCallId =
    typeof msg.tool_use_id === "string"
      ? msg.tool_use_id
      : typeof msg.toolCallId === "string"
        ? msg.toolCallId
        : null;
  if (!toolCallId) return false;
  if (!pendingToolCalls.has(toolCallId) && !resolvedToolCalls.has(toolCallId)) {
    return false;
  }

  const output = typeof msg.output === "string"
    ? msg.output
    : typeof msg.delta === "string"
      ? msg.delta
      : "";
  if (!output) return false;

  writer.write({
    type: "tool-output-available",
    toolCallId,
    output: trimStreamingToolOutput(output),
    dynamic: true,
    preliminary: true,
  });
  trace?.("ui.tool-output-preliminary", {
    toolCallId,
    outputChars: output.length,
  });
  return true;
}

function createAgentRunSdkTranslator(
  writer: UIMessageStreamWriter,
  trace?: BridgeTrace,
) {
  let queryUsage: QueryUsage | null = null;
  let currentBlockType: string | null = null;
  let turnHadStreamEvents = false;
  let currentToolCallId: string | null = null;
  let currentToolName: string | null = null;
  let toolInputBuffer = "";
  let textId: string | null = null;
  let reasoningId: string | null = null;
  const pendingToolCalls: PendingToolCallMap = new Map();
  const resolvedToolCalls = new Set<string>();

  function resolveTool(toolCallId: string, output: unknown) {
    const pending = pendingToolCalls.get(toolCallId);
    if (!pending && !resolvedToolCalls.has(toolCallId)) return;
    trace?.("ui.tool-output-final", {
      toolCallId,
      toolName: pending?.toolName,
      output: summarizeToolInputForTrace(output),
      outputKind: typeof output,
    });
    writer.write({
      type: "tool-output-available",
      toolCallId,
      output,
      dynamic: true,
    });
    pendingToolCalls.delete(toolCallId);
    resolvedToolCalls.add(toolCallId);
  }

  function flushPendingTools() {
    for (const [, pending] of pendingToolCalls) {
      trace?.("ui.tool-output-flush", {
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
      });
      writer.write({
        type: "tool-output-available",
        toolCallId: pending.toolCallId,
        output: "Completed",
        dynamic: true,
      });
      resolvedToolCalls.add(pending.toolCallId);
    }
    pendingToolCalls.clear();
  }

  function closeText() {
    if (textId) {
      writer.write({ type: "text-end", id: textId });
      textId = null;
    }
  }

  function closeReasoning() {
    if (reasoningId) {
      writer.write({ type: "reasoning-end", id: reasoningId });
      reasoningId = null;
    }
  }

  function closeOpenBlocks() {
    closeText();
    closeReasoning();
    flushPendingTools();
  }

  function process(msg: SDKMessageRecord): boolean {
    const workerSummary = summarizeWorkerMessageForTrace(msg);
    if (workerSummary) trace?.("worker.msg", workerSummary);

    if (msg.type === "error") {
      writer.write({
        type: "error",
        errorText: String(msg.error ?? "Unknown worker error"),
      });
      return false;
    }

    if (msg.type === "stream_event") {
      turnHadStreamEvents = true;
      const event = msg.event as Record<string, unknown>;
      if (!event) return true;
      const delta = event.delta as Record<string, unknown> | undefined;

      if (event.type === "message_start" && pendingToolCalls.size > 0) {
        flushPendingTools();
      }

      if (event.type === "content_block_start") {
        const block = event.content_block as
          | Record<string, unknown>
          | undefined;
        currentBlockType = String(block?.type ?? "");
        if (block?.type === "thinking") closeText();
        if (block?.type === "text") closeReasoning();
        if (block?.type === "tool_use") {
          closeText();
          closeReasoning();
          currentToolCallId = String(block.id ?? generateId());
          currentToolName = String(block.name ?? "unknown");
          toolInputBuffer = "";
          trace?.("ui.tool-input-start", {
            toolCallId: currentToolCallId,
            toolName: currentToolName,
          });
          writer.write({
            type: "tool-input-start",
            toolCallId: currentToolCallId,
            toolName: currentToolName,
            dynamic: true,
          });
        }
      }

      if (event.type === "content_block_stop") {
        if (currentBlockType === "tool_use" && currentToolCallId) {
          let input: unknown = {};
          try {
            input = JSON.parse(toolInputBuffer);
          } catch {
            // Ignore incomplete JSON and keep the tool visible with empty input.
          }
          writer.write({
            type: "tool-input-available",
            toolCallId: currentToolCallId,
            toolName: currentToolName!,
            input,
            dynamic: true,
          });
          trace?.("ui.tool-input-available", {
            toolCallId: currentToolCallId,
            toolName: currentToolName,
            input: summarizeToolInputForTrace(input),
          });
          pendingToolCalls.set(currentToolCallId, {
            toolCallId: currentToolCallId,
            toolName: currentToolName!,
          });
          currentToolCallId = null;
          currentToolName = null;
          toolInputBuffer = "";
        }
        if (currentBlockType === "thinking") closeReasoning();
        if (currentBlockType === "text") closeText();
        currentBlockType = null;
      }

      if (
        event.type === "content_block_delta" &&
        delta?.type === "text_delta"
      ) {
        if (!textId) {
          textId = generateId();
          writer.write({ type: "text-start", id: textId });
        }
        writer.write({
          type: "text-delta",
          id: textId,
          delta: String(delta.text ?? ""),
        });
      }

      if (
        event.type === "content_block_delta" &&
        delta?.type === "thinking_delta"
      ) {
        if (!reasoningId) {
          reasoningId = generateId();
          writer.write({ type: "reasoning-start", id: reasoningId });
        }
        writer.write({
          type: "reasoning-delta",
          id: reasoningId,
          delta: String(delta.thinking ?? ""),
        });
      }

      if (
        event.type === "content_block_delta" &&
        delta?.type === "input_json_delta"
      ) {
        const partial = String(delta.partial_json ?? "");
        toolInputBuffer += partial;
        if (currentToolCallId) {
          writer.write({
            type: "tool-input-delta",
            toolCallId: currentToolCallId,
            inputTextDelta: partial,
          });
        }
      }
    }

    if (msg.type === "assistant" && !turnHadStreamEvents) {
      const message = msg.message as Record<string, unknown> | undefined;
      const content = Array.isArray(message?.content)
        ? (message.content as Array<Record<string, unknown>>)
        : [];
      for (const block of content) {
        if (
          block.type === "thinking" &&
          typeof block.thinking === "string" &&
          block.thinking
        ) {
          const id = generateId();
          writer.write({ type: "reasoning-start", id });
          writer.write({
            type: "reasoning-delta",
            id,
            delta: block.thinking as string,
          });
          writer.write({ type: "reasoning-end", id });
        }
        if (
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text
        ) {
          const id = generateId();
          writer.write({ type: "text-start", id });
          writer.write({
            type: "text-delta",
            id,
            delta: block.text as string,
          });
          writer.write({ type: "text-end", id });
        }
        if (block.type === "tool_use") {
          const toolCallId = String(block.id ?? generateId());
          const toolName = String(block.name ?? "unknown");
          writer.write({
            type: "tool-input-start",
            toolCallId,
            toolName,
            dynamic: true,
          });
          trace?.("ui.tool-input-start", { toolCallId, toolName });
          writer.write({
            type: "tool-input-available",
            toolCallId,
            toolName,
            input: block.input ?? {},
            dynamic: true,
          });
          trace?.("ui.tool-input-available", {
            toolCallId,
            toolName,
            input: summarizeToolInputForTrace(block.input ?? {}),
          });
          pendingToolCalls.set(toolCallId, { toolCallId, toolName });
        }
      }
    }

    if (msg.type === "assistant") turnHadStreamEvents = false;

    if (msg.type === "result") {
      const modelUsageRaw = msg.modelUsage as
        | Record<
            string,
            {
              inputTokens?: number;
              outputTokens?: number;
              cacheReadInputTokens?: number;
              cacheCreationInputTokens?: number;
              costUSD?: number;
            }
          >
        | undefined;
      const modelUsage: QueryUsage["modelUsage"] = {};
      if (modelUsageRaw) {
        for (const [model, u] of Object.entries(modelUsageRaw)) {
          modelUsage[model] = {
            inputTokens: u.inputTokens ?? 0,
            outputTokens: u.outputTokens ?? 0,
            cacheReadInputTokens: u.cacheReadInputTokens ?? 0,
            cacheCreationInputTokens: u.cacheCreationInputTokens ?? 0,
            costUsd: u.costUSD ?? 0,
          };
        }
      }
      queryUsage = {
        totalCostUsd:
          typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : 0,
        durationMs: typeof msg.duration_ms === "number" ? msg.duration_ms : 0,
        durationApiMs:
          typeof msg.duration_api_ms === "number" ? msg.duration_api_ms : 0,
        numTurns: typeof msg.num_turns === "number" ? msg.num_turns : 0,
        modelUsage,
      };
    }

    if (msg.type === "tool_output_delta") {
      writeToolOutputProgress(
        writer,
        msg,
        pendingToolCalls,
        resolvedToolCalls,
        trace,
      );
    }

    if (msg.type === "tool_use_summary") {
      const summary = String(msg.summary ?? "");
      if (summary) {
        const id = generateId();
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: summary });
        writer.write({ type: "text-end", id });
      }
    }

    if (msg.type === "user") {
      const message = msg.message as Record<string, unknown> | undefined;
      const content = Array.isArray(message?.content)
        ? (message.content as Array<Record<string, unknown>>)
        : [];
      for (const block of content) {
        if (
          block.type === "tool_result" &&
          typeof block.tool_use_id === "string"
        ) {
          resolveTool(block.tool_use_id, block.content ?? "");
        }
      }
    }

    return true;
  }

  return {
    process,
    finish: closeOpenBlocks,
    getUsage: () => queryUsage,
  };
}

async function fetchSessionState(
  workerUrl: string,
  appId: string,
): Promise<ProviderSessionState | null> {
  try {
    const response = await workerFetch(`/sessions/${appId}/session-file`, {
      workerUrl,
    });
    if (response.ok) {
      const data = (await response.json()) as {
        sessionState: ProviderSessionState | null;
      };
      return data.sessionState;
    }
  } catch {
    // Non-fatal: session state couldn't be retrieved
  }
  return null;
}

export async function isWorkerRestoreNeeded(
  workerUrl: string,
  appId: string,
): Promise<boolean> {
  try {
    const response = await workerFetch(`/sessions/${appId}/status`, {
      workerUrl,
    });
    if (!response.ok) return true;

    const data = (await response.json()) as WorkerStatusResponse;
    if (typeof data.restoreNeeded === "boolean") return data.restoreNeeded;
    if (typeof data.workspaceHasFiles === "boolean") return !data.workspaceHasFiles;
    return true;
  } catch {
    // Fail open: if status check fails, prefer restoring from persisted files.
    return true;
  }
}

export async function streamFromWorker(
  writer: UIMessageStreamWriter,
  options: WorkerBridgeOptions,
): Promise<WorkerBridgeResult> {
  const traceEnabled = process.env.SECOND_CODEX_TRACE === "1";
  const traceStartedAt = Date.now();
  const trace: BridgeTrace = (event, details = {}) => {
    if (!traceEnabled) return;
    console.info(
      `[codex-bridge +${Date.now() - traceStartedAt}ms] ${event} ${JSON.stringify(compactTraceObject({
        appId: options.appId,
        runtimeId: options.runtimeSettings.runtimeId,
        model: options.runtimeSettings.model,
        ...details,
      }))}`,
    );
  };
  trace("stream.start");

  let response: Response;
  try {
    response = await workerFetch(`/sessions/${options.appId}/messages`, {
      workerUrl: options.workerUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      disableBodyTimeout: true,
      body: JSON.stringify({
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
        runtimeId: options.runtimeSettings.runtimeId,
        runtimeModel: options.runtimeSettings.model,
        runtimeParams: options.runtimeSettings.params,
        runtimeMode: options.runtimeMode,
        selectedSkills: options.selectedSkills,
        workingDirectory: options.workingDirectory,
        allowedTools: options.allowedTools,
        maxTurns: options.maxTurns,
        sessionState: options.sessionState,
        sourceFiles: options.sourceFiles,
        agentConfig: options.agentConfig,
        workspaceId: options.workspaceId,
        runId: options.runId,
        appName: options.appName,
        requestedByUserId: options.requestedByUserId,
        requestedByUserName: options.requestedByUserName,
      }),
      signal: options.signal,
    });
  } catch (error) {
    throw new Error("Could not connect to the agent worker.", { cause: error });
  }

  if (!response.ok || !response.body) {
    throw new Error(`Agent worker returned ${response.status}`);
  }

  // --- Usage tracking ---
  let queryUsage: QueryUsage | null = null;

  // --- Build completion tracking ---
  let buildComplete = false;

  // --- Block tracking ---
  // Track the current content block type by index so we can properly
  // close text/reasoning blocks on content_block_stop (not just tool_use).
  let currentBlockType: string | null = null; // "thinking" | "text" | "tool_use"

  // When thinking is set with budgetTokens, StreamEvent may not be emitted.
  // Track whether we got stream_events for the current turn so we can
  // fall back to processing complete AssistantMessages.
  let turnHadStreamEvents = false;

  let currentToolCallId: string | null = null;
  let currentToolName: string | null = null;
  let toolInputBuffer = "";
  let textId: string | null = null;
  let reasoningId: string | null = null;

  // Track tool calls that have been sent as input-available but not yet resolved
  const pendingToolCalls = new Map<
    string,
    { toolCallId: string; toolName: string }
  >();
  const resolvedToolCalls = new Set<string>();
  const observedToolCalls = new Map<string, WorkerToolCallSummary>();

  function rememberToolCall(
    toolCallId: string,
    toolName: string,
    inputAvailable = false,
  ) {
    const existing = observedToolCalls.get(toolCallId);
    observedToolCalls.set(toolCallId, {
      toolCallId,
      toolName,
      inputAvailable: existing?.inputAvailable || inputAvailable,
      outputAvailable: existing?.outputAvailable ?? false,
      flushedWithoutOutput: existing?.flushedWithoutOutput ?? false,
      outputKind: existing?.outputKind,
    });
  }

  function rememberToolOutput(
    toolCallId: string,
    output: unknown,
    flushedWithoutOutput = false,
  ) {
    const pending = pendingToolCalls.get(toolCallId);
    const existing = observedToolCalls.get(toolCallId);
    observedToolCalls.set(toolCallId, {
      toolCallId,
      toolName: pending?.toolName ?? existing?.toolName ?? "unknown",
      inputAvailable: existing?.inputAvailable ?? true,
      outputAvailable: !flushedWithoutOutput,
      flushedWithoutOutput:
        (existing?.flushedWithoutOutput ?? false) || flushedWithoutOutput,
      outputKind: typeof output,
    });
  }

  function resolveTool(toolCallId: string, output: unknown) {
    const pending = pendingToolCalls.get(toolCallId);
    if (!pending && !resolvedToolCalls.has(toolCallId)) return;
    rememberToolOutput(toolCallId, output);
    trace("ui.tool-output-final", {
      toolCallId,
      toolName: pending?.toolName,
      output: summarizeToolInputForTrace(output),
      outputKind: typeof output,
    });
    writer.write({
      type: "tool-output-available",
      toolCallId,
      output,
      dynamic: true,
    });
    pendingToolCalls.delete(toolCallId);
    resolvedToolCalls.add(toolCallId);
  }

  function flushPendingTools() {
    for (const [, pending] of pendingToolCalls) {
      rememberToolOutput(pending.toolCallId, "Completed", true);
      trace("ui.tool-output-flush", {
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
      });
      writer.write({
        type: "tool-output-available",
        toolCallId: pending.toolCallId,
        output: "Completed",
        dynamic: true,
      });
      resolvedToolCalls.add(pending.toolCallId);
    }
    pendingToolCalls.clear();
  }

  function closeText() {
    if (textId) {
      writer.write({ type: "text-end", id: textId });
      textId = null;
    }
  }

  function closeReasoning() {
    if (reasoningId) {
      writer.write({ type: "reasoning-end", id: reasoningId });
      reasoningId = null;
    }
  }

  function closeOpenBlocks() {
    closeText();
    closeReasoning();
    flushPendingTools();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";

  outer: while (true) {
    if (options.signal?.aborted) {
      await reader.cancel().catch(() => {});
      throw new Error("Worker stream cancelled");
    }
    let readResult: ReadableStreamReadResult<Uint8Array>;
    try {
      readResult = await reader.read();
    } catch (error) {
      throw new Error("Lost connection to the agent worker stream.", {
        cause: error,
      });
    }
    const { done, value } = readResult;
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") {
        closeOpenBlocks();
        break outer;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data);
      } catch {
        continue;
      }
      const workerSummary = summarizeWorkerMessageForTrace(msg);
      if (workerSummary) trace("worker.msg", workerSummary);

      if (msg.type === "error") {
        closeOpenBlocks();
        throw new Error(String(msg.error ?? "Unknown worker error"));
      }

      // Translate Claude SDK stream_event → UIMessage chunks
      if (msg.type === "stream_event") {
        turnHadStreamEvents = true;
        const event = msg.event as Record<string, unknown>;
        if (!event) continue;

        const delta = event.delta as Record<string, unknown> | undefined;

        // New API turn starting — flush tools from the previous turn
        if (event.type === "message_start") {
          if (pendingToolCalls.size > 0) {
            flushPendingTools();
          }
        }

        // --- content_block_start: track block type for ALL types ---
        if (event.type === "content_block_start") {
          const block = event.content_block as
            | Record<string, unknown>
            | undefined;
          currentBlockType = String(block?.type ?? "");

          if (block?.type === "thinking") {
            // Close any open text block before reasoning starts
            closeText();
          }

          if (block?.type === "text") {
            // Close any open reasoning block before text starts
            closeReasoning();
          }

          if (block?.type === "tool_use") {
            // Close both text and reasoning before tool call
            closeText();
            closeReasoning();
            currentToolCallId = String(block.id ?? generateId());
            currentToolName = String(block.name ?? "unknown");
            toolInputBuffer = "";
            rememberToolCall(currentToolCallId, currentToolName);
            trace("ui.tool-input-start", {
              toolCallId: currentToolCallId,
              toolName: currentToolName,
            });
            writer.write({
              type: "tool-input-start",
              toolCallId: currentToolCallId,
              toolName: currentToolName,
              dynamic: true,
            });
          }
        }

        // --- content_block_stop: handle ALL block types ---
        if (event.type === "content_block_stop") {
          if (currentBlockType === "tool_use" && currentToolCallId) {
            let input: unknown = {};
            try {
              input = JSON.parse(toolInputBuffer);
            } catch {
              // input stays empty
            }
            writer.write({
              type: "tool-input-available",
              toolCallId: currentToolCallId,
              toolName: currentToolName!,
              input,
              dynamic: true,
            });
            trace("ui.tool-input-available", {
              toolCallId: currentToolCallId,
              toolName: currentToolName,
              input: summarizeToolInputForTrace(input),
            });
            rememberToolCall(currentToolCallId, currentToolName!, true);
            pendingToolCalls.set(currentToolCallId, {
              toolCallId: currentToolCallId,
              toolName: currentToolName!,
            });
            currentToolCallId = null;
            currentToolName = null;
            toolInputBuffer = "";
          }

          if (currentBlockType === "thinking") {
            closeReasoning();
          }

          if (currentBlockType === "text") {
            closeText();
          }

          currentBlockType = null;
        }

        // Text streaming
        if (
          event.type === "content_block_delta" &&
          delta?.type === "text_delta"
        ) {
          if (!textId) {
            textId = generateId();
            writer.write({ type: "text-start", id: textId });
          }
          writer.write({
            type: "text-delta",
            id: textId,
            delta: String(delta.text ?? ""),
          });
        }

        // Reasoning/thinking streaming
        if (
          event.type === "content_block_delta" &&
          delta?.type === "thinking_delta"
        ) {
          if (!reasoningId) {
            reasoningId = generateId();
            writer.write({ type: "reasoning-start", id: reasoningId });
          }
          writer.write({
            type: "reasoning-delta",
            id: reasoningId,
            delta: String(delta.thinking ?? ""),
          });
        }

        // Tool input accumulation
        if (
          event.type === "content_block_delta" &&
          delta?.type === "input_json_delta"
        ) {
          const partial = String(delta.partial_json ?? "");
          toolInputBuffer += partial;
          if (currentToolCallId) {
            writer.write({
              type: "tool-input-delta",
              toolCallId: currentToolCallId,
              inputTextDelta: partial,
            });
          }
        }
      }

      // Fallback: when StreamEvent is not emitted (e.g. budgetTokens thinking),
      // the SDK still yields complete AssistantMessages. Process them if we
      // didn't already get streaming events for this turn.
      if (msg.type === "assistant" && !turnHadStreamEvents) {
        const message = msg.message as Record<string, unknown> | undefined;
        const content = Array.isArray(message?.content)
          ? (message.content as Array<Record<string, unknown>>)
          : [];

        for (const block of content) {
          if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
            const id = generateId();
            writer.write({ type: "reasoning-start", id });
            writer.write({ type: "reasoning-delta", id, delta: block.thinking as string });
            writer.write({ type: "reasoning-end", id });
          }

          if (block.type === "text" && typeof block.text === "string" && block.text) {
            const id = generateId();
            writer.write({ type: "text-start", id });
            writer.write({ type: "text-delta", id, delta: block.text as string });
            writer.write({ type: "text-end", id });
          }

          if (block.type === "tool_use") {
            const toolCallId = String(block.id ?? generateId());
            const toolName = String(block.name ?? "unknown");
            const input = block.input ?? {};
            writer.write({
              type: "tool-input-start",
              toolCallId,
              toolName,
              dynamic: true,
            });
            rememberToolCall(toolCallId, toolName);
            trace("ui.tool-input-start", { toolCallId, toolName });
            writer.write({
              type: "tool-input-available",
              toolCallId,
              toolName,
              input,
              dynamic: true,
            });
            trace("ui.tool-input-available", {
              toolCallId,
              toolName,
              input: summarizeToolInputForTrace(input),
            });
            rememberToolCall(toolCallId, toolName, true);
            pendingToolCalls.set(toolCallId, { toolCallId, toolName });
          }
        }
      }

      // Reset per-turn streaming flag when we see a complete assistant message
      if (msg.type === "assistant") {
        turnHadStreamEvents = false;
      }

      // Result message — contains cost/token data for this query() call
      if (msg.type === "result") {
        const modelUsageRaw = msg.modelUsage as
          | Record<
              string,
              {
                inputTokens?: number;
                outputTokens?: number;
                cacheReadInputTokens?: number;
                cacheCreationInputTokens?: number;
                costUSD?: number;
              }
            >
          | undefined;

        const modelUsage: QueryUsage["modelUsage"] = {};
        if (modelUsageRaw) {
          for (const [model, u] of Object.entries(modelUsageRaw)) {
            modelUsage[model] = {
              inputTokens: u.inputTokens ?? 0,
              outputTokens: u.outputTokens ?? 0,
              cacheReadInputTokens: u.cacheReadInputTokens ?? 0,
              cacheCreationInputTokens: u.cacheCreationInputTokens ?? 0,
              costUsd: u.costUSD ?? 0,
            };
          }
        }

        queryUsage = {
          totalCostUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : 0,
          durationMs: typeof msg.duration_ms === "number" ? msg.duration_ms : 0,
          durationApiMs: typeof msg.duration_api_ms === "number" ? msg.duration_api_ms : 0,
          numTurns: typeof msg.num_turns === "number" ? msg.num_turns : 0,
          modelUsage,
        };
      }

      if (msg.type === "tool_output_delta") {
        writeToolOutputProgress(writer, msg, pendingToolCalls, resolvedToolCalls, trace);
      }

      // Tool use summaries — Claude Code "step titles" (e.g. "Writing main.ts...")
      if (msg.type === "tool_use_summary") {
        const summary = String(
          (msg as Record<string, unknown>).summary ?? "",
        );
        if (summary) {
          const id = generateId();
          writer.write({ type: "text-start", id });
          writer.write({ type: "text-delta", id, delta: summary });
          writer.write({ type: "text-end", id });
        }
      }

      // User messages from the SDK contain tool_result blocks (after tool execution)
      if (msg.type === "user") {
        const message = msg.message as Record<string, unknown> | undefined;
        const content = Array.isArray(message?.content)
          ? (message.content as Array<Record<string, unknown>>)
          : [];
        for (const block of content) {
          if (
            block.type === "tool_result" &&
            typeof block.tool_use_id === "string"
          ) {
            // Detect done_building tool completion
            const pending = pendingToolCalls.get(block.tool_use_id);
            if (
              pending?.toolName === "mcp__second__done_building" &&
              isDoneBuildingSuccessOutput(block.content)
            ) {
              buildComplete = true;
            }

            resolveTool(block.tool_use_id, block.content ?? "");
          }
        }
      }
    }
  }

  // Clean up any remaining open blocks (if stream ended without [DONE])
  closeOpenBlocks();

  // Fetch the session file for persistence (cross-container resume)
  const sessionState = await fetchSessionState(options.workerUrl, options.appId);

  // If done_building was called, fetch the workspace source files
  let sourceFiles: Record<string, string> | null = null;
  if (buildComplete) {
    try {
      const filesRes = await workerFetch(`/sessions/${options.appId}/files`, {
        workerUrl: options.workerUrl,
      });
      if (filesRes.ok) {
        const data = (await filesRes.json()) as {
          files: Record<string, string>;
        };
        sourceFiles = data.files;
      }
    } catch {
      // Non-fatal: files couldn't be retrieved
    }
  }

  return {
    sessionState,
    usage: queryUsage,
    sourceFiles,
    toolCalls: [...observedToolCalls.values()],
  };
}

/**
 * Stream from a worker's agent-run events endpoint (viewer-only, GET-based SSE).
 * Uses the same SDK message → UIMessage translation as streamFromWorker.
 */
export async function streamAgentRunFromWorker(
  writer: UIMessageStreamWriter,
  options: {
    workerUrl: string;
    workerAppId: string;
    runId: string;
    signal?: AbortSignal;
  },
): Promise<{ usage: QueryUsage | null }> {
  const traceEnabled = process.env.SECOND_CODEX_TRACE === "1";
  const traceStartedAt = Date.now();
  const trace: BridgeTrace = (event, details = {}) => {
    if (!traceEnabled) return;
    console.info(
      `[codex-bridge +${Date.now() - traceStartedAt}ms] ${event} ${JSON.stringify(compactTraceObject({
        appId: options.workerAppId,
        runId: options.runId,
        stream: "agent-run",
        ...details,
      }))}`,
    );
  };
  trace("stream.start");

  const response = await workerFetch(
    `/sessions/${options.workerAppId}/agent-run/${options.runId}/events`,
    {
      workerUrl: options.workerUrl,
      signal: options.signal,
      disableBodyTimeout: true,
    },
  );

  if (!response.ok || !response.body) {
    throw new Error(`Worker events returned ${response.status}`);
  }

  const translator = createAgentRunSdkTranslator(writer, trace);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";

  try {
    outer: while (true) {
      if (options.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") {
          translator.finish();
          break outer;
        }

        let msg: SDKMessageRecord;
        try {
          msg = JSON.parse(data) as SDKMessageRecord;
        } catch {
          continue;
        }
        if (!translator.process(msg)) {
          break outer;
        }
      }
    }
  } finally {
    if (options.signal?.aborted) {
      await reader.cancel().catch(() => {});
    }
    reader.releaseLock();
  }

  translator.finish();
  return { usage: translator.getUsage() };
}

export async function appAgentSdkMessagesToUiMessages(input: {
  messages: unknown[];
  originalMessages?: UIMessage[];
}): Promise<UIMessage[]> {
  let finalMessages: UIMessage[] = input.originalMessages ?? [];
  const sdkMessages = input.messages.filter(
    (message): message is SDKMessageRecord =>
      Boolean(message) && typeof message === "object" && !Array.isArray(message),
  );
  if (sdkMessages.length === 0) return finalMessages;

  const stream = createUIMessageStream({
    originalMessages: finalMessages,
    execute: ({ writer }) => {
      const translator = createAgentRunSdkTranslator(writer);
      for (const message of sdkMessages) {
        if (!translator.process(message)) break;
      }
      translator.finish();
    },
    onFinish: ({ messages }) => {
      finalMessages = messages;
    },
  });

  const reader = stream.getReader();
  try {
    while (!(await reader.read()).done) {
      // Consuming the stream drives createUIMessageStream's onFinish.
    }
  } finally {
    reader.releaseLock();
  }

  return finalMessages;
}
