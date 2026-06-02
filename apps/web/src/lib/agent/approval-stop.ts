const APPROVAL_STOP_TOOL_NAMES = new Set([
  "mcp__second__present_plan",
  "mcp__second__present_suggestions",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractTextContent(output: unknown): string | null {
  if (typeof output === "string") {
    return output;
  }

  let content: unknown[] | null = null;
  if (Array.isArray(output)) {
    content = output;
  } else {
    const maybeContent = asRecord(output).content;
    content = Array.isArray(maybeContent) ? maybeContent : null;
  }

  if (!content) return null;

  const textPart = content.find((item) => {
    const record = asRecord(item);
    return record.type === "text" && typeof record.text === "string";
  });

  const text = asRecord(textPart).text;
  return typeof text === "string" ? text : null;
}

function parseToolTextOutput(output: unknown): unknown {
  const text = extractTextContent(output);
  return text === null ? output : tryParseJson(text);
}

export function isApprovalStopToolOutput(
  toolName: string,
  output: unknown,
): boolean {
  if (APPROVAL_STOP_TOOL_NAMES.has(toolName)) return true;
  if (toolName !== "mcp__second__present_agents") return false;

  const parsed = parseToolTextOutput(output);
  const record = asRecord(parsed);
  return record.ok === true && record.status === "presented";
}
