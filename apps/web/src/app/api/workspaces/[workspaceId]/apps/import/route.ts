import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  buildWorkspaceCookie,
  guardErrorToApiResponse,
  isRequestGuardError,
  isWorkspaceAdminRole,
  requireWorkspaceContext,
} from "@/lib/auth";
import { InvalidAgentsJsonError } from "@/lib/agents/agents-governance";
import {
  approveCurrentAppAgentsJson,
  createAppForWorkspace,
  createCompletedRun,
  deleteApp,
  saveAppSourceFiles,
  SourceFilesLimitError,
  syncIntegrationSetupInstructions,
} from "@/lib/db";
import {
  DEFAULT_RUNTIME_SETTINGS,
  parseRuntimeSettings,
} from "@/lib/agent/runtime-registry";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  AppBundleError,
  parseSecondAppBundle,
  type SecondAppBundleManifest,
} from "@/lib/app-bundles";
import type {
  IntegrationSetupConfig,
  SyncIntegrationSetupInstructionsResult,
} from "@/lib/db/repositories/integrations";
import { validateAppName } from "@/lib/validation";

export const runtime = "nodejs";

type ImportRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

function formString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function appNameFromFilename(filename: string): string {
  return filename
    .replace(/\.second-app\.zip$/i, "")
    .replace(/\.zip$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveImportedAppName(input: {
  explicitName?: string;
  manifestName?: string | null;
  filename: string;
}): string {
  return (
    validateAppName(input.explicitName ?? null) ??
    validateAppName(input.manifestName ?? null) ??
    validateAppName(appNameFromFilename(input.filename)) ??
    "Imported app"
  );
}

function responseForBundleError(error: AppBundleError) {
  return NextResponse.json(
    { error: error.code, message: error.message },
    { status: error.status },
  );
}

function parseImportedIntegrationSetup(
  setupJsonRaw: string | undefined,
): IntegrationSetupConfig | null {
  if (!setupJsonRaw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(setupJsonRaw) as unknown;
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  if (!record || !Array.isArray(record.integrations)) return null;
  if (record.integrations.length === 0) return null;
  return record as IntegrationSetupConfig;
}

function integrationSetupNames(setupConfig: IntegrationSetupConfig): string {
  return (setupConfig.integrations ?? [])
    .map((integration) =>
      typeof integration?.name === "string" && integration.name.trim()
        ? integration.name.trim()
        : typeof integration?.domain === "string"
          ? integration.domain.trim()
          : "",
    )
    .filter(Boolean)
    .join(", ");
}

function numberedList(items: string[]): string[] {
  return items.map((item, index) => `${index + 1}. ${item}`);
}

function buildImportedContextText(input: {
  appName: string;
  prompt: string | null | undefined;
  context: SecondAppBundleManifest["context"] | null | undefined;
  fileCount: number;
  hasIntegrationSetupFile: boolean;
  integrationSetup: IntegrationSetupConfig | null;
  integrationSyncResult: SyncIntegrationSetupInstructionsResult | null;
}): string {
  const initialUserMessage =
    input.context?.initialUserMessage?.trim() ||
    input.prompt?.trim() ||
    null;
  const buildSummaries = input.context?.buildSummaries ?? [];
  const integrationNames = input.integrationSetup
    ? integrationSetupNames(input.integrationSetup)
    : "";

  return [
    "Imported app context",
    "",
    `App: ${input.appName}`,
    `Files restored: ${input.fileCount}`,
    "",
    "Original user request:",
    initialUserMessage ?? "Not available in the exported transcript.",
    "",
    "Build history from app-ready summaries:",
    ...(buildSummaries.length > 0
      ? numberedList(buildSummaries)
      : ["Not available in the exported transcript."]),
    "",
    input.integrationSetup
      ? `Integration requirements restored from integration-setup.json: ${integrationNames || "unnamed integrations"}.`
      : input.hasIntegrationSetupFile
        ? "integration-setup.json was included, but it could not be parsed into syncable integration requirements."
      : "No integration-setup.json requirements were included in this import.",
    input.integrationSyncResult
      ? `Integration requirements synced: ${input.integrationSyncResult.grants.length}/${input.integrationSyncResult.requestedCount}.`
      : null,
    "",
    "Before making changes, inspect agents.json, integration-setup.json if present, and the relevant source files. Treat the restored files as authoritative over this transcript.",
  ].filter((line): line is string => line !== null).join("\n");
}

function shouldPresentImportedIntegrationSetup(
  setupConfig: IntegrationSetupConfig | null,
  syncResult: SyncIntegrationSetupInstructionsResult | null,
): setupConfig is IntegrationSetupConfig {
  return Boolean(
    setupConfig &&
      syncResult &&
      syncResult.requestedCount > 0 &&
      syncResult.skippedCount === 0 &&
      syncResult.grants.length === syncResult.requestedCount,
  );
}

function createImportedContextMessage(input: {
  appName: string;
  prompt: string | null | undefined;
  context: SecondAppBundleManifest["context"] | null | undefined;
  fileCount: number;
  hasIntegrationSetupFile: boolean;
  integrationSetup: IntegrationSetupConfig | null;
  integrationSyncResult: SyncIntegrationSetupInstructionsResult | null;
}): unknown {
  const text = buildImportedContextText(input);
  const parts: unknown[] = [{ type: "text", text }];

  if (
    shouldPresentImportedIntegrationSetup(
      input.integrationSetup,
      input.integrationSyncResult,
    )
  ) {
    const names = integrationSetupNames(input.integrationSetup);
    parts.push({
      type: "dynamic-tool",
      toolCallId: `imported-integration-setup-${randomUUID()}`,
      toolName: "mcp__second__present_integration_setup",
      state: "output-available",
      input: {
        integrations: input.integrationSetup.integrations ?? [],
      },
      output: {
        content: [{
          type: "text",
          text: `Integration setup instructions presented to user and synced: ${names || "none"}.`,
        }],
      },
    });
  }

  return {
    id: `imported-app-context-${randomUUID()}`,
    role: "assistant",
    parts,
  };
}

export async function POST(
  request: Request,
  context: ImportRouteContext,
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

  const formData = await request.formData();
  const upload = formData.get("file");
  if (!(upload instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (upload.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "bundle_too_large" },
      { status: 413 },
    );
  }

  let bundle: ReturnType<typeof parseSecondAppBundle>;
  try {
    bundle = parseSecondAppBundle(Buffer.from(await upload.arrayBuffer()));
  } catch (error) {
    if (error instanceof AppBundleError) {
      return responseForBundleError(error);
    }
    throw error;
  }

  const importedName = resolveImportedAppName({
    explicitName: formString(formData.get("appName")),
    manifestName: bundle.manifest?.app.name ?? null,
    filename: upload.name,
  });
  const manifestRuntime = bundle.manifest?.app;
  const runtimeSettings =
    parseRuntimeSettings({
      runtimeId:
        typeof manifestRuntime?.runtimeId === "string"
          ? manifestRuntime.runtimeId
          : undefined,
      model:
        typeof manifestRuntime?.runtimeModel === "string"
          ? manifestRuntime.runtimeModel
          : undefined,
      params: manifestRuntime?.runtimeParams ?? undefined,
    }) ?? DEFAULT_RUNTIME_SETTINGS;
  const prompt = bundle.manifest?.app.prompt ?? undefined;

  const app = await createAppForWorkspace({
    workspaceId: workspaceContext.workspaceId,
    name: importedName,
    createdByUserId: workspaceContext.user._id,
    prompt,
    runtimeId: runtimeSettings.runtimeId,
    runtimeModel: runtimeSettings.model,
    runtimeParams: runtimeSettings.params,
  });

  try {
    await saveAppSourceFiles({
      workspaceId: workspaceContext.workspaceId,
      appId: app._id,
      sourceFiles: bundle.files,
    });
  } catch (error) {
    await deleteApp({
      workspaceId: workspaceContext.workspaceId,
      appId: app._id,
    });
    if (error instanceof AppBundleError) {
      return responseForBundleError(error);
    }
    if (error instanceof SourceFilesLimitError) {
      return NextResponse.json(
        { error: "source_files_limit", message: error.message },
        { status: 413 },
      );
    }
    throw error;
  }

  const importedIntegrationSetupRaw = bundle.files["integration-setup.json"];
  const importedIntegrationSetup = parseImportedIntegrationSetup(
    importedIntegrationSetupRaw,
  );
  let integrationSyncResult: SyncIntegrationSetupInstructionsResult | null = null;
  if (importedIntegrationSetup) {
    integrationSyncResult = await syncIntegrationSetupInstructions({
      workspaceId: workspaceContext.workspaceId,
      setupConfig: importedIntegrationSetup,
      requester: {
        appId: app._id,
        appName: app.name,
        requestedByUserId: workspaceContext.user._id,
        requestedByUserName: workspaceContext.user.displayName,
      },
    });
  }

  const canApproveLiveRuntime = isWorkspaceAdminRole(
    workspaceContext.membership.role,
  );
  let agentsApproval: Awaited<ReturnType<typeof approveCurrentAppAgentsJson>> | null =
    null;
  try {
    agentsApproval = await approveCurrentAppAgentsJson({
      workspaceId: workspaceContext.workspaceId,
      appId: app._id,
      approvedByUserId: workspaceContext.user._id,
      approvedByUserName: workspaceContext.user.displayName,
      source: canApproveLiveRuntime ? "build_chat" : "build_chat_mock",
    });
  } catch (error) {
    if (!(error instanceof InvalidAgentsJsonError)) {
      throw error;
    }
  }

  const importedRuns = bundle.runs.filter(
    (run) => run.mode !== "workspace_agent",
  );
  const restoredMessages = [
    ...importedRuns.flatMap((run) => run.messages),
    createImportedContextMessage({
      appName: app.name,
      prompt,
      context: bundle.manifest?.context,
      fileCount: Object.keys(bundle.files).length,
      hasIntegrationSetupFile: typeof importedIntegrationSetupRaw === "string",
      integrationSetup: importedIntegrationSetup,
      integrationSyncResult,
    }),
  ];
  const latestRun = await createCompletedRun({
    workspaceId: workspaceContext.workspaceId,
    appId: app._id,
    mode: "builder",
    messages: restoredMessages,
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app.imported",
    category: "apps",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId: app._id,
      appName: app.name,
      runId: latestRun?._id,
    }),
    target: { type: "app", id: app._id, name: app.name },
    action: "imported",
    summary: `Imported app ${app.name}.`,
    metadata: {
      fileCount: Object.keys(bundle.files).length,
      restoredRunCount: 1,
      importedRunCount: importedRuns.length,
      hasSecondManifest: Boolean(bundle.manifest),
      agentsJsonApproved: agentsApproval?.hasAgentsJson ?? false,
      agentsJsonApprovalHash: agentsApproval?.hash ?? null,
      agentsJsonMockOnly:
        agentsApproval?.hasAgentsJson === true && !canApproveLiveRuntime,
      integrationSetupFileIncluded:
        typeof importedIntegrationSetupRaw === "string",
      integrationSetupImported: Boolean(importedIntegrationSetup),
      integrationSetupRequestedCount: integrationSyncResult?.requestedCount ?? 0,
      integrationSetupSyncedCount: integrationSyncResult?.grants.length ?? 0,
      integrationSetupSkippedCount: integrationSyncResult?.skippedCount ?? 0,
    },
    changes: {
      changedFields: [
        "draftSnapshotId",
        "agentsJsonApprovalHash",
        "integrationRequirements",
      ],
    },
    relatedIds: { appId: app._id, runId: latestRun?._id },
  });

  const response = NextResponse.json(
    {
      id: app._id,
      workspaceId: app.workspaceId,
      name: app.name,
      initialRun: latestRun
        ? {
            id: latestRun._id,
            status: latestRun.status,
          }
        : null,
      imported: {
        fileCount: Object.keys(bundle.files).length,
        restoredRunCount: 1,
        hasSecondManifest: Boolean(bundle.manifest),
        agentsJsonApproved: agentsApproval?.hasAgentsJson ?? false,
        integrationSetupSynced:
          integrationSyncResult
            ? integrationSyncResult.grants.length
            : 0,
      },
    },
    { status: 201 },
  );

  response.cookies.set(
    buildWorkspaceCookie({
      headers: request.headers,
      url: request.url,
      workspaceId: workspaceContext.workspaceId,
    }),
  );

  return response;
}
