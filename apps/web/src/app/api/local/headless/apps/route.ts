import { NextResponse } from "next/server";
import { DEFAULT_RUNTIME_SETTINGS } from "@/lib/agent/runtime-registry";
import { recordAuditEvent } from "@/lib/audit/record";
import {
  createAppForWorkspace,
  getAppPublishStatus,
  getAppSourceFiles,
} from "@/lib/db";
import {
  buildLocalHeadlessAppPayload,
  ensureLocalHeadlessContext,
  findLocalHeadlessApp,
  validateLocalHeadlessRequest,
} from "@/lib/local-headless";
import { validateAppName } from "@/lib/validation";
import { workerFetch } from "@/lib/worker-client";

type HeadlessStartRequest = {
  appId?: unknown;
  name?: unknown;
  prompt?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function ensureWorkerWorkspace(input: {
  workspaceId: string;
  appId: string;
}) {
  const sourceFiles = await getAppSourceFiles(input);
  const response = await workerFetch(`/sessions/${input.appId}/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceFiles }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `worker_workspace_failed:${response.status}`);
  }
}

export async function POST(request: Request) {
  const authError = validateLocalHeadlessRequest(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => null)) as HeadlessStartRequest | null;
  const requestedAppId = asString(body?.appId);
  const requestedName = validateAppName(asString(body?.name) ?? "Headless app");
  const prompt = asString(body?.prompt) ?? "Headless Second app";

  if (requestedAppId) {
    const existing = await findLocalHeadlessApp(requestedAppId);
    if (!existing) {
      return NextResponse.json({ error: "app_not_found" }, { status: 404 });
    }

    await ensureWorkerWorkspace({
      workspaceId: existing.workspaceId,
      appId: existing.app._id,
    });

    return NextResponse.json({
      ok: true,
      reused: true,
      app: {
        ...buildLocalHeadlessAppPayload({
          workspaceId: existing.workspaceId,
          appId: existing.app._id,
          appName: existing.app.name,
        }),
        publishStatus: getAppPublishStatus(existing.app),
      },
    });
  }

  const context = await ensureLocalHeadlessContext();
  const app = await createAppForWorkspace({
    workspaceId: context.workspaceId,
    name: requestedName ?? "Headless app",
    createdByUserId: context.user._id,
    prompt,
    runtimeId: DEFAULT_RUNTIME_SETTINGS.runtimeId,
    runtimeModel: DEFAULT_RUNTIME_SETTINGS.model,
    runtimeParams: DEFAULT_RUNTIME_SETTINGS.params,
  });

  await ensureWorkerWorkspace({
    workspaceId: context.workspaceId,
    appId: app._id,
  });

  await recordAuditEvent({
    workspaceId: context.workspaceId,
    eventName: "app.created",
    category: "apps",
    severity: "notice",
    outcome: "success",
    actor: {
      kind: "user",
      userId: context.user._id,
      displayName: context.user.displayName,
      email: context.user.email,
      role: "owner",
    },
    source: {
      kind: "system",
      trust: "internal_trusted",
      appId: app._id,
      appName: app.name,
    },
    target: { type: "app", id: app._id, name: app.name },
    action: "created",
    summary: `Created headless app ${app.name}.`,
    metadata: {
      source: "headless_cli",
      runtimeId: app.runtimeId,
      runtimeModel: app.runtimeModel,
    },
    relatedIds: { appId: app._id },
  });

  return NextResponse.json({
    ok: true,
    reused: false,
    app: {
      ...buildLocalHeadlessAppPayload({
        workspaceId: context.workspaceId,
        appId: app._id,
        appName: app.name,
      }),
      publishStatus: getAppPublishStatus(app),
    },
  });
}
