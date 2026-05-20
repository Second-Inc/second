import type { UIMessage } from "ai";
import type { AgentRuntimeId } from "@/lib/agent/runtime-registry";
import type { ProviderSessionState } from "@/lib/db/types";

const MAX_TRANSCRIPT_CHARS = 18_000;
const MAX_PART_CHARS = 1_600;
const APPROVAL_STOP_TOOL_NAMES = [
  "mcp__second__present_plan",
  "mcp__second__present_agents",
  "mcp__second__present_suggestions",
] as const;

type ApprovalStopToolName = (typeof APPROVAL_STOP_TOOL_NAMES)[number];

export type RuntimePromptHandoffDebug = {
  nativeHistoryMessageCount: number;
  nativeHandoffStart: number;
  approvalHandoffStart: number | null;
  approvalStopMessageIndex: number | null;
  approvalStopToolName: ApprovalStopToolName | null;
  handoffStart: number;
  handoffMessageCount: number;
  approvalContextIncluded: boolean;
  usedApprovalHandoff: boolean;
  latestUserTextLength: number;
};

type RuntimePromptInput = {
  messages: UIMessage[];
  nativeHistoryMessageCount: number;
  targetRuntimeId: AgentRuntimeId;
  targetModel: string;
  conversationKind?: "builder" | "workspace_agent";
};

type RuntimePromptHandoff = RuntimePromptHandoffDebug & {
  latestUserText: string;
  handoffMessages: UIMessage[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function truncate(value: string, maxLength = MAX_PART_CHARS): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function summarizeUnknown(value: unknown, maxLength = 700): string | null {
  const direct = stringValue(value);
  if (direct) return truncate(direct, maxLength);

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => summarizeUnknown(entry, Math.floor(maxLength / 2)))
      .filter(Boolean)
      .slice(0, 5);
    return entries.length > 0 ? truncate(entries.join("; "), maxLength) : null;
  }

  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;

  const preferredFields = [
    "summary",
    "result",
    "output",
    "content",
    "text",
    "error",
    "message",
    "url",
    "title",
  ];
  const fieldSummaries = preferredFields
    .map((key) => {
      const summary = summarizeUnknown(record[key], Math.floor(maxLength / 2));
      return summary ? `${key}: ${summary}` : null;
    })
    .filter(Boolean);
  if (fieldSummaries.length > 0) {
    return truncate(fieldSummaries.join("; "), maxLength);
  }

  try {
    return truncate(JSON.stringify(record), maxLength);
  } catch {
    return null;
  }
}

export function extractLatestUserText(messages: UIMessage[]): string {
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) return "";

  return lastUserMessage.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

function summarizePlanTool(input: Record<string, unknown>): string {
  const title = stringValue(input.title);
  const overview = stringValue(input.overview);
  const features = Array.isArray(input.features)
    ? input.features
        .map((feature) => stringValue(asRecord(feature).name))
        .filter(Boolean)
        .join(", ")
    : null;
  const agents = stringValue(input.agents);
  const backend = stringValue(input.backend);
  const dataFlow = stringValue(input.dataFlow);
  return truncate(
    [
      "Presented build plan.",
      title ? `Title: ${title}` : null,
      overview ? `Overview: ${overview}` : null,
      features ? `Features: ${features}` : null,
      agents ? `Agents: ${agents}` : null,
      backend ? `Backend: ${backend}` : null,
      dataFlow ? `Data flow: ${dataFlow}` : null,
    ].filter(Boolean).join(" "),
  );
}

function approvalStopToolName(message: UIMessage): ApprovalStopToolName | null {
  for (const rawPart of message.parts) {
    const part = asRecord(rawPart);
    if (part.type !== "dynamic-tool") continue;
    const toolName = stringValue(part.toolName);
    if (APPROVAL_STOP_TOOL_NAMES.includes(toolName as ApprovalStopToolName)) {
      return toolName as ApprovalStopToolName;
    }
  }
  return null;
}

function approvalStopLabel(toolName: ApprovalStopToolName): string {
  if (toolName === "mcp__second__present_plan") return "build plan";
  if (toolName === "mcp__second__present_agents") return "agent configuration";
  return "build suggestion";
}

function approvalHandoffStart(messages: UIMessage[]): {
  startIndex: number;
  messageIndex: number;
  toolName: ApprovalStopToolName;
} | null {
  const latestIndex = messages.length - 1;
  for (let index = latestIndex - 1; index >= 0; index -= 1) {
    const toolName = approvalStopToolName(messages[index]);
    if (!toolName) continue;
    return {
      startIndex: Math.max(0, index - 1),
      messageIndex: index,
      toolName,
    };
  }
  return null;
}

function summarizeToolPart(part: Record<string, unknown>): string | null {
  const toolName = stringValue(part.toolName);
  if (!toolName) return null;

  const input = asRecord(part.input);
  const output = summarizeUnknown(part.output);
  const withOutput = (summary: string): string =>
    output ? `${summary} Output: ${output}` : summary;

  if (toolName === "mcp__second__present_plan") {
    return withOutput(summarizePlanTool(input));
  }

  if (toolName === "mcp__second__present_suggestions") {
    const suggestions = Array.isArray(input?.suggestions)
      ? input.suggestions
          .map((item) => asRecord(item))
          .map((item) => stringValue(item?.title))
          .filter(Boolean)
          .join(", ")
      : null;
    return withOutput(
      suggestions
        ? `Presented build suggestions: ${truncate(suggestions, 300)}.`
        : "Presented build suggestions.",
    );
  }

  if (toolName === "mcp__second__present_agents") {
    return withOutput("Presented agent configuration for approval.");
  }

  if (toolName === "mcp__second__done_building") {
    return withOutput("Marked the app ready to preview.");
  }

  if (toolName === "Write" || toolName === "Edit" || toolName === "Read") {
    const filePath =
      stringValue(input.file_path) ??
      stringValue(input.path) ??
      stringValue(input.filePath);
    return withOutput(filePath ? `${toolName} ${filePath}` : toolName);
  }

  if (toolName === "Bash") {
    const command = stringValue(input.command);
    return withOutput(command ? `Ran command: ${truncate(command, 300)}` : "Ran a shell command.");
  }

  if (toolName === "WebSearch") {
    const query = stringValue(input.query);
    return withOutput(query ? `Searched web: ${truncate(query, 300)}` : "Searched the web.");
  }

  if (toolName === "WebFetch") {
    const url = stringValue(input.url);
    return withOutput(url ? `Fetched web page: ${truncate(url, 300)}` : "Fetched a web page.");
  }

  return withOutput(`Used tool: ${toolName}`);
}

function summarizeMessage(message: UIMessage): string | null {
  const lines: string[] = [];

  for (const rawPart of message.parts) {
    if (rawPart.type === "text") {
      const text = truncate(rawPart.text);
      if (text) lines.push(text);
      continue;
    }

    const part = asRecord(rawPart);
    if (part.type === "dynamic-tool") {
      const summary = summarizeToolPart(part);
      if (summary) lines.push(`[${summary}]`);
    }
  }

  if (lines.length === 0) return null;
  const label = message.role === "user" ? "User" : "Assistant";
  return `${label}:\n${lines.join("\n")}`;
}

function compactTranscript(messages: UIMessage[]): string {
  const entries = messages
    .map(summarizeMessage)
    .filter((entry): entry is string => Boolean(entry));
  let transcript = entries.join("\n\n");
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript;

  transcript = transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS);
  const firstBoundary = transcript.indexOf("\n\n");
  return firstBoundary > 0
    ? `[Earlier handoff transcript omitted]\n\n${transcript.slice(firstBoundary + 2)}`
    : `[Earlier handoff transcript omitted]\n\n${transcript}`;
}

export function providerSessionCoveredMessageCount(
  state: ProviderSessionState | null | undefined,
  fallbackMessageCount = 0,
): number {
  const count = state?.metadata?.uiMessageCount;
  if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
    return Math.floor(count);
  }
  return fallbackMessageCount;
}

function prepareRuntimePromptHandoff(input: RuntimePromptInput): RuntimePromptHandoff {
  const latestUserText = extractLatestUserText(input.messages);
  const latestIndex = input.messages.length - 1;
  const approvalHandoff = approvalHandoffStart(input.messages);
  const nativeHandoffStart = Math.max(
    0,
    Math.min(input.nativeHistoryMessageCount, latestIndex),
  );
  const approvalStart = approvalHandoff?.startIndex ?? null;
  const handoffStart =
    approvalStart === null
      ? nativeHandoffStart
      : Math.min(nativeHandoffStart, approvalStart);
  const handoffMessages = input.messages.slice(handoffStart, latestIndex);

  return {
    latestUserText,
    nativeHistoryMessageCount: input.nativeHistoryMessageCount,
    nativeHandoffStart,
    approvalHandoffStart: approvalStart,
    approvalStopMessageIndex: approvalHandoff?.messageIndex ?? null,
    approvalStopToolName: approvalHandoff?.toolName ?? null,
    handoffStart,
    handoffMessageCount: handoffMessages.length,
    approvalContextIncluded: approvalStart !== null && handoffMessages.length > 0,
    usedApprovalHandoff:
      approvalStart !== null && approvalStart < nativeHandoffStart,
    latestUserTextLength: latestUserText.length,
    handoffMessages,
  };
}

export function getRuntimePromptHandoffDebug(
  input: RuntimePromptInput,
): RuntimePromptHandoffDebug {
  const handoff = prepareRuntimePromptHandoff(input);
  return {
    nativeHistoryMessageCount: handoff.nativeHistoryMessageCount,
    nativeHandoffStart: handoff.nativeHandoffStart,
    approvalHandoffStart: handoff.approvalHandoffStart,
    approvalStopMessageIndex: handoff.approvalStopMessageIndex,
    approvalStopToolName: handoff.approvalStopToolName,
    handoffStart: handoff.handoffStart,
    handoffMessageCount: handoff.handoffMessageCount,
    approvalContextIncluded: handoff.approvalContextIncluded,
    usedApprovalHandoff: handoff.usedApprovalHandoff,
    latestUserTextLength: handoff.latestUserTextLength,
  };
}

export function buildRuntimePrompt(input: RuntimePromptInput): string {
  const handoff = prepareRuntimePromptHandoff(input);
  const { latestUserText, handoffMessages } = handoff;

  if (handoffMessages.length === 0) return latestUserText;

  const transcript = compactTranscript(handoffMessages);
  const conversationLabel =
    input.conversationKind === "workspace_agent"
      ? "Second workspace-agent conversation"
      : "Second builder conversation";
  const sourceAuthority =
    input.conversationKind === "workspace_agent"
      ? "Use them as conversation context."
      : "Use them as conversation context, but treat the workspace files on disk as authoritative for current app code.";
  const continuationReason = handoff.approvalStopToolName
    ? `after the user approved the latest ${approvalStopLabel(handoff.approvalStopToolName)}`
    : "after the user changed the model or runtime";
  const continuityInstruction = handoff.approvalStopToolName
    ? "The provider-native session may not contain the approved context. Use the recent Second conversation below to continue from the approved item. Do not ask the user to repeat the plan or configuration unless it is actually missing below."
    : `The provider-native session may not contain the recent Second chat messages below. ${sourceAuthority}`;
  const contextInstructions = handoff.approvalStopToolName
    ? [continuityInstruction, sourceAuthority]
    : [continuityInstruction];
  return [
    `You are continuing a ${conversationLabel} ${continuationReason}.`,
    `Target runtime: ${input.targetRuntimeId}`,
    `Target model: ${input.targetModel}`,
    "",
    ...contextInstructions,
    "",
    "<recent_second_conversation>",
    transcript,
    "</recent_second_conversation>",
    "",
    "Now respond to the user's latest message:",
    latestUserText,
  ].join("\n");
}
