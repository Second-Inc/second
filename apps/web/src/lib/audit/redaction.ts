import { createHash } from "node:crypto";

const MAX_METADATA_BYTES = 8 * 1024;
const MAX_STRING_LENGTH = 512;
const MAX_ARRAY_LENGTH = 25;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 5;

const SENSITIVE_KEY_PATTERN =
  /password|token|secret|api[-_]?key|authorization|cookie|set-cookie|session|connectionstring|private[-_]?key|sourcefiles|publishedsourcefiles|prompt|messages|headers|body|response/i;

type SanitizedMetadata = {
  value: Record<string, unknown>;
  redactedFields: string[];
  truncated: boolean;
};

export function auditSha256(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")}`;
}

export function auditShortHash(value: unknown): string {
  return auditSha256(value).slice(0, 19);
}

export function hashAuditIdentifier(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return auditShortHash(trimmed);
}

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function sanitizeString(value: string): string {
  const stripped = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .trim();

  if (stripped.length <= MAX_STRING_LENGTH) return stripped;
  return `${stripped.slice(0, MAX_STRING_LENGTH)}...`;
}

function sanitizeValue(
  value: unknown,
  path: string,
  redactedFields: Set<string>,
  state: { truncated: boolean },
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) {
    state.truncated = true;
    return "[truncated]";
  }

  if (value === null || value === undefined) return value;

  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) state.truncated = true;
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item, index) =>
        sanitizeValue(item, `${path}[${index}]`, redactedFields, state, depth + 1),
      );
  }

  if (typeof value !== "object") {
    return sanitizeString(String(value));
  }

  const output: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_OBJECT_KEYS) state.truncated = true;

  for (const [rawKey, rawItem] of entries.slice(0, MAX_OBJECT_KEYS)) {
    const key = sanitizeString(rawKey).slice(0, 120);
    if (!key) continue;
    const childPath = path ? `${path}.${key}` : key;
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      redactedFields.add(childPath);
      output[key] = "[redacted]";
      continue;
    }
    output[key] = sanitizeValue(
      rawItem,
      childPath,
      redactedFields,
      state,
      depth + 1,
    );
  }

  return output;
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): SanitizedMetadata {
  const redactedFields = new Set<string>();
  const state = { truncated: false };
  const value = sanitizeValue(
    metadata ?? {},
    "",
    redactedFields,
    state,
    0,
  ) as Record<string, unknown>;

  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf-8") <= MAX_METADATA_BYTES) {
    return {
      value,
      redactedFields: [...redactedFields],
      truncated: state.truncated,
    };
  }

  return {
    value: {
      _truncated: true,
      _metadataHash: auditSha256(value),
    },
    redactedFields: [...redactedFields],
    truncated: true,
  };
}

export function safeChangedFields(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const fields: string[] = [];

  for (const item of input) {
    if (typeof item !== "string") continue;
    const field = sanitizeString(item).slice(0, 120);
    if (!field || seen.has(field)) continue;
    seen.add(field);
    fields.push(field);
    if (fields.length >= 50) break;
  }

  return fields;
}

