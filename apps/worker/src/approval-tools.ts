const BLOCKING_APPROVAL_TOOL_NAMES = new Set([
  "present_plan",
  "present_suggestions",
  "present_agents",
  "set_onboarding_context",
  "mcp__second__present_plan",
  "mcp__second__present_suggestions",
  "mcp__second__present_agents",
  "mcp__second__set_onboarding_context",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonText(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseToolTextOutput(output: unknown): unknown {
  if (typeof output === "string") {
    return parseJsonText(output) ?? output;
  }

  if (Array.isArray(output)) {
    const textPart = output.find((item) => {
      const part = asRecord(item);
      return part?.type === "text" && typeof part.text === "string";
    });
    const text = asRecord(textPart)?.text;
    if (typeof text === "string") return parseJsonText(text) ?? text;
  }

  const record = asRecord(output);
  const content = record?.content;
  if (Array.isArray(content)) {
    const textPart = content.find((item) => {
      const part = asRecord(item);
      return part?.type === "text" && typeof part.text === "string";
    });
    const text = asRecord(textPart)?.text;
    if (typeof text === "string") return parseJsonText(text) ?? text;
  }

  return output;
}

function isPresentAgentsToolName(name: string | undefined): boolean {
  return name === "present_agents" || name === "mcp__second__present_agents";
}

export function isBlockingApprovalToolName(name: string | undefined): boolean {
  return typeof name === "string" && BLOCKING_APPROVAL_TOOL_NAMES.has(name);
}

export function approvalToolResultShouldStop(
  toolName: string | undefined,
  output: unknown,
): boolean {
  if (!isBlockingApprovalToolName(toolName)) return false;
  if (!isPresentAgentsToolName(toolName)) return true;

  const parsed = parseToolTextOutput(output);
  const record = asRecord(parsed);
  return record?.ok === true && record.status === "presented";
}
