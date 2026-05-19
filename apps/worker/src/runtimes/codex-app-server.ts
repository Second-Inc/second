import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  AgentRuntimeSettings,
  ProviderSessionState,
  RuntimeRunResultMessage,
} from "./types.js";
import { estimateOpenAiCostUsd } from "./openai-pricing.js";

type JsonObject = Record<string, unknown>;

type CodexAppServerOptions = {
  command: string;
  cwd: string;
  env: Record<string, string>;
  apiKey?: string;
  settings: AgentRuntimeSettings;
  systemPrompt: string;
  prompt: string;
  allowedTools?: string[];
  sessionState?: ProviderSessionState | null;
  signal?: AbortSignal;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type TokenUsageBreakdown = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

type SearchResult = {
  title: string;
  url: string;
};

type PendingWebSearch = {
  id: string;
  input: JsonObject;
  action: JsonObject | null;
  results: SearchResult[];
  emittedResultCount: number;
};

let syntheticId = 0;

function nextSyntheticId(prefix: string): string {
  syntheticId += 1;
  return `${prefix}_${syntheticId}`;
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeToolName(server: string | null, tool: string): string {
  if (tool.startsWith("mcp__")) return tool;
  if (server) return `mcp__${server}__${tool}`;
  const lower = tool.toLowerCase();
  const builtin: Record<string, string> = {
    bash: "Bash",
    shell: "Bash",
    command: "Bash",
    edit: "Edit",
    write: "Write",
    read: "Read",
    grep: "Grep",
    glob: "Glob",
    webfetch: "WebFetch",
    web_fetch: "WebFetch",
    websearch: "WebSearch",
    web_search: "WebSearch",
  };
  return builtin[lower] ?? tool;
}

function isBrokeredMcpServer(serverName: string | null): serverName is "second" | "app_tools" | "app_data" {
  return serverName === "second" || serverName === "app_tools" || serverName === "app_data";
}

function canonicalMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

function mcpApprovalToolName(params: JsonObject): string | null {
  const meta = asRecord(params._meta);
  const toolName =
    stringValue(meta.tool_name) ??
    stringValue(meta.toolName) ??
    stringValue(asRecord(meta.tool).name);
  if (toolName) return toolName;

  const message = stringValue(params.message);
  const match = message?.match(/tool\s+"([^"]+)"/i);
  return match?.[1] ?? null;
}

function textStreamStart(itemId: string): RuntimeRunResultMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", id: itemId },
    },
  };
}

function textStreamDelta(delta: string): RuntimeRunResultMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: delta },
    },
  };
}

function reasoningStreamStart(itemId: string): RuntimeRunResultMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", id: itemId },
    },
  };
}

function reasoningStreamDelta(delta: string): RuntimeRunResultMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: delta },
    },
  };
}

function streamStop(): RuntimeRunResultMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_stop",
      index: 0,
    },
  };
}

function inputJsonDelta(partialJson: string): RuntimeRunResultMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: partialJson },
    },
  };
}

function toolUseStart(
  id: string,
  name: string,
): RuntimeRunResultMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id,
        name,
      },
    },
  };
}

function toolUseMessages(
  id: string,
  name: string,
  input: unknown,
): RuntimeRunResultMessage[] {
  return [
    toolUseStart(id, name),
    inputJsonDelta(JSON.stringify(coerceToolInput(input))),
    streamStop(),
  ];
}

function toolResultMessage(
  id: string,
  content: unknown,
): RuntimeRunResultMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content }],
    },
  };
}

function toolOutputDeltaMessage(input: {
  id: string;
  toolName: string;
  delta: string;
  output: string;
  status: "running" | "completed";
}): RuntimeRunResultMessage {
  return {
    type: "tool_output_delta",
    tool_use_id: input.id,
    toolName: input.toolName,
    delta: input.delta,
    output: input.output,
    status: input.status,
  };
}

function assistantTextMessage(text: string): RuntimeRunResultMessage {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

function usageMessage(
  settings: AgentRuntimeSettings,
  usage: TokenUsageBreakdown | null,
  durationMs: number,
): RuntimeRunResultMessage {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const cacheReadInputTokens = usage?.cachedInputTokens ?? 0;
  const costUSD = estimateOpenAiCostUsd({
    model: settings.model,
    inputTokens,
    outputTokens,
    cachedInputTokens: cacheReadInputTokens,
  });
  return {
    type: "result",
    total_cost_usd: costUSD,
    duration_ms: durationMs,
    duration_api_ms: 0,
    num_turns: 1,
    modelUsage: {
      [settings.model]: {
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens: 0,
        costUSD,
      },
    },
  };
}

function systemInitMessage(
  threadId: string,
  existingState?: ProviderSessionState | null,
): RuntimeRunResultMessage {
  return {
    type: "system",
    subtype: "init",
    session_id: threadId,
    providerSessionState: {
      runtimeId: "codex-cli",
      sessionId: threadId,
      data: existingState?.data ?? null,
      format: "codex-cli-session",
    },
  };
}

function appServerErrorMessage(error: unknown): string {
  const record = asRecord(error);
  const message = stringValue(record.message);
  if (message) return message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isMissingCodexThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no\s+(rollout|thread|session)\s+found|thread .*not found|rollout .*not found/i.test(
    message,
  );
}

function itemType(item: JsonObject): string {
  return String(item.type ?? "");
}

function mcpToolCallName(item: JsonObject): string {
  return normalizeToolName(
    stringValue(item.server),
    stringValue(item.tool) ?? "unknown",
  );
}

function isBlockingApprovalTool(name: string): boolean {
  return (
    name === "mcp__second__present_plan" ||
    name === "mcp__second__present_suggestions" ||
    name === "mcp__second__present_agents" ||
    name === "mcp__second__set_onboarding_context"
  );
}

function coerceToolInput(input: unknown): unknown {
  if (typeof input !== "string") return input ?? {};
  try {
    return JSON.parse(input);
  } catch {
    return { input };
  }
}

function toolResultContent(item: JsonObject): unknown {
  const error = asRecord(item.error);
  const errorMessage = stringValue(error.message);
  if (errorMessage) return errorMessage;
  return item.result ?? {
    status: item.status,
    durationMs: item.durationMs ?? null,
  };
}

function commandResultContent(item: JsonObject): unknown {
  const output = stringValue(item.aggregatedOutput);
  if (output) return output;

  const status = stringValue(item.status) ?? "completed";
  const exitCode =
    typeof item.exitCode === "number" ? ` with exit code ${item.exitCode}` : "";
  return `Command ${status}${exitCode}.`;
}

function patchChangeKind(change: JsonObject): string {
  const kind = change.kind;
  if (typeof kind === "string") return kind;
  return String(asRecord(kind).type ?? "");
}

function firstFileChange(item: JsonObject): JsonObject | null {
  const first = asArray(item.changes)[0];
  const change = asRecord(first);
  return Object.keys(change).length > 0 ? change : null;
}

function diffParts(diff: string): { oldString: string; newString: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];

  for (const line of diff.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith("+")) {
      newLines.push(line.slice(1));
    }
  }

  if (oldLines.length === 0 && newLines.length === 0) {
    return { oldString: "", newString: diff };
  }

  return {
    oldString: oldLines.join("\n"),
    newString: newLines.join("\n"),
  };
}

function fileChangeToolName(item: JsonObject): string {
  const changes = asArray(item.changes)
    .map(asRecord)
    .filter((change) => Object.keys(change).length > 0);
  if (changes.length === 0) return "Edit";
  return changes.every((change) => patchChangeKind(change) === "add")
    ? "Write"
    : "Edit";
}

function fileChangeInput(item: JsonObject): unknown {
  const change = firstFileChange(item);
  if (!change) {
    return {
      changes: item.changes ?? [],
      status: item.status,
    };
  }

  const filePath = stringValue(change.path) ?? "";
  const diff = stringValue(change.diff) ?? "";
  const kind = patchChangeKind(change);
  const parts = diffParts(diff);

  if (kind === "add") {
    return {
      file_path: filePath,
      content: diff,
      status: item.status,
      changes: item.changes ?? [],
    };
  }

  return {
    file_path: filePath,
    old_string: parts.oldString,
    new_string: kind === "delete" ? "" : parts.newString,
    changes: item.changes ?? [],
    status: item.status,
  };
}

function stripDiffPathPrefix(filePath: string): string {
  const trimmed = filePath.trim().replace(/^"|"$/g, "");
  if (!trimmed || trimmed === "/dev/null") return "";
  return trimmed.startsWith("a/") || trimmed.startsWith("b/")
    ? trimmed.slice(2)
    : trimmed;
}

function diffHeaderPath(line: string, prefix: string): string {
  const value = line.slice(prefix.length).trim();
  const token = value.match(/^"([^"]+)"/)?.[1] ?? value.split(/\s+/)[0] ?? "";
  return stripDiffPathPrefix(token);
}

function gitDiffHeaderPaths(line: string): { oldPath: string; newPath: string } {
  const match = line.match(/^diff --git\s+(.+?)\s+(.+)$/);
  if (!match) return { oldPath: "", newPath: "" };
  return {
    oldPath: stripDiffPathPrefix(match[1] ?? ""),
    newPath: stripDiffPathPrefix(match[2] ?? ""),
  };
}

function parseUnifiedDiffChanges(diff: string): JsonObject[] {
  const changes: JsonObject[] = [];
  let section: string[] = [];
  let headerOldPath = "";
  let headerNewPath = "";
  let oldPath = "";
  let newPath = "";

  const flush = () => {
    if (section.length === 0) return;
    const path = newPath || oldPath || headerNewPath || headerOldPath;
    if (!path) {
      section = [];
      headerOldPath = "";
      headerNewPath = "";
      oldPath = "";
      newPath = "";
      return;
    }

    const kind = !oldPath && newPath
      ? "add"
      : oldPath && !newPath
        ? "delete"
        : "edit";
    changes.push({
      path,
      kind,
      diff: section.join("\n"),
    });
    section = [];
    headerOldPath = "";
    headerNewPath = "";
    oldPath = "";
    newPath = "";
  };

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      section = [line];
      const paths = gitDiffHeaderPaths(line);
      headerOldPath = paths.oldPath;
      headerNewPath = paths.newPath;
      continue;
    }

    if (section.length === 0 && !line.trim()) continue;
    if (section.length === 0) section = [];
    section.push(line);

    if (line.startsWith("--- ")) {
      oldPath = diffHeaderPath(line, "--- ");
    } else if (line.startsWith("+++ ")) {
      newPath = diffHeaderPath(line, "+++ ");
    }
  }

  flush();
  return changes;
}

function compactTraceObject(input: JsonObject): JsonObject {
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(asRecord(value)).length === 0
    ) {
      continue;
    }
    output[key] = value;
  }
  return output;
}

function truncateTraceValue(value: unknown, maxLength = 180): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function traceDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function summarizeChangesForTrace(changesValue: unknown): JsonObject {
  const changes = asArray(changesValue)
    .map(asRecord)
    .filter((change) => Object.keys(change).length > 0);
  let additions = 0;
  let deletions = 0;
  const files = changes.slice(0, 8).map((change) => {
    const diff = stringValue(change.diff) ?? "";
    const stats = traceDiffStats(diff);
    additions += stats.additions;
    deletions += stats.deletions;
    return compactTraceObject({
      path: stringValue(change.path),
      kind: patchChangeKind(change),
      additions: stats.additions,
      deletions: stats.deletions,
      diffChars: diff.length,
    });
  });

  for (const change of changes.slice(8)) {
    const stats = traceDiffStats(stringValue(change.diff) ?? "");
    additions += stats.additions;
    deletions += stats.deletions;
  }

  return compactTraceObject({
    count: changes.length,
    additions,
    deletions,
    files,
    truncated: changes.length > files.length ? changes.length - files.length : undefined,
  });
}

function summarizeUnifiedDiffForTrace(diff: string): JsonObject {
  const changes = parseUnifiedDiffChanges(diff);
  return compactTraceObject({
    diffChars: diff.length,
    ...summarizeChangesForTrace(changes),
  });
}

function summarizeCodexItemForTrace(item: JsonObject): JsonObject {
  const type = itemType(item);
  return compactTraceObject({
    id: stringValue(item.id),
    type,
    status: stringValue(item.status),
    command: type === "commandExecution"
      ? truncateTraceValue(item.command)
      : undefined,
    cwd: type === "commandExecution" ? truncateTraceValue(item.cwd) : undefined,
    aggregatedOutputChars: typeof item.aggregatedOutput === "string"
      ? item.aggregatedOutput.length
      : undefined,
    exitCode: typeof item.exitCode === "number" ? item.exitCode : undefined,
    fileChanges: type === "fileChange"
      ? summarizeChangesForTrace(item.changes)
      : undefined,
    mcpServer: type === "mcpToolCall" ? stringValue(item.server) : undefined,
    mcpTool: type === "mcpToolCall" ? stringValue(item.tool) : undefined,
    webQuery: type === "webSearch" ? truncateTraceValue(item.query) : undefined,
    webAction: type === "webSearch" ? asRecord(item.action).type : undefined,
    dynamicTool: type === "dynamicToolCall" ? stringValue(item.tool) : undefined,
    textChars: type === "agentMessage" && typeof item.text === "string"
      ? item.text.length
      : undefined,
  });
}

function summarizeCodexNotificationForTrace(
  method: string,
  params: JsonObject,
): JsonObject | null {
  if (
    method === "item/agentMessage/delta" ||
    method === "item/reasoning/textDelta" ||
    method === "item/reasoning/summaryTextDelta"
  ) {
    return null;
  }

  const item = asRecord(params.item);
  const turn = asRecord(params.turn);
  const delta = stringValue(params.delta) ?? stringValue(params.message);

  return compactTraceObject({
    method,
    turnId: stringValue(params.turnId) ?? stringValue(turn.id),
    itemId: stringValue(params.itemId) ?? stringValue(item.id),
    item: Object.keys(item).length > 0 ? summarizeCodexItemForTrace(item) : undefined,
    turnStatus: stringValue(turn.status),
    durationMs: typeof turn.durationMs === "number" ? turn.durationMs : undefined,
    diff: method === "turn/diff/updated" && typeof params.diff === "string"
      ? summarizeUnifiedDiffForTrace(params.diff)
      : undefined,
    deltaChars: delta?.length,
  });
}

function summarizeRuntimeMessageForTrace(message: RuntimeRunResultMessage): JsonObject | null {
  if (message.type === "stream_event") {
    const event = asRecord(message.event);
    const block = asRecord(event.content_block);
    const delta = asRecord(event.delta);
    const deltaType = stringValue(delta.type);

    if (
      event.type === "content_block_delta" &&
      deltaType !== "input_json_delta"
    ) {
      return null;
    }

    return compactTraceObject({
      type: message.type,
      eventType: stringValue(event.type),
      blockType: stringValue(block.type),
      toolId: stringValue(block.id),
      toolName: stringValue(block.name),
      deltaType,
      inputJsonChars: typeof delta.partial_json === "string"
        ? delta.partial_json.length
        : undefined,
    });
  }

  if (message.type === "user") {
    const content = asArray(asRecord(message.message).content);
    const toolResult = asRecord(content.find((block) => asRecord(block).type === "tool_result"));
    if (Object.keys(toolResult).length === 0) return null;
    return compactTraceObject({
      type: message.type,
      toolResultId: stringValue(toolResult.tool_use_id),
      content: summarizeToolContentForTrace(toolResult.content),
    });
  }

  if (message.type === "tool_output_delta") {
    return compactTraceObject({
      type: message.type,
      toolUseId: stringValue(message.tool_use_id),
      toolName: stringValue(message.toolName),
      outputChars: typeof message.output === "string" ? message.output.length : undefined,
      deltaChars: typeof message.delta === "string" ? message.delta.length : undefined,
      status: stringValue(message.status),
    });
  }

  if (message.type === "result" || message.type === "error" || message.type === "system") {
    return compactTraceObject({
      type: message.type,
      subtype: stringValue(message.subtype),
      sessionId: stringValue(message.session_id),
      durationMs: typeof message.duration_ms === "number" ? message.duration_ms : undefined,
    });
  }

  return null;
}

function summarizeToolContentForTrace(content: unknown): JsonObject {
  if (typeof content === "string") {
    return { textChars: content.length, preview: truncateTraceValue(content, 120) };
  }
  const record = asRecord(content);
  if (Object.keys(record).length === 0) {
    return { kind: typeof content };
  }
  return compactTraceObject({
    status: stringValue(record.status),
    fileChanges: Array.isArray(record.changes)
      ? summarizeChangesForTrace(record.changes)
      : undefined,
    query: truncateTraceValue(record.query),
    resultsCount: Array.isArray(record.results) ? record.results.length : undefined,
  });
}

function webSearchAction(item: JsonObject): JsonObject {
  return asRecord(item.action);
}

function webSearchToolName(item: JsonObject): string {
  const actionType = String(webSearchAction(item).type ?? "");
  return actionType === "openPage" ||
    actionType === "open_page" ||
    actionType === "findInPage" ||
    actionType === "find_in_page"
    ? "WebFetch"
    : "WebSearch";
}

function webSearchInput(item: JsonObject): JsonObject {
  const action = webSearchAction(item);
  const actionType = String(action.type ?? "");

  if (actionType === "openPage" || actionType === "open_page") {
    return { url: stringValue(action.url) ?? "" };
  }

  if (actionType === "findInPage" || actionType === "find_in_page") {
    return {
      query: stringValue(action.pattern) ?? stringValue(item.query) ?? "",
      url: stringValue(action.url) ?? "",
      pattern: stringValue(action.pattern) ?? "",
    };
  }

  const queries = asArray(action.queries).filter((query): query is string =>
    typeof query === "string",
  );
  return {
    query:
      stringValue(item.query) ??
      stringValue(action.query) ??
      queries.join(" "),
  };
}

function webSearchResultContent(
  item: JsonObject,
  results: SearchResult[] = [],
): unknown {
  const action = webSearchAction(item);
  const input = webSearchInput(item);
  return {
    ...input,
    query: stringValue(input.query) ?? stringValue(item.query) ?? null,
    action: Object.keys(action).length > 0 ? action : null,
    results,
  };
}

function webSearchSource(item: JsonObject): SearchResult | null {
  const action = webSearchAction(item);
  const actionType = String(action.type ?? "");
  if (actionType !== "openPage" && actionType !== "open_page") return null;

  const url = stringValue(action.url) ?? stringValue(item.query);
  if (!url) return null;
  return searchResultFromUrl(url);
}

function searchResultFromUrl(url: string): SearchResult {
  let title = url;
  try {
    title = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // Keep the URL as the title when it is not parseable.
  }

  return { title, url };
}

function searchResultsFromText(text: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s"',)\]}>]+/g)) {
    const url = match[0].replace(/[.)]+$/, "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push(searchResultFromUrl(url));
  }
  return results;
}

function tokenUsageFromNotification(params: JsonObject): TokenUsageBreakdown | null {
  const tokenUsage = asRecord(params.tokenUsage);
  const last = asRecord(tokenUsage.last);
  if (Object.keys(last).length === 0) return null;
  return {
    inputTokens: numberValue(last.inputTokens),
    outputTokens: numberValue(last.outputTokens),
    cachedInputTokens: numberValue(last.cachedInputTokens),
  };
}

function sandboxMode(value: string): "read-only" | "workspace-write" | "danger-full-access" {
  if (value === "read-only" || value === "danger-full-access") return value;
  return "workspace-write";
}

function isResponse(message: JsonObject): boolean {
  return message.id !== undefined && message.method === undefined;
}

function isRequest(message: JsonObject): boolean {
  return message.id !== undefined && typeof message.method === "string";
}

function isNotification(message: JsonObject): boolean {
  return message.id === undefined && typeof message.method === "string";
}

type ActiveCodexRun = {
  handleServerRequest: (message: JsonObject) => void;
  handleNotification: (message: JsonObject) => void;
  onProcessClose: (error: Error | null) => void;
};

export type CodexAppServerClientOptions = {
  command: string;
  cwd: string;
  env: Record<string, string>;
  apiKey?: string;
  onClose?: () => void;
};

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams;
  private stdoutBuffer = "";
  private stderr = "";
  private requestId = 0;
  private closed = false;
  private closing = false;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  private readyPromise: Promise<void>;
  private activeRun: ActiveCodexRun | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private readonly command: string;
  private readonly onClose?: () => void;
  private readonly apiKey?: string;

  constructor(options: CodexAppServerClientOptions) {
    this.command = options.command;
    this.onClose = options.onClose;
    this.apiKey =
      options.apiKey?.trim() ||
      options.env.OPENAI_API_KEY?.trim() ||
      options.env.CODEX_API_KEY?.trim();
    this.child = spawn(options.command, ["app-server", "--listen", "stdio://"], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.child.stdout.setEncoding("utf-8");
    this.child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) this.handleLine(line);
    });

    this.child.stderr.setEncoding("utf-8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });

    this.child.on("error", (error) => {
      this.closed = true;
      for (const pending of this.pendingRequests.values()) {
        pending.reject(error);
      }
      this.pendingRequests.clear();
      this.activeRun?.onProcessClose(error);
      this.activeRun = null;
      this.onClose?.();
    });

    this.child.on("close", (code, signal) => {
      if (this.killTimer) clearTimeout(this.killTimer);
      if (this.stdoutBuffer.trim()) this.handleLine(this.stdoutBuffer);
      this.closed = true;
      for (const pending of this.pendingRequests.values()) {
        pending.reject(new Error("Codex app-server exited before responding"));
      }
      this.pendingRequests.clear();
      const error =
        !this.closing && (code || signal)
          ? new Error(
              `${this.command} app-server exited with ${code ?? "signal"}${
                signal ? ` (${signal})` : ""
              }${this.stderr ? `\n\nstderr:\n${this.stderr}` : ""}`,
            )
          : null;
      this.activeRun?.onProcessClose(error);
      this.activeRun = null;
      this.onClose?.();
    });

    this.readyPromise = this.initialize();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  prewarm(): Promise<void> {
    return this.readyPromise;
  }

  close(): void {
    if (this.closed || this.closing) return;
    this.closing = true;
    if (!this.child.killed) {
      this.child.kill("SIGTERM");
      this.killTimer = setTimeout(() => {
        if (!this.child.killed) this.child.kill("SIGKILL");
      }, 2000);
    }
  }

  private writeJson(message: JsonObject) {
    if (this.closed || this.child.stdin.destroyed) {
      throw new Error("Codex app-server stdin is closed");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    this.requestId += 1;
    const id = this.requestId;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(String(id), { resolve, reject });
    });
    this.writeJson({ id, method, params });
    return promise;
  }

  private sendNotification(method: string, params?: unknown) {
    if (params === undefined) {
      this.writeJson({ method });
    } else {
      this.writeJson({ method, params });
    }
  }

  private sendResponse(id: unknown, result: unknown) {
    this.writeJson({ id, result });
  }

  private sendResponseError(id: unknown, message: string) {
    this.writeJson({
      id,
      error: {
        code: -32603,
        message,
      },
    });
  }

  private async initialize() {
    await this.sendRequest("initialize", {
      clientInfo: {
        name: "second-worker",
        title: "Second Worker",
        version: "0.1.0",
      },
      capabilities: null,
    });
    this.sendNotification("initialized");
    if (this.apiKey) {
      try {
        await this.sendRequest("account/login/start", {
          type: "apiKey",
          apiKey: this.apiKey,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Codex app-server API key login failed: ${message}`);
      }
    }
  }

  private handleResponse(message: JsonObject) {
    const id = String(message.id);
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    this.pendingRequests.delete(id);

    if (message.error !== undefined) {
      pending.reject(new Error(appServerErrorMessage(message.error)));
      return;
    }

    pending.resolve(message.result);
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    const message = asRecord(parsed);
    if (isResponse(message)) {
      this.handleResponse(message);
      return;
    }

    const activeRun = this.activeRun;
    if (!activeRun) {
      if (isRequest(message) && message.id !== undefined) {
        this.sendResponseError(message.id, "No active Codex turn is available.");
      }
      return;
    }

    if (isRequest(message)) {
      activeRun.handleServerRequest(message);
    } else if (isNotification(message)) {
      activeRun.handleNotification(message);
    }
  }

  async *runTurn(
    options: CodexAppServerOptions,
  ): AsyncGenerator<RuntimeRunResultMessage> {
    if (this.activeRun) {
      throw new Error("Codex app-server is already processing another turn.");
    }
    await this.readyPromise;
    if (this.closed) throw new Error("Codex app-server is closed.");

    let threadId: string | null =
      options.sessionState?.runtimeId === "codex-cli"
        ? options.sessionState.sessionId
        : null;
    let currentTurnId: string | null = null;
    let currentTurnUsage: TokenUsageBreakdown | null = null;
    let processDone = false;
    let processError: Error | null = null;
    let turnCompleted = false;
    let cancelled = false;
    const traceEnabled = process.env.SECOND_CODEX_TRACE === "1";
    const traceStartedAt = Date.now();

    const pendingToolCalls = new Map<string, string>();
    const commandOutputByItemId = new Map<string, string>();
    let latestCommandExecutionItemId: string | null = null;
    const startedItemIds = new Set<string>();
    const openTextItems = new Set<string>();
    const textItemsWithDeltas = new Set<string>();
    const openReasoningItems = new Set<string>();
    const pendingWebSearches: PendingWebSearch[] = [];
    const webSearchSources: SearchResult[] = [];

    const queue: RuntimeRunResultMessage[] = [];
    let queueResolver: (() => void) | null = null;

    const trace = (event: string, details: JsonObject = {}) => {
      if (!traceEnabled) return;
      console.info(
        `[codex-app-server +${Date.now() - traceStartedAt}ms] ${event} ${JSON.stringify(compactTraceObject(details))}`,
      );
    };

    const wake = () => {
      queueResolver?.();
    };

    const cancelRun = () => {
      cancelled = true;
      processError = new Error("Agent run cancelled");
      processDone = true;
      terminateChild();
      wake();
    };

    const push = (message: RuntimeRunResultMessage) => {
      if (message.providerSessionState?.sessionId) {
        threadId = message.providerSessionState.sessionId;
      }
      const summary = summarizeRuntimeMessageForTrace(message);
      if (summary) trace("worker.push", summary);
      queue.push(message);
      wake();
    };

    const pushMany = (messages: RuntimeRunResultMessage[]) => {
      for (const message of messages) push(message);
    };

    const appendSearchResult = (target: SearchResult[], source: SearchResult): boolean => {
      if (target.some((result) => result.url === source.url)) return false;
      target.push(source);
      return true;
    };

    const webSearchOutput = (search: PendingWebSearch): JsonObject => ({
      ...search.input,
      action: search.action,
      results: search.results,
    });

    const emitWebSearchResult = (search: PendingWebSearch) => {
      push(toolResultMessage(search.id, webSearchOutput(search)));
      pendingToolCalls.delete(search.id);
      search.emittedResultCount = search.results.length;
    };

    const hydratePendingWebSearches = () => {
      if (webSearchSources.length === 0) return;
      for (const search of pendingWebSearches) {
        if (search.results.length > 0) continue;
        for (const source of webSearchSources) {
          appendSearchResult(search.results, source);
        }
      }
    };

    const emitPendingWebSearchUpdates = () => {
      if (pendingWebSearches.length === 0) return;
      hydratePendingWebSearches();
      for (const search of pendingWebSearches) {
        if (search.emittedResultCount !== search.results.length) {
          emitWebSearchResult(search);
        }
      }
    };

    const rememberWebSearchSource = (source: SearchResult) => {
      appendSearchResult(webSearchSources, source);
      const latestSearch = pendingWebSearches[pendingWebSearches.length - 1];
      if (latestSearch) appendSearchResult(latestSearch.results, source);
      emitPendingWebSearchUpdates();
    };

    const rememberWebSearchSources = (sources: SearchResult[]) => {
      for (const source of sources) rememberWebSearchSource(source);
    };

    const completePendingWebSearches = () => {
      if (pendingWebSearches.length === 0) return;
      emitPendingWebSearchUpdates();
      pendingWebSearches.splice(0);
    };

    const emitCompletedTool = (
      id: string,
      name: string,
      input: unknown,
      output: unknown,
    ) => {
      pendingToolCalls.set(id, name);
      pushMany(toolUseMessages(id, name, input));
      push(toolResultMessage(id, output));
      pendingToolCalls.delete(id);
    };

    const shouldHandleTurnScopedNotification = (
      params: JsonObject,
      options: { allowMissingTurnId?: boolean } = {},
    ): boolean => {
      const notificationTurnId = stringValue(params.turnId);
      if (!notificationTurnId) return options.allowMissingTurnId === true;
      if (!currentTurnId) currentTurnId = notificationTurnId;
      return notificationTurnId === currentTurnId;
    };

    const pushError = (error: string) => {
      push({ type: "error", error });
    };

    const terminateChild = () => {
      this.close();
    };

    const pendingMcpToolName = (serverName: string): string | null => {
      const prefix = canonicalMcpToolName(serverName, "");
      for (const toolName of pendingToolCalls.values()) {
        if (toolName.startsWith(prefix)) return toolName.slice(prefix.length);
      }
      return null;
    };

    const mcpToolAllowed = (serverName: string, toolName: string): boolean => {
      if (!options.allowedTools) return true;
      return options.allowedTools.includes(canonicalMcpToolName(serverName, toolName));
    };

    const mcpElicitationResponse = (params: JsonObject): JsonObject => {
      const meta = asRecord(params._meta);
      const serverName = stringValue(params.serverName);
      const toolName = serverName
        ? mcpApprovalToolName(params) ?? pendingMcpToolName(serverName)
        : null;

      if (
        meta.codex_approval_kind === "mcp_tool_call" &&
        isBrokeredMcpServer(serverName) &&
        toolName &&
        mcpToolAllowed(serverName, toolName)
      ) {
        return { action: "accept", content: {}, _meta: null };
      }

      return { action: "decline", content: null, _meta: null };
    };

    const handleServerRequest = (message: JsonObject) => {
      const method = String(message.method);
      const id = message.id;
      if (id === undefined) return;

      try {
        if (
          method === "item/commandExecution/requestApproval" ||
          method === "execCommandApproval"
        ) {
          this.sendResponse(id, { decision: "decline" });
          return;
        }

        if (
          method === "item/fileChange/requestApproval" ||
          method === "applyPatchApproval"
        ) {
          this.sendResponse(id, { decision: "decline" });
          return;
        }

        if (method === "item/permissions/requestApproval") {
          this.sendResponse(id, { permissions: {}, scope: "turn" });
          return;
        }

        if (method === "mcpServer/elicitation/request") {
          this.sendResponse(id, mcpElicitationResponse(asRecord(message.params)));
          return;
        }

        if (method === "item/tool/requestUserInput") {
          this.sendResponse(id, { answers: {} });
          return;
        }

        if (method === "item/tool/call") {
          this.sendResponse(id, {
            contentItems: [
              {
                type: "inputText",
                text: "Second does not execute client-side dynamic Codex tools.",
              },
            ],
            success: false,
          });
          return;
        }

        if (method === "account/chatgptAuthTokens/refresh") {
          this.sendResponseError(
            id,
            "Second does not provide host-level ChatGPT token refresh; use a Codex CLI login or provider API key available to this runtime.",
          );
          return;
        }

        this.sendResponseError(id, `Unsupported Codex app-server request: ${method}`);
      } catch (error) {
        processError = error instanceof Error ? error : new Error(String(error));
        terminateChild();
        wake();
      }
    };

    const handleStartedItem = (item: JsonObject) => {
      const id = stringValue(item.id) ?? nextSyntheticId("codex_item");
      if (startedItemIds.has(id)) return;
      startedItemIds.add(id);

      const type = itemType(item);

      if (type === "agentMessage") {
        if (!openTextItems.has(id)) {
          openTextItems.add(id);
          push(textStreamStart(id));
        }
        return;
      }

      if (type === "reasoning") {
        if (!openReasoningItems.has(id)) {
          openReasoningItems.add(id);
          push(reasoningStreamStart(id));
        }
        return;
      }

      if (type === "mcpToolCall") {
        emitPendingWebSearchUpdates();
        const name = mcpToolCallName(item);
        pendingToolCalls.set(id, name);
        pushMany(toolUseMessages(id, name, item.arguments ?? {}));
        return;
      }

      if (type === "commandExecution") {
        emitPendingWebSearchUpdates();
        const name = "Bash";
        pendingToolCalls.set(id, name);
        latestCommandExecutionItemId = id;
        commandOutputByItemId.set(id, stringValue(item.aggregatedOutput) ?? "");
        pushMany(toolUseMessages(id, name, {
          command: item.command,
          cwd: item.cwd,
        }));
        return;
      }

      if (type === "fileChange") {
        emitPendingWebSearchUpdates();
        const name = fileChangeToolName(item);
        pendingToolCalls.set(id, name);
        pushMany(toolUseMessages(id, name, fileChangeInput(item)));
        return;
      }

      if (type === "webSearch") {
        return;
      }

      if (type === "dynamicToolCall") {
        emitPendingWebSearchUpdates();
        const name = normalizeToolName(null, stringValue(item.tool) ?? "unknown");
        pendingToolCalls.set(id, name);
        pushMany(toolUseMessages(id, name, item.arguments ?? {}));
      }
    };

    const handleCompletedItem = (item: JsonObject) => {
      const id = stringValue(item.id) ?? nextSyntheticId("codex_item");
      const type = itemType(item);

      if (type === "agentMessage") {
        const text = stringValue(item.text);
        if (openTextItems.delete(id)) {
          push(streamStop());
        } else if (text && !textItemsWithDeltas.has(id)) {
          push(assistantTextMessage(text));
        }
        if (text) rememberWebSearchSources(searchResultsFromText(text));
        completePendingWebSearches();
        return;
      }

      if (type === "reasoning") {
        if (openReasoningItems.delete(id)) push(streamStop());
        return;
      }

      if (type === "mcpToolCall") {
        emitPendingWebSearchUpdates();
        const name = pendingToolCalls.get(id) ?? mcpToolCallName(item);
        pendingToolCalls.set(id, name);
        push(toolResultMessage(id, toolResultContent(item)));
        pendingToolCalls.delete(id);
        if (isBlockingApprovalTool(name)) {
          turnCompleted = true;
          terminateChild();
          wake();
        }
        return;
      }

      if (type === "commandExecution") {
        emitPendingWebSearchUpdates();
        push(toolResultMessage(id, commandResultContent(item)));
        pendingToolCalls.delete(id);
        commandOutputByItemId.delete(id);
        if (latestCommandExecutionItemId === id) latestCommandExecutionItemId = null;
        return;
      }

      if (type === "fileChange") {
        emitPendingWebSearchUpdates();
        push(toolResultMessage(id, fileChangeInput(item)));
        pendingToolCalls.delete(id);
        return;
      }

      if (type === "webSearch") {
        const name = webSearchToolName(item);
        const input = webSearchInput(item);
        const action = webSearchAction(item);

        if (name === "WebSearch") {
          pendingToolCalls.set(id, name);
          pushMany(toolUseMessages(id, name, input));
          pendingWebSearches.push({
            id,
            input,
            action: Object.keys(action).length > 0 ? action : null,
            results: [],
            emittedResultCount: -1,
          });
          emitPendingWebSearchUpdates();
          return;
        }

        const source = webSearchSource(item);
        if (source && pendingWebSearches.length > 0) {
          rememberWebSearchSource(source);
          return;
        }
        if (!source && pendingWebSearches.length > 0) return;

        emitCompletedTool(id, name, input, webSearchResultContent(item));
        return;
      }

      if (type === "dynamicToolCall") {
        emitPendingWebSearchUpdates();
        push(toolResultMessage(id, item.contentItems ?? item.success ?? null));
        pendingToolCalls.delete(id);
      }
    };

    const handleNotification = (message: JsonObject) => {
      const method = String(message.method);
      const params = asRecord(message.params);
      const notificationSummary = summarizeCodexNotificationForTrace(method, params);
      if (notificationSummary) trace("codex.notify", notificationSummary);

      if (method === "error") {
        const error = asRecord(params.error);
        pushError(stringValue(error.message) ?? appServerErrorMessage(params.error));
        if (!params.willRetry) {
          turnCompleted = true;
          terminateChild();
        }
        return;
      }

      if (method === "thread/started") {
        const notificationThreadId =
          stringValue(params.threadId) ?? stringValue(asRecord(params.thread).id);
        if (notificationThreadId && notificationThreadId !== threadId) {
          threadId = notificationThreadId;
          push(systemInitMessage(notificationThreadId, options.sessionState));
        }
        return;
      }

      if (method === "thread/tokenUsage/updated") {
        if (shouldHandleTurnScopedNotification(params)) {
          currentTurnUsage = tokenUsageFromNotification(params);
        }
        return;
      }

      if (method === "turn/started") {
        const turn = asRecord(params.turn);
        const startedTurnId = stringValue(turn.id);
        if (startedTurnId && !currentTurnId) currentTurnId = startedTurnId;
        return;
      }

      if (method === "item/started") {
        if (shouldHandleTurnScopedNotification(params)) {
          handleStartedItem(asRecord(params.item));
        }
        return;
      }

      if (method === "item/agentMessage/delta") {
        if (!shouldHandleTurnScopedNotification(params)) return;
        const itemId = stringValue(params.itemId) ?? nextSyntheticId("codex_text");
        if (!openTextItems.has(itemId)) {
          openTextItems.add(itemId);
          push(textStreamStart(itemId));
        }
        textItemsWithDeltas.add(itemId);
        push(textStreamDelta(String(params.delta ?? "")));
        return;
      }

      if (
        method === "item/reasoning/textDelta" ||
        method === "item/reasoning/summaryTextDelta"
      ) {
        if (!shouldHandleTurnScopedNotification(params)) return;
        const itemId = stringValue(params.itemId) ?? nextSyntheticId("codex_reasoning");
        if (!openReasoningItems.has(itemId)) {
          openReasoningItems.add(itemId);
          push(reasoningStreamStart(itemId));
        }
        push(reasoningStreamDelta(String(params.delta ?? "")));
        return;
      }

      if (method === "item/completed") {
        if (shouldHandleTurnScopedNotification(params)) {
          handleCompletedItem(asRecord(params.item));
        }
        return;
      }

      if (method === "item/commandExecution/outputDelta") {
        if (!shouldHandleTurnScopedNotification(params)) return;
        const itemId = stringValue(params.itemId) ?? latestCommandExecutionItemId;
        const delta = stringValue(params.delta) ?? stringValue(params.message);
        if (!itemId || !delta) return;
        const output = `${commandOutputByItemId.get(itemId) ?? ""}${delta}`;
        commandOutputByItemId.set(itemId, output);
        push(toolOutputDeltaMessage({
          id: itemId,
          toolName: "Bash",
          delta,
          output,
          status: "running",
        }));
        return;
      }

      if (method === "item/fileChange/outputDelta") {
        return;
      }

      if (method === "item/mcpToolCall/progress") {
        const delta = stringValue(params.delta) ?? stringValue(params.message);
        if (delta) push({ type: "tool_use_summary", summary: delta });
        return;
      }

      if (method === "command/exec/outputDelta") {
        if (!shouldHandleTurnScopedNotification(params, { allowMissingTurnId: true })) return;
        const itemId = stringValue(params.itemId) ?? latestCommandExecutionItemId;
        const delta = stringValue(params.delta);
        if (!itemId || !delta) return;
        const output = `${commandOutputByItemId.get(itemId) ?? ""}${delta}`;
        commandOutputByItemId.set(itemId, output);
        push(toolOutputDeltaMessage({
          id: itemId,
          toolName: "Bash",
          delta,
          output,
          status: "running",
        }));
        return;
      }

      if (method === "turn/diff/updated") {
        if (!shouldHandleTurnScopedNotification(params)) return;
        return;
      }

      if (method === "turn/completed") {
        const turn = asRecord(params.turn);
        const completedTurnId = stringValue(turn.id);
        if (!completedTurnId) return;
        if (!currentTurnId) currentTurnId = completedTurnId;
        if (completedTurnId !== currentTurnId) return;
        completePendingWebSearches();
        for (const itemId of Array.from(openTextItems)) {
          openTextItems.delete(itemId);
          push(streamStop());
        }
        for (const itemId of Array.from(openReasoningItems)) {
          openReasoningItems.delete(itemId);
          push(streamStop());
        }
        turnCompleted = true;
        push(usageMessage(options.settings, currentTurnUsage, numberValue(turn.durationMs)));
        processDone = true;
        wake();
      }
    };

    const activeRun: ActiveCodexRun = {
      handleServerRequest,
      handleNotification,
      onProcessClose: (error) => {
        if (error && !turnCompleted) {
          processError = error;
        }
        processDone = true;
        wake();
      },
    };
    this.activeRun = activeRun;
    if (options.signal?.aborted) {
      cancelRun();
    } else {
      options.signal?.addEventListener("abort", cancelRun, { once: true });
    }

    const startPromise = (async () => {
      if (cancelled) return;
      const sandbox = sandboxMode(options.settings.params.sandbox ?? "workspace-write");
      trace("run.start", {
        model: options.settings.model,
        sandbox,
        resumed: Boolean(threadId),
      });
      let threadResult: unknown | null = null;
      if (threadId) {
        try {
          threadResult = await this.sendRequest("thread/resume", {
            threadId,
            model: options.settings.model,
            cwd: options.cwd,
            approvalPolicy: "never",
            sandbox,
            baseInstructions: options.systemPrompt,
            developerInstructions: "",
            persistExtendedHistory: false,
          });
        } catch (error) {
          if (!isMissingCodexThreadError(error)) throw error;
          console.warn(
            `[codex-app-server] stored thread is unavailable; starting a new thread (${threadId})`,
          );
          trace("thread.resume_missing", { threadId });
          threadId = null;
        }
      }

      threadResult ??= await this.sendRequest("thread/start", {
        model: options.settings.model,
        cwd: options.cwd,
        approvalPolicy: "never",
        sandbox,
        baseInstructions: options.systemPrompt,
        developerInstructions: "",
        experimentalRawEvents: false,
        persistExtendedHistory: false,
      });

      if (cancelled) return;
      const thread = asRecord(asRecord(threadResult).thread);
      const startedThreadId = stringValue(thread.id);
      if (!startedThreadId) throw new Error("Codex app-server did not return a thread id");
      trace("thread.ready", { threadId: startedThreadId });
      if (threadId !== startedThreadId) {
        threadId = startedThreadId;
        push(systemInitMessage(startedThreadId, options.sessionState));
      }

      if (cancelled) return;
      const turnResult = await this.sendRequest("turn/start", {
        threadId: startedThreadId,
        input: [
          {
            type: "text",
            text: options.prompt,
            text_elements: [],
          },
        ],
        cwd: options.cwd,
        approvalPolicy: "never",
        model: options.settings.model,
        effort: options.settings.params.reasoningEffort ?? "high",
        summary: "auto",
      });
      if (cancelled) return;
      const turn = asRecord(asRecord(turnResult).turn);
      const startedTurnId = stringValue(turn.id);
      if (!startedTurnId) throw new Error("Codex app-server did not return a turn id");
      currentTurnId = startedTurnId;
      trace("turn.start.response", {
        turnId: startedTurnId,
        initialItemCount: asArray(turn.items).length,
      });

      for (const item of asArray(turn.items)) {
        handleStartedItem(asRecord(item));
      }
    })().catch((error) => {
      processError = error instanceof Error ? error : new Error(String(error));
      terminateChild();
      wake();
    });

    try {
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

      await startPromise.catch(() => {
        // processError is thrown below.
      });

      if (processError) throw processError;
    } finally {
      options.signal?.removeEventListener("abort", cancelRun);
      if (this.activeRun === activeRun) this.activeRun = null;
    }
  }
}

export async function* runCodexAppServerRuntime(
  options: CodexAppServerOptions,
): AsyncGenerator<RuntimeRunResultMessage> {
  const client = new CodexAppServerClient({
    command: options.command,
    cwd: options.cwd,
    env: options.env,
    apiKey: options.apiKey,
  });
  try {
    yield* client.runTurn(options);
  } finally {
    client.close();
  }
}
