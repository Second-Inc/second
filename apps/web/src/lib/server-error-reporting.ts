import { createHash } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { readSentryDsn, sentryRouteShape } from "@/lib/sentry-public-config";

export type ServerErrorSource =
  | "agent_chat_claim"
  | "agent_chat_stale_recovery"
  | "agent_chat_worker_stream"
  | "agent_chat_persistence"
  | "agent_chat_stop"
  | "agent_chat_stream_attach";

type ReportServerErrorInput = {
  source: ServerErrorSource;
  error?: unknown;
  message?: string;
  route?: string;
  context?: Record<string, unknown>;
  level?: "warning" | "error";
};

const MAX_STRING_LENGTH = 500;
const MAX_KEYS = 40;

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function cleanString(value: string, maxLength = MAX_STRING_LENGTH): string {
  const cleaned = value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength)}...`
    : cleaned;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === "prompt" ||
    normalized === "messages" ||
    normalized === "message" ||
    normalized === "sourcefiles" ||
    normalized === "source_files" ||
    normalized === "body" ||
    normalized === "headers" ||
    normalized === "cookie" ||
    normalized === "cookies" ||
    normalized === "authorization" ||
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("api_key")
  );
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (isSensitiveKey(key)) {
    if (typeof value === "string" && value) {
      return { redacted: true, hash: stableHash(value), length: value.length };
    }
    if (Array.isArray(value)) {
      return { redacted: true, count: value.length };
    }
    if (typeof value === "object") {
      return { redacted: true };
    }
    return { redacted: true };
  }

  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return cleanString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitizeValue(key, item));
  if (typeof value !== "object") return cleanString(String(value));

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, MAX_KEYS)) {
    output[childKey] = sanitizeValue(childKey, childValue);
  }
  return output;
}

function sanitizeContext(context: Record<string, unknown> | undefined) {
  if (!context) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context).slice(0, MAX_KEYS)) {
    if (/(workspaceId|appId|runId|streamId|leaseId|userId)$/i.test(key)) {
      output[`${key}Hash`] = typeof value === "string" ? stableHash(value) : value;
      continue;
    }
    output[key] = sanitizeValue(key, value);
  }
  return output;
}

function normalizeError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(cleanString(error));
  return new Error(fallback);
}

export function reportServerError(input: ReportServerErrorInput): string | null {
  if (!readSentryDsn()) return null;

  const message = cleanString(
    input.message ??
      (input.error instanceof Error ? input.error.message : "Second server error"),
  );
  const error = normalizeError(input.error, message);
  const routeShape = input.route ? sentryRouteShape(input.route) : undefined;
  const eventId = Sentry.withScope((scope) => {
    scope.setLevel(input.level ?? "error");
    scope.setTag("second.error_source", input.source);
    if (routeShape) scope.setTag("second.route_shape", routeShape);
    scope.setFingerprint([
      "second-server-error",
      input.source,
      routeShape ?? "no-route",
      stableHash(message),
    ]);
    scope.setContext("second", {
      source: input.source,
      message,
      route_shape: routeShape,
      ...sanitizeContext(input.context),
    });
    return input.error
      ? Sentry.captureException(error)
      : Sentry.captureMessage(message);
  });

  return eventId || null;
}
