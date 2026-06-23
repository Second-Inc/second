import { spawn } from "node:child_process";
import { approvalToolResultShouldStop } from "../approval-tools.js";
import { generateSyntheticSdkMessagesFromJsonEvent } from "./json-event-normalizer.js";
import type {
  AgentRuntimeId,
  AgentRuntimeSettings,
  ProviderSessionState,
  RuntimeRunResultMessage,
} from "./types.js";

export type CliRuntimeOptions = {
  runtimeId: AgentRuntimeId;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  settings: AgentRuntimeSettings;
  sessionState?: ProviderSessionState | null;
  signal?: AbortSignal;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value ? value : null;
}

function errorFromJsonEvent(event: unknown): Error | null {
  const record = asRecord(event);
  const type = stringField(record, "type") ?? stringField(record, "event");
  const rawError = asRecord(record.error);
  const nestedError = asRecord(rawError.error);
  const errorRecord = Object.keys(nestedError).length > 0 ? nestedError : rawError;

  if (type !== "error" && Object.keys(errorRecord).length === 0) return null;

  const code = stringField(errorRecord, "code");
  const message =
    stringField(errorRecord, "message") ??
    stringField(rawError, "message") ??
    stringField(record, "message") ??
    "Runtime emitted an error event.";
  const details = code ? `${code}: ${message}` : message;
  return new Error(`${details}`);
}

function toolResult(message: RuntimeRunResultMessage): {
  id: string;
  content: unknown;
} | null {
  if (message.type !== "user") return null;
  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const record = item as {
      type?: unknown;
      tool_use_id?: unknown;
      content?: unknown;
    };
    if (
      record.type === "tool_result" &&
      typeof record.tool_use_id === "string"
    ) {
      return { id: record.tool_use_id, content: record.content };
    }
  }
  return null;
}

export async function* runJsonlCliRuntime(
  options: CliRuntimeOptions,
): AsyncGenerator<RuntimeRunResultMessage> {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderr = "";
  let sessionId = options.sessionState?.sessionId ?? null;
  const pendingToolCalls = new Map<string, string>();

  const queue: RuntimeRunResultMessage[] = [];
  let queueResolver: (() => void) | null = null;
  let processDone = false;
  let processError: Error | null = null;
  let cancelled = false;
  let stopAfterApprovalTool = false;

  const cancelProcess = () => {
    cancelled = true;
    if (!child.killed) child.kill("SIGTERM");
    processError = new Error("Agent run cancelled");
    queueResolver?.();
  };
  if (options.signal?.aborted) {
    cancelProcess();
  } else {
    options.signal?.addEventListener("abort", cancelProcess, { once: true });
  }

  function push(message: RuntimeRunResultMessage) {
    if (message.providerSessionState?.sessionId) {
      sessionId = message.providerSessionState.sessionId;
    }
    queue.push(message);
    queueResolver?.();
  }

  function handleJsonLine(line: string) {
    if (!line.trim()) return;
    if (stopAfterApprovalTool) return;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      push({ type: "tool_use_summary", summary: line });
      return;
    }

    const eventError = errorFromJsonEvent(event);
    if (eventError) {
      processError = eventError;
      if (!child.killed) child.kill("SIGTERM");
      queueResolver?.();
      return;
    }

    for (const message of generateSyntheticSdkMessagesFromJsonEvent({
      runtimeId: options.runtimeId,
      event,
      settings: options.settings,
      sessionState: sessionId
        ? { runtimeId: options.runtimeId, sessionId }
        : options.sessionState ?? null,
      pendingToolCalls,
    })) {
      if (message.providerSessionState?.sessionId) {
        sessionId = message.providerSessionState.sessionId;
      }
      const result = toolResult(message);
      const shouldStopAfterTool =
        result !== null &&
        approvalToolResultShouldStop(
          pendingToolCalls.get(result.id),
          result.content,
        );
      push(message);
      if (shouldStopAfterTool && !child.killed) {
        stopAfterApprovalTool = true;
        child.kill("SIGTERM");
        break;
      }
    }
  }

  child.stdout.setEncoding("utf-8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) handleJsonLine(line);
  });

  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  child.on("error", (error) => {
    processError = error;
    processDone = true;
    queueResolver?.();
  });

  child.on("close", (code, signal) => {
    if (stdoutBuffer.trim()) handleJsonLine(stdoutBuffer);
    if (code && !cancelled) {
      processError = new Error(
        `${options.command} exited with ${code}${signal ? ` (${signal})` : ""}${stderr ? `\n\nstderr:\n${stderr}` : ""}`,
      );
    }
    processDone = true;
    queueResolver?.();
  });

  while (!processDone || queue.length > 0) {
    while (queue.length > 0) {
      yield queue.shift()!;
    }
    if (processDone) break;
    await new Promise<void>((resolve) => {
      queueResolver = resolve;
    });
    queueResolver = null;
  }

  options.signal?.removeEventListener("abort", cancelProcess);
  if (processError) throw processError;

  if (sessionId) {
    yield {
      type: "system",
      subtype: "init",
      session_id: sessionId,
      providerSessionState: {
        runtimeId: options.runtimeId,
        sessionId,
        format: `${options.runtimeId}-session`,
      },
    };
  }
}
