"use client";

import * as Sentry from "@sentry/nextjs";
import { readAnalyticsConsent } from "@/lib/analytics";
import {
  browserAllowsSentry,
  readSentryDsn,
  sentryRouteShape,
} from "@/lib/sentry-public-config";

type ClientErrorSource =
  | "window-error"
  | "unhandled-rejection"
  | "route-error-boundary"
  | "component-error-boundary"
  | "chat-stream"
  | "manual-diagnostics";

type ClientErrorInput = {
  source: ClientErrorSource;
  error: unknown;
  componentStack?: string | null;
  context?: Record<string, unknown>;
};

const MAX_ERROR_TEXT_CHARS = 1800;
const DEDUPE_WINDOW_MS = 10_000;
const recentFingerprints = new Map<string, number>();

function cleanString(value: unknown, maxLength = MAX_ERROR_TEXT_CHARS): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\u0000/g, "").trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function errorRecord(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const digest =
      "digest" in error && typeof error.digest === "string"
        ? error.digest
        : undefined;
    return {
      error_name: cleanString(error.name, 160) ?? "Error",
      error_message: cleanString(error.message) ?? "Unknown error",
      error_stack_hash: error.stack ? stableHash(error.stack) : undefined,
      error_digest: cleanString(digest, 240),
    };
  }

  if (typeof error === "string") {
    return {
      error_name: "Error",
      error_message: cleanString(error) ?? "Unknown error",
    };
  }

  return {
    error_name: "UnknownError",
    error_message: cleanString(String(error)) ?? "Unknown error",
  };
}

function routeContext(): Record<string, unknown> {
  if (typeof window === "undefined") return {};

  const pathname = window.location.pathname;
  const objectIds = pathname.match(/[a-f0-9]{24}/gi) ?? [];

  return {
    route_shape: sentryRouteShape(pathname),
    path_hash: stableHash(pathname),
    object_hashes: objectIds.slice(0, 6).map(stableHash),
    object_hash_count: objectIds.length,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    visibility_state: document.visibilityState,
    online: navigator.onLine,
  };
}

function isDuplicate(fingerprint: string): boolean {
  const now = Date.now();
  for (const [key, seenAt] of recentFingerprints) {
    if (now - seenAt > DEDUPE_WINDOW_MS) recentFingerprints.delete(key);
  }

  const seenAt = recentFingerprints.get(fingerprint);
  if (seenAt && now - seenAt <= DEDUPE_WINDOW_MS) return true;
  recentFingerprints.set(fingerprint, now);
  return false;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error(cleanString(String(error)) ?? "Unknown error");
}

export function reportClientError(input: ClientErrorInput): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!readSentryDsn()) return Promise.resolve(false);
  if (!browserAllowsSentry()) return Promise.resolve(false);
  if (!readAnalyticsConsent().shareUsageData) return Promise.resolve(false);

  const details = errorRecord(input.error);
  const error = normalizeError(input.error);
  const componentStack = cleanString(input.componentStack);
  const componentStackHash = componentStack
    ? stableHash(componentStack)
    : undefined;
  const fingerprint = [
    input.source,
    details.error_name,
    details.error_message,
    details.error_stack_hash,
    componentStackHash,
    window.location.pathname,
  ].join("|");

  if (isDuplicate(fingerprint)) return Promise.resolve(false);

  const eventId = Sentry.withScope((scope) => {
    scope.setTag("second.error_source", input.source);
    scope.setTag("second.route_shape", sentryRouteShape(window.location.pathname));
    scope.setFingerprint([
      "second-client-error",
      input.source,
      String(details.error_name ?? "Error"),
      stableHash(String(details.error_message ?? "Unknown error")),
      componentStackHash ?? "no-component-stack",
    ]);
    scope.setContext("second", {
      ...routeContext(),
      ...details,
      component_stack_hash: componentStackHash,
      ...input.context,
    });
    if (componentStack) {
      scope.setExtra("component_stack", componentStack);
    }
    return Sentry.captureException(error);
  });

  return Promise.resolve(Boolean(eventId));
}
