import type { SecondAppBundleManifest } from "@/lib/app-bundles";
import type {
  AppSourceControlMetadata,
  SourceControlConnectionDocument,
  SourceControlOwnerType,
  SourceControlProviderKey,
} from "@/lib/db/types";

export type { SourceControlProviderKey };

export type SourceControlAuth = {
  token: string;
};

export type ValidatedSourceControlConnection = {
  provider: SourceControlProviderKey;
  targetOwner: string;
  targetOwnerType: SourceControlOwnerType;
  connectedAccountLogin: string;
  permissionsState: NonNullable<
    SourceControlConnectionDocument["permissionsState"]
  >;
};

export type SourceControlCatalogItem = {
  provider: SourceControlProviderKey;
  owner: string;
  repo: string;
  repoId?: string | null;
  defaultBranch: string;
  title: string;
  description: string | null;
  builtBy: string | null;
  latestTag: string | null;
  version: number | null;
  commitSha: string | null;
  sourceHash: string | null;
  updatedAt: string | null;
  manifest: SecondAppBundleManifest;
};

export type EnsuredRepository = {
  provider: SourceControlProviderKey;
  owner: string;
  repo: string;
  repoId?: string | null;
  defaultBranch: string;
  htmlUrl?: string | null;
  cloneUrl?: string | null;
  created: boolean;
};

export type CommitAppSnapshotInput = {
  auth: SourceControlAuth;
  owner: string;
  repo: string;
  defaultBranch?: string | null;
  files: Record<string, string>;
  manifest: SecondAppBundleManifest;
  summary: string;
};

export type CommittedSnapshot = {
  commitSha: string;
  treeSha: string;
  defaultBranch: string;
};

export type CreatedVersionTag = {
  tag: string;
  version: number;
  commitSha: string;
};

export type DownloadedArchive = {
  archive: Buffer;
  contentType: string | null;
};

export type SourceControlProvider = {
  key: SourceControlProviderKey;
  validateConnection(input: {
    auth: SourceControlAuth;
    targetOwner: string;
  }): Promise<ValidatedSourceControlConnection>;
  listSecondApps(input: {
    auth: SourceControlAuth;
    connection: SourceControlConnectionDocument;
  }): Promise<SourceControlCatalogItem[]>;
  ensureAppRepository(input: {
    auth: SourceControlAuth;
    connection: SourceControlConnectionDocument;
    appId: string;
    appName: string;
    description?: string | null;
    previous?: AppSourceControlMetadata | null;
  }): Promise<EnsuredRepository>;
  commitAppSnapshot(input: CommitAppSnapshotInput): Promise<CommittedSnapshot>;
  createVersionTag(input: {
    auth: SourceControlAuth;
    owner: string;
    repo: string;
    tag: string;
    version: number;
    commitSha: string;
    message: string;
  }): Promise<CreatedVersionTag>;
  downloadAppArchive(input: {
    auth: SourceControlAuth;
    owner: string;
    repo: string;
    ref?: string | null;
  }): Promise<DownloadedArchive>;
};

export class SourceControlProviderError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(input: {
    code: string;
    message: string;
    status?: number;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "SourceControlProviderError";
    this.code = input.code;
    this.status = input.status ?? 500;
    this.retryable = input.retryable ?? false;
  }
}

export function safeSourceControlErrorMessage(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Source-control operation failed.";
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}
