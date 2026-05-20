import { readAnalyticsPublicConfig } from "@/lib/analytics-public-config";
import { sendPostHogPayload } from "@/lib/posthog-server";
import { reportServerError } from "@/lib/server-error-reporting";

export type IntegrationSetupTelemetryIntegration = {
  id?: string | null;
  name?: string | null;
  domain?: string | null;
  keySlug?: string | null;
};

export type IntegrationSetupTelemetryInput = {
  status: "succeeded" | "failed" | "verification_failed";
  source: "web_route" | "worker";
  reason: string;
  workspaceId: string;
  appId: string;
  runId?: string | null;
  route?: string;
  runtimeId?: string | null;
  runtimeModel?: string | null;
  httpStatus?: number | null;
  error?: unknown;
  errorMessage?: string | null;
  expectedIntegrations?: IntegrationSetupTelemetryIntegration[];
  persistedIntegrations?: IntegrationSetupTelemetryIntegration[];
  requestedCount?: number | null;
  syncedCount?: number | null;
  skippedCount?: number | null;
  deletedStaleCount?: number | null;
  attemptCount?: number | null;
};

const MAX_STRING_LENGTH = 500;

function cleanString(value: string, maxLength = MAX_STRING_LENGTH): string {
  const cleaned = value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength)}...`
    : cleaned;
}

function normalizeIntegration(
  integration: IntegrationSetupTelemetryIntegration,
): IntegrationSetupTelemetryIntegration {
  return {
    id: integration.id ? cleanString(integration.id, 120) : null,
    name: integration.name ? cleanString(integration.name, 120) : null,
    domain: integration.domain ? cleanString(integration.domain, 120) : null,
    keySlug: integration.keySlug ? cleanString(integration.keySlug, 120) : null,
  };
}

function errorDetails(error: unknown, fallback?: string | null) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: cleanString(error.message || fallback || "unknown"),
    };
  }
  if (typeof error === "string") {
    return {
      errorName: "Error",
      errorMessage: cleanString(error || fallback || "unknown"),
    };
  }
  return {
    errorName: fallback ? "Error" : null,
    errorMessage: fallback ? cleanString(fallback) : null,
  };
}

function buildProperties(input: IntegrationSetupTelemetryInput) {
  const details = errorDetails(input.error, input.errorMessage);
  return {
    second_oss: true,
    status: input.status,
    source: input.source,
    reason: input.reason,
    workspace_id: input.workspaceId,
    app_id: input.appId,
    run_id: input.runId ?? null,
    route: input.route ?? null,
    runtime_id: input.runtimeId ?? null,
    runtime_model: input.runtimeModel ?? null,
    http_status: input.httpStatus ?? null,
    requested_count: input.requestedCount ?? null,
    synced_count: input.syncedCount ?? null,
    skipped_count: input.skippedCount ?? null,
    deleted_stale_count: input.deletedStaleCount ?? null,
    attempt_count: input.attemptCount ?? null,
    error_name: details.errorName,
    error_message: details.errorMessage,
    expected_integrations: (input.expectedIntegrations ?? []).map(normalizeIntegration),
    persisted_integrations: (input.persistedIntegrations ?? []).map(normalizeIntegration),
  };
}

export async function reportIntegrationSetupTelemetry(
  input: IntegrationSetupTelemetryInput,
): Promise<{ sentryEventId: string | null; posthogCaptured: boolean }> {
  const properties = buildProperties(input);
  let sentryEventId: string | null = null;

  if (input.status !== "succeeded") {
    sentryEventId = reportServerError({
      source: "integration_setup_sync",
      error: input.error,
      message:
        input.errorMessage ??
        `Integration setup sync ${input.status}: ${input.reason}`,
      route: input.route,
      level: "warning",
      context: properties,
    });
  }

  const config = readAnalyticsPublicConfig();
  let posthogCaptured = false;
  if (config.posthogToken) {
    posthogCaptured = await sendPostHogPayload(
      config,
      {
        api_key: config.posthogToken,
        event: input.status === "succeeded"
          ? "integration_setup_sync_succeeded"
          : "integration_setup_sync_failed",
        distinct_id: input.runId ?? input.appId,
        properties: {
          ...properties,
          sentry_event_id: sentryEventId,
        },
      },
      {
        event: "integration_setup_sync",
        anonymized: false,
      },
    ).catch(() => false);
  }

  return { sentryEventId, posthogCaptured };
}
