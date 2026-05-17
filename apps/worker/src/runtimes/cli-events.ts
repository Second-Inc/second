import { spawn } from "node:child_process";
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
};

function isBlockingApprovalTool(name: string | undefined): boolean {
  return (
    name === "mcp__second__present_plan" ||
    name === "mcp__second__present_suggestions" ||
    name === "mcp__second__present_agents" ||
    name === "mcp__second__set_onboarding_context"
  );
}

function toolResultId(message: RuntimeRunResultMessage): string | null {
  if (message.type !== "user") return null;
  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: unknown; tool_use_id?: unknown };
    if (
      record.type === "tool_result" &&
      typeof record.tool_use_id === "string"
    ) {
      return record.tool_use_id;
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

  function push(message: RuntimeRunResultMessage) {
    if (message.providerSessionState?.sessionId) {
      sessionId = message.providerSessionState.sessionId;
    }
    queue.push(message);
    queueResolver?.();
  }

  function handleJsonLine(line: string) {
    if (!line.trim()) return;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      push({ type: "tool_use_summary", summary: line });
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
      const resultId = toolResultId(message);
      const shouldStopAfterTool =
        resultId !== null && isBlockingApprovalTool(pendingToolCalls.get(resultId));
      push(message);
      if (shouldStopAfterTool && !child.killed) {
        child.kill("SIGTERM");
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
    if (code) {
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
