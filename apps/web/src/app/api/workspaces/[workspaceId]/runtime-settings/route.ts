import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAccessDeniedAuditEvent,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  getWorkspaceAppRuntimeSettings,
  updateWorkspaceAppRuntimeSettings,
} from "@/lib/db";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import { createPerfTrace, perfResponseHeaders } from "@/lib/perf/trace";
import {
  normalizeWorkspaceAppRuntimeSettings,
  type WorkspaceAppRuntimeSettings,
} from "@/lib/workspace-app-runtime-settings";
import {
  dedupeWorkspaceSettingsRequest,
  workspaceSettingsDedupeKey,
} from "@/lib/workspace-settings/request-dedupe";
import { loadAppRuntimeSettingsReadModel } from "@/lib/workspace-settings/read-models";

type AppRuntimeSettingsRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

const SETTING_FIELDS = [
  "allowIframeScripts",
  "allowIframeClipboard",
  "allowIframeExternalLinks",
] as const;

function parseSettingsPatch(value: unknown): Partial<WorkspaceAppRuntimeSettings> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const patch: Partial<WorkspaceAppRuntimeSettings> = {};

  for (const field of SETTING_FIELDS) {
    if (!(field in record)) continue;
    if (typeof record[field] !== "boolean") return null;
    patch[field] = record[field];
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function changedFields(
  before: WorkspaceAppRuntimeSettings,
  after: WorkspaceAppRuntimeSettings,
): string[] {
  return SETTING_FIELDS.filter((field) => before[field] !== after[field]);
}

export async function GET(
  request: Request,
  context: AppRuntimeSettingsRouteContext,
) {
  const { workspaceId } = await context.params;
  const trace = createPerfTrace({
    route: "GET /api/workspaces/[workspaceId]/runtime-settings",
    workspaceId,
  });
  trace.log("settings.app_runtime.request_start");

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await trace.time("auth.workspace", () =>
      requireWorkspaceContext({
        headers: request.headers,
        pathname: new URL(request.url).pathname,
        workspaceId,
      }),
    );
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const data = await trace.time("settings.app_runtime.read_model", () =>
    dedupeWorkspaceSettingsRequest(
      workspaceSettingsDedupeKey("runtime-settings", workspaceContext),
      750,
      () => loadAppRuntimeSettingsReadModel(workspaceContext),
    ),
  );
  trace.log("settings.app_runtime.response", {
    canManage: data.canManage,
    totalElapsedMs: trace.elapsedMs(),
  });

  return NextResponse.json(data, { headers: perfResponseHeaders(trace) });
}

export async function PATCH(
  request: Request,
  context: AppRuntimeSettingsRouteContext,
) {
  const { workspaceId } = await context.params;
  const url = new URL(request.url);

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: url.pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  if (!hasWorkspacePermission(workspaceContext.membership, "workspace:manage")) {
    await recordAccessDeniedAuditEvent({
      request,
      workspaceContext,
      permission: "workspace:manage",
      action: "update_app_runtime_settings",
      summary:
        "Denied app runtime settings change because actor lacks workspace:manage.",
      target: {
        type: "workspace",
        id: workspaceContext.workspaceId,
        name: "Workspace",
      },
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const patch = parseSettingsPatch(await request.json().catch(() => null));
  if (!patch) {
    return NextResponse.json(
      { error: "invalid_app_runtime_settings" },
      { status: 400 },
    );
  }

  const before = await getWorkspaceAppRuntimeSettings(
    workspaceContext.workspaceId,
  );
  const next = normalizeWorkspaceAppRuntimeSettings({
    ...before,
    ...patch,
  });
  const changed = changedFields(before, next);

  if (changed.length === 0) {
    return NextResponse.json({
      canManage: true,
      settings: before,
    });
  }

  const updated = await updateWorkspaceAppRuntimeSettings({
    workspaceId: workspaceContext.workspaceId,
    settings: next,
  });

  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  publishWorkspaceEvent({
    type: "changed",
    workspaceId: workspaceContext.workspaceId,
    scope: "workspace-settings",
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "workspace.app_runtime_settings_updated",
    category: "system",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request),
    target: {
      type: "workspace",
      id: workspaceContext.workspaceId,
      name: "Workspace",
    },
    action: "updated",
    summary: "Updated generated app runtime sandbox settings.",
    metadata: {
      settings: updated,
    },
    changes: {
      changedFields: changed,
    },
  });

  return NextResponse.json({
    canManage: true,
    settings: updated,
  });
}
