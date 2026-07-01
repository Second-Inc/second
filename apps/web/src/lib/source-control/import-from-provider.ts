import { randomUUID } from "node:crypto";
import { InvalidAgentsJsonError } from "@/lib/agents/agents-governance";
import {
  AppBundleError,
  parseSecondAppBundle,
  type SecondAppBundleManifest,
} from "@/lib/app-bundles";
import {
  approveCurrentAppAgentsJson,
  createAppForWorkspace,
  createCompletedRun,
  deleteApp,
  findAppAccessMetadata,
  saveAppSourceFiles,
  SourceFilesLimitError,
  updateAppSourceControlMetadata,
} from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/guard";
import { isWorkspaceAdminRole } from "@/lib/auth";
import {
  DEFAULT_RUNTIME_SETTINGS,
  parseRuntimeSettings,
} from "@/lib/agent/runtime-registry";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import type { AppSourceControlMetadata } from "@/lib/db/types";
import { computeSourceControlHash } from "@/lib/source-control/manifest";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function manifestSourceHash(manifest: SecondAppBundleManifest | null): string | null {
  const source = asRecord(manifest?.source);
  return typeof source?.hash === "string" ? source.hash : null;
}

function importedContextMessage(input: {
  appName: string;
  owner: string;
  repo: string;
  tag: string | null;
  fileCount: number;
}) {
  return {
    id: `source-control-import-${randomUUID()}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: [
          "Imported app from source control",
          "",
          `App: ${input.appName}`,
          `Repository: ${input.owner}/${input.repo}`,
          `Version: ${input.tag ?? "default branch"}`,
          `Files restored: ${input.fileCount}`,
          "",
          "Treat the restored files as authoritative for this local copy.",
        ].join("\n"),
      },
    ],
  };
}

function sourceControlMetadata(input: {
  owner: string;
  repo: string;
  tag: string | null;
  version: number | null;
  commitSha: string | null;
  sourceHash: string;
}): AppSourceControlMetadata {
  return {
    publishEnabled: false,
    availableInCatalog: false,
    publishState: "published",
    provider: "github",
    owner: input.owner,
    repo: input.repo,
    defaultBranch: null,
    manifestPath: "second-app.json",
    latestCommitSha: input.commitSha,
    latestTag: input.tag,
    version: input.version,
    sourceHash: input.sourceHash,
    syncStatus: "synced",
    lastSyncedAt: new Date(),
    lastErrorCode: null,
    lastErrorMessage: null,
    installedFrom: {
      provider: "github",
      owner: input.owner,
      repo: input.repo,
      tag: input.tag,
      version: input.version,
      commitSha: input.commitSha,
      sourceHash: input.sourceHash,
    },
  };
}

export async function installSourceControlAppArchive(input: {
  workspaceContext: WorkspaceContext;
  request: Request;
  archive: Buffer;
  owner: string;
  repo: string;
  tag: string | null;
  version: number | null;
  commitSha: string | null;
}) {
  const bundle = parseSecondAppBundle(input.archive);
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
  const app = await createAppForWorkspace({
    workspaceId: input.workspaceContext.workspaceId,
    name: bundle.manifest?.app.name ?? input.repo,
    createdByUserId: input.workspaceContext.user._id,
    prompt: bundle.manifest?.app.prompt ?? undefined,
    runtimeId: runtimeSettings.runtimeId,
    runtimeModel: runtimeSettings.model,
    runtimeParams: runtimeSettings.params,
  });

  try {
    await saveAppSourceFiles({
      workspaceId: input.workspaceContext.workspaceId,
      appId: app._id,
      sourceFiles: bundle.files,
    });
  } catch (error) {
    await deleteApp({
      workspaceId: input.workspaceContext.workspaceId,
      appId: app._id,
    });
    throw error;
  }

  const canApproveLiveRuntime = isWorkspaceAdminRole(
    input.workspaceContext.membership.role,
  );
  try {
    await approveCurrentAppAgentsJson({
      workspaceId: input.workspaceContext.workspaceId,
      appId: app._id,
      approvedByUserId: input.workspaceContext.user._id,
      approvedByUserName: input.workspaceContext.user.displayName,
      source: canApproveLiveRuntime ? "build_chat" : "build_chat_mock",
    });
  } catch (error) {
    if (!(error instanceof InvalidAgentsJsonError)) throw error;
  }

  const sourceHash =
    manifestSourceHash(bundle.manifest) ?? computeSourceControlHash(bundle.files);
  const metadata = sourceControlMetadata({
    owner: input.owner,
    repo: input.repo,
    tag: input.tag,
    version: input.version,
    commitSha: input.commitSha,
    sourceHash,
  });
  await updateAppSourceControlMetadata({
    workspaceId: input.workspaceContext.workspaceId,
    appId: app._id,
    sourceControl: metadata,
  });
  const run = await createCompletedRun({
    workspaceId: input.workspaceContext.workspaceId,
    appId: app._id,
    mode: "builder",
    messages: [
      importedContextMessage({
        appName: app.name,
        owner: input.owner,
        repo: input.repo,
        tag: input.tag,
        fileCount: Object.keys(bundle.files).length,
      }),
    ],
  });

  await recordAuditEvent({
    workspaceId: input.workspaceContext.workspaceId,
    eventName: "app.source_control_app.installed",
    category: "source_control",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(input.workspaceContext),
    source: auditSourceFromRequest(input.request, {
      appId: app._id,
      appName: app.name,
      runId: run?._id,
    }),
    target: { type: "app", id: app._id, name: app.name },
    action: "installed",
    summary: `Installed ${app.name} from GitHub source control.`,
    metadata: {
      provider: "github",
      owner: input.owner,
      repo: input.repo,
      tag: input.tag,
      version: input.version,
      fileCount: Object.keys(bundle.files).length,
      sourceHash,
    },
    relatedIds: { appId: app._id, runId: run?._id },
  });

  return { app, run, sourceControl: metadata };
}

export async function updateSourceControlInstalledAppArchive(input: {
  workspaceContext: WorkspaceContext;
  request: Request;
  appId: string;
  archive: Buffer;
  owner: string;
  repo: string;
  tag: string | null;
  version: number | null;
  commitSha: string | null;
}) {
  const app = await findAppAccessMetadata({
    workspaceId: input.workspaceContext.workspaceId,
    appId: input.appId,
  });
  if (!app) {
    throw new AppBundleError("app_not_found", "The app was not found.", 404);
  }
  const installedFrom = app.sourceControl?.installedFrom;
  if (
    !installedFrom ||
    installedFrom.owner !== input.owner ||
    installedFrom.repo !== input.repo
  ) {
    throw new AppBundleError(
      "source_control_upstream_mismatch",
      "This app was not installed from that source-control repository.",
      409,
    );
  }
  const bundle = parseSecondAppBundle(input.archive);
  await saveAppSourceFiles({
    workspaceId: input.workspaceContext.workspaceId,
    appId: input.appId,
    sourceFiles: bundle.files,
  });
  const sourceHash =
    manifestSourceHash(bundle.manifest) ?? computeSourceControlHash(bundle.files);
  const metadata = {
    ...sourceControlMetadata({
      owner: input.owner,
      repo: input.repo,
      tag: input.tag,
      version: input.version,
      commitSha: input.commitSha,
      sourceHash,
    }),
    publishEnabled: app.sourceControl?.publishEnabled ?? false,
  };
  await updateAppSourceControlMetadata({
    workspaceId: input.workspaceContext.workspaceId,
    appId: input.appId,
    sourceControl: metadata,
  });
  const run = await createCompletedRun({
    workspaceId: input.workspaceContext.workspaceId,
    appId: input.appId,
    mode: "builder",
    messages: [
      importedContextMessage({
        appName: app.name,
        owner: input.owner,
        repo: input.repo,
        tag: input.tag,
        fileCount: Object.keys(bundle.files).length,
      }),
    ],
  });

  await recordAuditEvent({
    workspaceId: input.workspaceContext.workspaceId,
    eventName: "app.source_control_app.updated",
    category: "source_control",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(input.workspaceContext),
    source: auditSourceFromRequest(input.request, {
      appId: input.appId,
      appName: app.name,
      runId: run?._id,
    }),
    target: { type: "app", id: input.appId, name: app.name },
    action: "updated",
    summary: `Updated ${app.name} from GitHub source control.`,
    metadata: {
      provider: "github",
      owner: input.owner,
      repo: input.repo,
      tag: input.tag,
      version: input.version,
      fileCount: Object.keys(bundle.files).length,
      sourceHash,
    },
    changes: {
      changedFields: ["draftSnapshotId", "sourceControl.installedFrom"],
      afterHash: sourceHash,
    },
    relatedIds: { appId: input.appId, runId: run?._id },
  });

  return { run, sourceControl: metadata };
}

export function responseForSourceControlImportError(error: unknown) {
  if (error instanceof AppBundleError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: error.status },
    );
  }
  if (error instanceof SourceFilesLimitError) {
    return Response.json(
      { error: "source_files_limit", message: error.message },
      { status: 413 },
    );
  }
  throw error;
}
