import {
  AppBundleError,
  filterBundleSourceFiles,
  parseSecondAppBundle,
} from "@/lib/app-bundles";
import {
  findAppAccessMetadata,
  getAppSourceFiles,
  getValidSourceControlConnection,
  markSourceControlConnectionInvalid,
  patchAppSourceControlMetadata,
  saveAppSourceFiles,
  updateAppSourceControlMetadata,
} from "@/lib/db";
import type {
  AppMetadata,
} from "@/lib/db";
import type {
  AppSourceControlMetadata,
  SourceControlConnectionDocument,
} from "@/lib/db/types";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
  type AuditActorInput,
  type AuditSourceInput,
} from "@/lib/audit/record";
import type { WorkspaceContext } from "@/lib/auth/guard";
import { readSourceControlCredential } from "@/lib/source-control/credential-store";
import { getSourceControlProvider } from "@/lib/source-control";
import {
  buildSourceControlManifest,
  computeSourceControlHash,
} from "@/lib/source-control/manifest";
import {
  safeSourceControlErrorMessage,
  SourceControlProviderError,
} from "@/lib/source-control/types";

type SyncAuditInput = {
  actor: AuditActorInput;
  source: AuditSourceInput;
  runId?: string;
};

export type SourceControlSyncResult =
  | { status: "skipped"; reason: string }
  | {
      status: "synced";
      owner: string;
      repo: string;
      tag: string;
      version: number;
      commitSha: string;
      sourceHash: string;
    }
  | { status: "failed"; code: string; message: string };

function nextVersion(sourceControl: AppSourceControlMetadata | null | undefined): number {
  const current = sourceControl?.version;
  return typeof current === "number" && Number.isSafeInteger(current) && current > 0
    ? current + 1
    : 1;
}

function tagForVersion(version: number): string {
  return `second-app-v${version}`;
}

function summaryText(value: string | null | undefined): string {
  return value?.trim().slice(0, 1200) || "Updated app source.";
}

async function recordSyncEvent(input: {
  workspaceId: string;
  app: AppMetadata;
  eventName: string;
  outcome: "started" | "success" | "failure";
  severity?: "info" | "notice" | "warning" | "error";
  action: string;
  summary: string;
  metadata?: Record<string, unknown>;
  changes?: {
    changedFields?: string[];
    beforeHash?: string;
    afterHash?: string;
    redactedFields?: string[];
  };
  audit: SyncAuditInput;
}) {
  await recordAuditEvent({
    workspaceId: input.workspaceId,
    eventName: input.eventName,
    category: "source_control",
    severity: input.severity ?? "notice",
    outcome: input.outcome,
    actor: input.audit.actor,
    source: input.audit.source,
    target: {
      type: "app",
      id: input.app._id,
      name: input.app.name,
    },
    action: input.action,
    summary: input.summary,
    metadata: input.metadata,
    changes: input.changes,
    relatedIds: {
      appId: input.app._id,
      runId: input.audit.runId,
    },
  });
}

async function failSync(input: {
  workspaceId: string;
  app: AppMetadata;
  audit: SyncAuditInput;
  error: unknown;
}): Promise<SourceControlSyncResult> {
  const code =
    input.error instanceof SourceControlProviderError
      ? input.error.code
      : "source_control_sync_failed";
  const message = safeSourceControlErrorMessage(input.error);
  await patchAppSourceControlMetadata({
    workspaceId: input.workspaceId,
    appId: input.app._id,
    patch: {
      publishState: "sync_failed",
      syncStatus: "failed",
      lastErrorCode: code,
      lastErrorMessage: message,
    },
  });
  if (
    input.error instanceof SourceControlProviderError &&
    (input.error.status === 401 || input.error.status === 403)
  ) {
    await markSourceControlConnectionInvalid({
      workspaceId: input.workspaceId,
      provider: "github",
      status: input.error.status === 401 ? "revoked" : "invalid",
      errorCode: input.error.code,
    });
  }
  await recordSyncEvent({
    workspaceId: input.workspaceId,
    app: input.app,
    eventName: "app.source_control_sync.failed",
    outcome: "failure",
    severity: "warning",
    action: "sync_failed",
    summary: `Failed to sync ${input.app.name} to source control.`,
    metadata: {
      code,
      message,
    },
    audit: input.audit,
  });
  return { status: "failed", code, message };
}

async function loadConnectionAndToken(input: {
  workspaceId: string;
}): Promise<{
  connection: SourceControlConnectionDocument;
  token: string;
} | null> {
  const connection = await getValidSourceControlConnection({
    workspaceId: input.workspaceId,
    provider: "github",
  });
  if (!connection) return null;
  return {
    connection,
    token: await readSourceControlCredential(connection.credentialRef),
  };
}

export async function syncAppSnapshotToSourceControl(input: {
  workspaceId: string;
  appId: string;
  files: Record<string, string>;
  summary?: string | null;
  audit: SyncAuditInput;
}): Promise<SourceControlSyncResult> {
  const app = await findAppAccessMetadata({
    workspaceId: input.workspaceId,
    appId: input.appId,
  });
  if (!app) return { status: "skipped", reason: "app_not_found" };

  const connectionAndToken = await loadConnectionAndToken({
    workspaceId: input.workspaceId,
  });
  if (!connectionAndToken) {
    return { status: "skipped", reason: "source_control_not_connected" };
  }
  const publishEnabled = Boolean(app.sourceControl?.publishEnabled);
  const workspaceSourceStorageEnabled =
    connectionAndToken.connection.sourceStorageMode === "source_control";
  if (!publishEnabled && !workspaceSourceStorageEnabled) {
    return { status: "skipped", reason: "source_control_storage_not_enabled" };
  }
  const availableInCatalog = publishEnabled;
  const pendingPatch: Partial<AppSourceControlMetadata> = {
    syncStatus: "pending",
    publishState: "publishing",
    lastSyncStartedAt: new Date(),
    lastErrorCode: null,
    lastErrorMessage: null,
  };
  if (!app.sourceControl) {
    pendingPatch.provider = "github";
    pendingPatch.connectionId = connectionAndToken.connection._id;
    pendingPatch.owner = connectionAndToken.connection.targetOwner;
    pendingPatch.repo = "";
    pendingPatch.manifestPath = "second-app.json";
    pendingPatch.publishEnabled = false;
    pendingPatch.availableInCatalog = false;
  }

  await patchAppSourceControlMetadata({
    workspaceId: input.workspaceId,
    appId: input.appId,
    patch: pendingPatch,
  });
  await recordSyncEvent({
    workspaceId: input.workspaceId,
    app,
    eventName: "app.source_control_sync.started",
    outcome: "started",
    severity: "info",
    action: "sync_started",
    summary: `Started source-control sync for ${app.name}.`,
    audit: input.audit,
  });

  try {
    const files = filterBundleSourceFiles(input.files);
    const sourceHash = computeSourceControlHash(files);
    if (app.sourceControl?.sourceHash === sourceHash) {
      await patchAppSourceControlMetadata({
        workspaceId: input.workspaceId,
        appId: input.appId,
        patch: {
          publishState: "published",
          syncStatus: "synced",
          lastSyncedAt: new Date(),
          lastSummary: summaryText(input.summary),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      return { status: "skipped", reason: "source_hash_unchanged" };
    }

    const provider = getSourceControlProvider("github");
    const repository = await provider.ensureAppRepository({
      auth: { token: connectionAndToken.token },
      connection: connectionAndToken.connection,
      appId: input.appId,
      appName: app.name,
      description: app.description,
      previous: app.sourceControl,
    });
    if (repository.created) {
      await recordSyncEvent({
        workspaceId: input.workspaceId,
        app,
        eventName: "app.source_control_repo.created",
        outcome: "success",
        action: "repo_created",
        summary: `Created GitHub repository ${repository.owner}/${repository.repo} for ${app.name}.`,
        metadata: {
          provider: "github",
          owner: repository.owner,
          repo: repository.repo,
          defaultBranch: repository.defaultBranch,
        },
        audit: input.audit,
      });
    }
    await patchAppSourceControlMetadata({
      workspaceId: input.workspaceId,
      appId: input.appId,
      patch: {
        provider: "github",
        connectionId: connectionAndToken.connection._id,
        owner: repository.owner,
        repo: repository.repo,
        repoId: repository.repoId ?? app.sourceControl?.repoId ?? null,
        defaultBranch: repository.defaultBranch,
        remoteUrl: repository.htmlUrl ?? repository.cloneUrl ?? null,
        manifestPath: "second-app.json",
        publishEnabled,
        availableInCatalog,
      },
    });

    const version = nextVersion(app.sourceControl);
    const tag = tagForVersion(version);
    const manifest = buildSourceControlManifest({
      app,
      files,
      summary: input.summary,
      owner: repository.owner,
      repo: repository.repo,
      tag,
      version,
      sourceHash,
      builtBy: {
        displayName: input.audit.actor.displayName,
        remoteLogin: connectionAndToken.connection.connectedAccountLogin,
      },
      availableInCatalog,
    });
    const commit = await provider.commitAppSnapshot({
      auth: { token: connectionAndToken.token },
      owner: repository.owner,
      repo: repository.repo,
      defaultBranch: repository.defaultBranch,
      files,
      manifest,
      summary: summaryText(input.summary),
    });
    const createdTag = await provider.createVersionTag({
      auth: { token: connectionAndToken.token },
      owner: repository.owner,
      repo: repository.repo,
      tag,
      version,
      commitSha: commit.commitSha,
      message: summaryText(input.summary),
    });
    const sourceControl: AppSourceControlMetadata = {
      ...app.sourceControl,
      publishEnabled,
      availableInCatalog,
      publishState: "published",
      provider: "github",
      connectionId: connectionAndToken.connection._id,
      owner: repository.owner,
      repo: repository.repo,
      repoId: repository.repoId ?? app.sourceControl?.repoId ?? null,
      defaultBranch: commit.defaultBranch,
      remoteUrl: repository.htmlUrl ?? repository.cloneUrl ?? null,
      manifestPath: "second-app.json",
      latestCommitSha: commit.commitSha,
      latestTreeSha: commit.treeSha,
      latestTag: createdTag.tag,
      version: createdTag.version,
      sourceHash,
      syncStatus: "synced",
      lastSyncedAt: new Date(),
      lastSyncStartedAt: app.sourceControl?.lastSyncStartedAt ?? new Date(),
      lastSummary: summaryText(input.summary),
      lastErrorCode: null,
      lastErrorMessage: null,
      createdByRemoteLogin:
        app.sourceControl?.createdByRemoteLogin ??
        connectionAndToken.connection.connectedAccountLogin ??
        null,
      installedFrom: app.sourceControl?.installedFrom ?? null,
    };
    await updateAppSourceControlMetadata({
      workspaceId: input.workspaceId,
      appId: input.appId,
      sourceControl,
    });
    await recordSyncEvent({
      workspaceId: input.workspaceId,
      app,
      eventName: "app.source_control_sync.completed",
      outcome: "success",
      action: "synced",
      summary: `Synced ${app.name} to GitHub as ${createdTag.tag}.`,
      metadata: {
        provider: "github",
        owner: repository.owner,
        repo: repository.repo,
        version: createdTag.version,
        tag: createdTag.tag,
        sourceHash,
      },
      changes: {
        changedFields: [
          "sourceControl.latestCommitSha",
          "sourceControl.latestTag",
          "sourceControl.version",
          "sourceControl.sourceHash",
        ],
        afterHash: sourceHash,
      },
      audit: input.audit,
    });
    return {
      status: "synced",
      owner: repository.owner,
      repo: repository.repo,
      tag: createdTag.tag,
      version: createdTag.version,
      commitSha: commit.commitSha,
      sourceHash,
    };
  } catch (error) {
    return failSync({
      workspaceId: input.workspaceId,
      app,
      audit: input.audit,
      error,
    });
  }
}

export async function publishAppToSourceControl(input: {
  workspaceContext: WorkspaceContext;
  request: Request;
  appId: string;
  files: Record<string, string>;
}): Promise<SourceControlSyncResult> {
  const app = await findAppAccessMetadata({
    workspaceId: input.workspaceContext.workspaceId,
    appId: input.appId,
  });
  if (!app) return { status: "skipped", reason: "app_not_found" };

  const connectionAndToken = await loadConnectionAndToken({
    workspaceId: input.workspaceContext.workspaceId,
  });
  if (!connectionAndToken) {
    return { status: "failed", code: "source_control_not_connected", message: "Source control is not connected." };
  }

  const initialSourceControl: AppSourceControlMetadata = {
    ...(app.sourceControl ?? {
      provider: "github" as const,
      owner: connectionAndToken.connection.targetOwner,
      repo: "",
      manifestPath: "second-app.json" as const,
      syncStatus: "never" as const,
    }),
    publishEnabled: true,
    publishState: "publishing",
    provider: "github",
    connectionId: connectionAndToken.connection._id,
    owner: app.sourceControl?.owner || connectionAndToken.connection.targetOwner,
    repo: app.sourceControl?.repo || "",
    manifestPath: "second-app.json",
    syncStatus: "pending",
    lastSyncStartedAt: new Date(),
    lastErrorCode: null,
    lastErrorMessage: null,
  };
  await updateAppSourceControlMetadata({
    workspaceId: input.workspaceContext.workspaceId,
    appId: input.appId,
    sourceControl: initialSourceControl,
  });

  return syncAppSnapshotToSourceControl({
    workspaceId: input.workspaceContext.workspaceId,
    appId: input.appId,
    files: input.files,
    summary: "Published app to source control.",
    audit: {
      actor: auditActorFromWorkspaceContext(input.workspaceContext),
      source: auditSourceFromRequest(input.request, {
        appId: input.appId,
        appName: app.name,
      }),
    },
  });
}

export async function restoreSourceControlFilesForApp(input: {
  workspaceId: string;
  appId: string;
}): Promise<Record<string, string> | null> {
  const app = await findAppAccessMetadata({
    workspaceId: input.workspaceId,
    appId: input.appId,
  });
  const sourceControl = app?.sourceControl;
  if (!app || !sourceControl?.owner || !sourceControl.repo) {
    return getAppSourceFiles(input);
  }
  const connectionAndToken = await loadConnectionAndToken({
    workspaceId: input.workspaceId,
  });
  if (!connectionAndToken) {
    return getAppSourceFiles(input);
  }
  const ref =
    sourceControl.latestTag ??
    sourceControl.installedFrom?.tag ??
    sourceControl.latestCommitSha ??
    sourceControl.defaultBranch ??
    "main";
  try {
    const archive = await getSourceControlProvider("github").downloadAppArchive({
      auth: { token: connectionAndToken.token },
      owner: sourceControl.owner,
      repo: sourceControl.repo,
      ref,
    });
    const bundle = parseSecondAppBundle(archive.archive);
    await saveAppSourceFiles({
      workspaceId: input.workspaceId,
      appId: input.appId,
      sourceFiles: bundle.files,
    });
    return bundle.files;
  } catch (error) {
    if (error instanceof AppBundleError) {
      return getAppSourceFiles(input);
    }
    return getAppSourceFiles(input);
  }
}
