export type DoneBuildingPayload = {
  status?: string;
  summary?: string;
  fileCount?: number;
  totalBytes?: number;
  warning?: string | null;
};

function tryParsePayload(value: unknown): DoneBuildingPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.status !== "string") return null;

  return {
    status: candidate.status,
    summary: typeof candidate.summary === "string" ? candidate.summary : undefined,
    fileCount: typeof candidate.fileCount === "number" ? candidate.fileCount : undefined,
    totalBytes: typeof candidate.totalBytes === "number" ? candidate.totalBytes : undefined,
    warning:
      typeof candidate.warning === "string" || candidate.warning === null
        ? candidate.warning
        : undefined,
  };
}

function parsePayloadDeep(value: unknown, depth = 0): DoneBuildingPayload | null {
  if (depth > 8) return null;

  const direct = tryParsePayload(value);
  if (direct) return direct;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return parsePayloadDeep(JSON.parse(trimmed), depth + 1);
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = parsePayloadDeep(entry, depth + 1);
      if (parsed) return parsed;
    }
    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.text === "string") {
    const parsed = parsePayloadDeep(obj.text, depth + 1);
    if (parsed) return parsed;
  }

  if (Array.isArray(obj.content)) {
    const parsed = parsePayloadDeep(obj.content, depth + 1);
    if (parsed) return parsed;
  }

  for (const candidate of Object.values(obj)) {
    const parsed = parsePayloadDeep(candidate, depth + 1);
    if (parsed) return parsed;
  }

  return null;
}

export function parseDoneBuildingOutput(output: unknown): DoneBuildingPayload | null {
  return parsePayloadDeep(output);
}

export function isDoneBuildingSuccessOutput(output: unknown): boolean {
  const payload = parseDoneBuildingOutput(output);
  return payload?.status === "complete";
}
