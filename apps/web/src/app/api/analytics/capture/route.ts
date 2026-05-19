import { NextRequest, NextResponse } from "next/server";
import { guardErrorToApiResponse } from "@/lib/auth";
import {
  isRequestGuardError,
  normalizeWorkspaceId,
  requireReadyState,
} from "@/lib/auth";
import { readAnalyticsPublicConfig } from "@/lib/analytics-public-config";
import {
  ensurePostHogIdentity,
  sendPostHogPayload,
} from "@/lib/posthog-server";
import { readRuntimeConfig } from "@/lib/config";

type AnalyticsValue =
  | string
  | number
  | boolean
  | null
  | AnalyticsValue[]
  | { [key: string]: AnalyticsValue };

type AnalyticsProperties = { [key: string]: AnalyticsValue };

const ALLOWED_EVENTS = new Set([
  "page viewed",
  "onboarding finished",
  "chat initiated",
  "sidebar clicked",
  "import existing app clicked",
  "import existing app triggered",
  "build completed",
  "build failed",
  "approval shown",
  "approval acted",
  "integration setup started",
  "integration setup completed",
  "app displayed",
  "app agent triggered",
  "app agent finished",
  "app agent error",
  "client error",
  "showed suggestions tool called",
  "suggestion picked",
  "agents approved",
]);

const ANONYMIZED_OMIT_KEYS = new Set([
  "user_id",
  "user_email",
  "user_name",
  "workspace_id",
  "workspace_role",
  "app_id",
  "app_name",
  "run_id",
  "agent_id",
  "agent_name",
  "agent_ids",
  "agent_names",
  "agent_descriptions",
  "agent_system_prompts",
  "agent_tool_names",
  "agent_tool_display_names",
  "agent_integration_names",
  "agent_integration_domains",
  "agent_data_collection_names",
  "agents",
  "message",
  "prompt",
  "plan_overview",
  "plan_features",
  "plan_data_flow",
  "plan_agents",
  "plan_backend",
  "plan_feature_names",
  "error",
  "error_message",
  "suggestion_title",
  "suggestion_titles",
  "suggestion_subtitles",
  "suggestions",
  "integration_domains",
  "page_url",
  "pathname",
  "referrer",
]);

const MAX_STRING_LENGTH = 2_000;
const MAX_APPROVAL_STRING_LENGTH = 20_000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 80;
const MAX_DEPTH = 8;
const ANONYMOUS_DISTINCT_ID_PATTERN = /^anon_[a-zA-Z0-9_.:-]{8,120}$/;

function jsonError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function sanitizeKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed || trimmed === "__proto__" || trimmed === "constructor") {
    return null;
  }
  if (trimmed.startsWith("$")) {
    return null;
  }
  return trimmed.slice(0, 80);
}

function sanitizeValue(
  value: unknown,
  event: string,
  depth = 0,
): AnalyticsValue | undefined {
  if (value === null) return null;
  if (typeof value === "string") {
    const maxLength = event === "approval shown"
      ? MAX_APPROVAL_STRING_LENGTH
      : MAX_STRING_LENGTH;
    return value.slice(0, maxLength);
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, event, depth + 1))
      .filter((item): item is AnalyticsValue => item !== undefined);
    return items;
  }
  if (!isPlainRecord(value)) return undefined;

  const sanitized: AnalyticsProperties = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    const key = sanitizeKey(rawKey);
    if (!key) continue;
    const sanitizedValue = sanitizeValue(rawValue, event, depth + 1);
    if (sanitizedValue !== undefined) sanitized[key] = sanitizedValue;
  }
  return sanitized;
}

function sanitizeProperties(value: unknown, event: string): AnalyticsProperties {
  const sanitized = sanitizeValue(value, event);
  return isPlainRecord(sanitized) ? sanitized : {};
}

function removeAnonymizedProperties(
  properties: AnalyticsProperties,
): AnalyticsProperties {
  const next: AnalyticsProperties = {};

  for (const [key, value] of Object.entries(properties)) {
    if (
      ANONYMIZED_OMIT_KEYS.has(key) ||
      key.endsWith("_id") ||
      key.endsWith("_ids") ||
      key.endsWith("_email") ||
      key.endsWith("_name") ||
      key.endsWith("_names")
    ) {
      continue;
    }
    next[key] = value;
  }

  return next;
}

function stringProperty(
  properties: AnalyticsProperties,
  key: string,
): string | undefined {
  const value = properties[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function anonymousDistinctIdFromPayload(payload: Record<string, unknown>): string {
  const value = payload.anonymousDistinctId;
  if (
    typeof value === "string" &&
    ANONYMOUS_DISTINCT_ID_PATTERN.test(value)
  ) {
    return value;
  }

  return `anon_${crypto.randomUUID()}`;
}

function readEnvString(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function releaseAnalyticsProperties(): AnalyticsProperties {
  return {
    release_version: readEnvString(
      "SECOND_RELEASE_VERSION",
      "SENTRY_RELEASE",
      "VERCEL_GIT_COMMIT_SHA",
    ),
    release_package: readEnvString("SECOND_RELEASE_PACKAGE"),
    release_runtime: readEnvString("SECOND_RELEASE_RUNTIME"),
    cli_launcher_version: readEnvString("SECOND_CLI_RELEASE_VERSION"),
    cli_launcher_package: readEnvString("SECOND_CLI_RELEASE_PACKAGE"),
  };
}

export async function POST(request: NextRequest) {
  let readyState: Awaited<ReturnType<typeof requireReadyState>>;

  try {
    readyState = await requireReadyState({ headers: request.headers });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    return jsonError(500, "analytics_auth_failed");
  }

  const payload = await request.json().catch(() => null);
  if (!isPlainRecord(payload)) return jsonError(400, "invalid_payload");

  const event = typeof payload.event === "string" ? payload.event.trim() : "";
  if (!ALLOWED_EVENTS.has(event)) return jsonError(400, "invalid_event");

  const config = readAnalyticsPublicConfig();
  if (!config.posthogToken) return new NextResponse(null, { status: 204 });
  const runtimeConfig = readRuntimeConfig();
  const installationMode =
    runtimeConfig.authMode === "none" ? "local" : "external_auth";

  const rawProperties = sanitizeProperties(payload.properties, event);
  const anonymized = rawProperties.anonymized === true;
  const distinctId = anonymized
    ? anonymousDistinctIdFromPayload(payload)
    : readyState.user._id;
  const properties = anonymized
    ? removeAnonymizedProperties(rawProperties)
    : rawProperties;

  const workspaceId =
    typeof properties.workspace_id === "string"
      ? normalizeWorkspaceId(properties.workspace_id)
      : null;
  const membership = workspaceId
    ? readyState.memberships.find((item) => item.workspaceId === workspaceId)
    : readyState.memberships[0] ?? null;

  if (workspaceId && !membership) {
    return jsonError(404, "workspace_not_found");
  }

  const currentUrl = stringProperty(properties, "page_url");
  const pathname = stringProperty(properties, "pathname");
  const referrer =
    stringProperty(properties, "referrer") ??
    request.headers.get("referer") ??
    undefined;

  if (!anonymized) {
    await ensurePostHogIdentity({
      config,
      user: readyState.user,
      membership,
    });
  }

  const posthogBody = {
    api_key: config.posthogToken,
    event,
    distinct_id: distinctId,
    properties: {
      ...properties,
      auth_mode: runtimeConfig.authMode,
      installation_mode: installationMode,
      ...releaseAnalyticsProperties(),
      $process_person_profile: false,
      anonymized,
      analytics_consent_version: 1,
      second_oss: true,
      ...(!anonymized
        ? {
            user_id: readyState.user._id,
            user_email: readyState.user.email,
            user_name: readyState.user.displayName,
            workspace_id: membership?.workspaceId,
            workspace_role: membership?.role,
            referrer,
            $current_url: currentUrl,
            $pathname: pathname,
            $referrer: referrer,
          }
        : {}),
    },
  };

  const captured = await sendPostHogPayload(config, posthogBody, {
    event,
    anonymized,
  });

  if (!captured) {
    return jsonError(502, "analytics_capture_failed");
  }

  return new NextResponse(null, { status: 204 });
}
