import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { InvalidAgentsJsonError } from "@/lib/agents/agents-governance";
import { recordAuditEvent } from "@/lib/audit/record";
import {
  approveCurrentAppAgentsJson,
  getAppSourceFiles,
  integrationNeedsSetup,
  listIntegrationsForAppReview,
  saveAppSourceFiles,
  syncIntegrationSetupInstructions,
} from "@/lib/db";
import type { IntegrationSetupConfig } from "@/lib/db/repositories/integrations";
import {
  buildLocalHeadlessAppPayload,
  findLocalHeadlessApp,
  validateLocalHeadlessRequest,
} from "@/lib/local-headless";
import { workerFetch } from "@/lib/worker-client";

type HeadlessPreviewRouteContext = {
  params: Promise<{ appId: string }>;
};

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

function sourceSnapshotMetadata(sourceFiles: Record<string, string>) {
  let sizeBytes = 0;
  for (const content of Object.values(sourceFiles)) {
    sizeBytes += Buffer.byteLength(content, "utf8");
  }
  return {
    fileCount: Object.keys(sourceFiles).length,
    sizeBytes,
    hash: createHash("sha256")
      .update(
        JSON.stringify(
          Object.keys(sourceFiles)
            .sort()
            .map((path) => [path, sourceFiles[path]]),
        ),
      )
      .digest("hex"),
    hasPreviewArtifact: Boolean(sourceFiles["dist/index.html"]),
  };
}

async function runWorkerPreview(input: {
  appId: string;
  workspaceId: string;
  summary: string;
}) {
  const sourceFiles = await getAppSourceFiles({
    workspaceId: input.workspaceId,
    appId: input.appId,
  });
  const response = await workerFetch(`/sessions/${input.appId}/build-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceFiles,
      summary: input.summary,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | {
        ok?: unknown;
        error?: unknown;
        message?: unknown;
        files?: unknown;
        result?: unknown;
        warnings?: unknown;
      }
    | null;

  if (!response.ok || payload?.ok !== true || !isStringRecord(payload.files)) {
    return {
      ok: false as const,
      status: response.ok ? 500 : response.status,
      payload,
      message:
        typeof payload?.message === "string" && payload.message.trim()
          ? payload.message
          : "Build failed.",
    };
  }

  return {
    ok: true as const,
    files: payload.files,
    result: payload.result,
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
  };
}

function readIntegrationSetupConfig(
  sourceFiles: Record<string, string>,
): IntegrationSetupConfig | null {
  const raw = sourceFiles["integration-setup.json"];
  if (!raw?.trim()) return null;
  return JSON.parse(raw) as IntegrationSetupConfig;
}

export async function POST(
  request: Request,
  context: HeadlessPreviewRouteContext,
) {
  const authError = validateLocalHeadlessRequest(request);
  if (authError) return authError;

  const { appId } = await context.params;
  const appContext = await findLocalHeadlessApp(appId);
  if (!appContext) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | { summary?: unknown }
    | null;
  const summary =
    typeof body?.summary === "string" && body.summary.trim()
      ? body.summary.trim().slice(0, 500)
      : "Updated headless preview";
  const build = await runWorkerPreview({
    appId,
    workspaceId: appContext.workspaceId,
    summary,
  });

  if (!build.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "build_failed",
        message: build.message,
        worker: build.payload,
      },
      { status: build.status },
    );
  }

  await saveAppSourceFiles({
    workspaceId: appContext.workspaceId,
    appId,
    sourceFiles: build.files,
  });

  const snapshot = sourceSnapshotMetadata(build.files);
  await recordAuditEvent({
    workspaceId: appContext.workspaceId,
    eventName: "app.source_snapshot.updated",
    category: "apps",
    severity: "notice",
    outcome: "success",
    actor: {
      kind: "user",
      userId: appContext.user._id,
      displayName: appContext.user.displayName,
      email: appContext.user.email,
      role: "owner",
    },
    source: {
      kind: "system",
      trust: "internal_trusted",
      appId,
      appName: appContext.app.name,
    },
    target: {
      type: "source_snapshot",
      id: appId,
      name: `${appContext.app.name} draft snapshot`,
      parentType: "app",
      parentId: appId,
    },
    action: "updated",
    summary: `Updated headless draft source snapshot for ${appContext.app.name}.`,
    metadata: {
      ...snapshot,
      source: "headless_cli",
    },
    changes: {
      changedFields: [
        "draftSnapshotId",
        "draftSourceHash",
        "draftSourceSizeBytes",
      ],
      afterHash: snapshot.hash,
    },
    relatedIds: { appId },
  });

  let agentsApproval:
    | Awaited<ReturnType<typeof approveCurrentAppAgentsJson>>
    | null = null;
  try {
    agentsApproval = await approveCurrentAppAgentsJson({
      workspaceId: appContext.workspaceId,
      appId,
      approvedByUserId: appContext.user._id,
      approvedByUserName: appContext.user.displayName,
      source: "headless_cli",
    });
  } catch (error) {
    if (error instanceof InvalidAgentsJsonError) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_agents_json",
          message: error.message,
          app: buildLocalHeadlessAppPayload({
            workspaceId: appContext.workspaceId,
            appId,
            appName: appContext.app.name,
          }),
        },
        { status: 400 },
      );
    }
    throw error;
  }

  if (agentsApproval) {
    await recordAuditEvent({
      workspaceId: appContext.workspaceId,
      eventName: "app.agents_config.approved",
      category: "agents",
      severity: agentsApproval.hasAgentsJson ? "notice" : "info",
      outcome: "success",
      actor: {
        kind: "user",
        userId: appContext.user._id,
        displayName: appContext.user.displayName,
        email: appContext.user.email,
        role: "owner",
      },
      source: {
        kind: "system",
        trust: "internal_trusted",
        appId,
        appName: appContext.app.name,
      },
      target: {
        type: "agent",
        id: agentsApproval.hash ?? appId,
        name: `${appContext.app.name} agents.json`,
        parentType: "app",
        parentId: appId,
      },
      action: "approved",
      summary: agentsApproval.hasAgentsJson
        ? `Approved headless app-agent runtime policy for ${appContext.app.name}.`
        : `No headless agents.json policy is present for ${appContext.app.name}.`,
      metadata: {
        approvalSource: "headless_cli",
        mockOnly: false,
        hasAgentsJson: agentsApproval.hasAgentsJson,
        agentsJsonHash: agentsApproval.hash,
      },
      changes: { changedFields: ["agentsJsonApprovalHash"] },
      relatedIds: { appId },
    });
  }

  let integrationSync:
    | Awaited<ReturnType<typeof syncIntegrationSetupInstructions>>
    | null = null;
  try {
    const setupConfig = readIntegrationSetupConfig(build.files);
    if (setupConfig) {
      integrationSync = await syncIntegrationSetupInstructions({
        workspaceId: appContext.workspaceId,
        setupConfig,
        requester: {
          appId,
          appName: appContext.app.name,
          requestedByUserId: appContext.user._id,
          requestedByUserName: appContext.user.displayName,
        },
      });
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_integration_setup_json",
          message: "integration-setup.json is not valid JSON.",
        },
        { status: 400 },
      );
    }
    throw error;
  }

  const integrations = await listIntegrationsForAppReview({
    workspaceId: appContext.workspaceId,
    appId,
  });
  const appPayload = buildLocalHeadlessAppPayload({
    workspaceId: appContext.workspaceId,
    appId,
    appName: appContext.app.name,
  });

  return NextResponse.json({
    ok: true,
    app: appPayload,
    build: build.result,
    sourceSnapshot: snapshot,
    agentsJson: {
      present: agentsApproval?.hasAgentsJson ?? false,
      approved: agentsApproval?.hasAgentsJson ?? false,
      approvalSource: agentsApproval?.hasAgentsJson ? "headless_cli" : null,
      hash: agentsApproval?.hash ?? null,
    },
    integrations: {
      setupSynced: Boolean(integrationSync),
      requestedCount: integrationSync?.requestedCount ?? 0,
      syncedCount: integrationSync?.grants.length ?? 0,
      skippedCount: integrationSync?.skippedCount ?? 0,
      deletedStaleCount: integrationSync?.deletedStaleCount ?? 0,
      url: appPayload.integrationsUrl,
      items: integrations.map((integration) => ({
        id: integration._id,
        name: integration.name,
        domain: integration.domain,
        keySlug: integration.keySlug,
        configured: integration.configured,
        needsSetup: integrationNeedsSetup(integration),
        authType: integration.auth?.type ?? "static_secret",
      })),
    },
  });
}
