import { SECOND_APP_MANIFEST_PATH } from "@/lib/app-bundles";
import { manifestJson } from "@/lib/source-control/manifest";
import {
  safeSourceControlErrorMessage,
  SourceControlProviderError,
  type CommittedSnapshot,
  type CreatedVersionTag,
  type EnsuredRepository,
  type SourceControlAuth,
  type SourceControlCatalogItem,
  type SourceControlProvider,
  type ValidatedSourceControlConnection,
} from "@/lib/source-control/types";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const SECOND_APP_TOPIC = "second-app";
const MAX_DISCOVERY_REPOS = 200;

type GitHubUser = {
  login: string;
  type?: string;
};

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch?: string | null;
  html_url?: string | null;
  clone_url?: string | null;
  description?: string | null;
  topics?: string[];
  pushed_at?: string | null;
  updated_at?: string | null;
};

type GitHubRef = {
  ref: string;
  object: {
    sha: string;
    type: "commit" | "tag" | string;
    url?: string;
  };
};

type GitHubCommit = {
  sha: string;
  tree: { sha: string };
};

type GitHubTree = {
  sha: string;
  tree: Array<{
    path?: string;
    mode?: string;
    type?: string;
    sha?: string | null;
  }>;
  truncated?: boolean;
};

type GitHubContent = {
  type: string;
  encoding?: string;
  content?: string;
  sha?: string;
};

type GitHubTag = {
  name: string;
  commit: { sha: string };
};

function normalizeOwner(value: string): string {
  return value.trim().replace(/^@+/, "");
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function repoSlug(value: string, fallback = "second-app"): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function tagVersion(tag: string): number | null {
  const match = /^second-app-v(\d+)$/.exec(tag);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function repoNameCandidates(input: {
  appName: string;
  prefix?: string | null;
}): string[] {
  const basePrefix = repoSlug(input.prefix ?? "", "second-app");
  const app = repoSlug(input.appName, "app");
  const base = repoSlug([basePrefix, app].filter(Boolean).join("-"));
  return [base, ...Array.from({ length: 20 }, (_, index) => `${base}-${index + 2}`)];
}

function asJsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeProviderError(
  response: Response,
  body: unknown,
): SourceControlProviderError {
  const record = asJsonObject(body);
  const message =
    typeof record?.message === "string"
      ? record.message
      : `GitHub request failed with ${response.status}.`;
  const code =
    response.status === 401
      ? "github_unauthorized"
      : response.status === 403
        ? "github_forbidden"
        : response.status === 404
          ? "github_not_found"
          : response.status === 409
            ? "github_conflict"
            : response.status === 422
              ? "github_validation_failed"
              : "github_request_failed";
  return new SourceControlProviderError({
    code,
    status: response.status,
    retryable: response.status === 429 || response.status >= 500,
    message: safeSourceControlErrorMessage(message),
  });
}

async function githubRequest<T>(input: {
  auth: SourceControlAuth;
  path: string;
  method?: string;
  body?: unknown;
  accept?: string;
}): Promise<T> {
  const response = await fetch(`${GITHUB_API}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Accept: input.accept ?? "application/vnd.github+json",
      Authorization: `Bearer ${input.auth.token}`,
      "Content-Type": "application/json",
      "User-Agent": "second-source-control",
      "X-GitHub-Api-Version": API_VERSION,
    },
    body:
      input.body === undefined ? undefined : JSON.stringify(input.body),
    cache: "no-store",
  });

  const text = await response.text();
  const body = text
    ? (() => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      })()
    : null;

  if (!response.ok) {
    throw normalizeProviderError(response, body);
  }

  return body as T;
}

async function githubRequestRaw(input: {
  auth: SourceControlAuth;
  path: string;
  accept?: string;
}): Promise<{ body: Buffer; contentType: string | null }> {
  const response = await fetch(`${GITHUB_API}${input.path}`, {
    headers: {
      Accept: input.accept ?? "application/vnd.github+json",
      Authorization: `Bearer ${input.auth.token}`,
      "User-Agent": "second-source-control",
      "X-GitHub-Api-Version": API_VERSION,
    },
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw normalizeProviderError(response, text);
  }
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
  };
}

async function githubRequestOrNull<T>(input: {
  auth: SourceControlAuth;
  path: string;
  method?: string;
  body?: unknown;
  accept?: string;
}): Promise<T | null> {
  try {
    return await githubRequest<T>(input);
  } catch (error) {
    if (
      error instanceof SourceControlProviderError &&
      error.status === 404
    ) {
      return null;
    }
    throw error;
  }
}

async function paginate<T>(input: {
  auth: SourceControlAuth;
  path: string;
  maxItems?: number;
}): Promise<T[]> {
  const maxItems = input.maxItems ?? 1000;
  const items: T[] = [];
  for (let page = 1; items.length < maxItems; page += 1) {
    const separator = input.path.includes("?") ? "&" : "?";
    const batch = await githubRequest<T[]>({
      auth: input.auth,
      path: `${input.path}${separator}per_page=100&page=${page}`,
    });
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items.slice(0, maxItems);
}

async function resolveOwnerType(input: {
  auth: SourceControlAuth;
  owner: string;
}): Promise<ValidatedSourceControlConnection["targetOwnerType"]> {
  const org = await githubRequestOrNull<{ login: string }>({
    auth: input.auth,
    path: `/orgs/${encodeURIComponent(input.owner)}`,
  });
  if (org) return "organization";
  const user = await githubRequestOrNull<{ login: string }>({
    auth: input.auth,
    path: `/users/${encodeURIComponent(input.owner)}`,
  });
  return user ? "user" : "unknown";
}

async function getRepo(input: {
  auth: SourceControlAuth;
  owner: string;
  repo: string;
}): Promise<GitHubRepo | null> {
  return githubRequestOrNull<GitHubRepo>({
    auth: input.auth,
    path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`,
  });
}

async function getBranchRef(input: {
  auth: SourceControlAuth;
  owner: string;
  repo: string;
  branch: string;
}): Promise<GitHubRef | null> {
  return githubRequestOrNull<GitHubRef>({
    auth: input.auth,
    path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/ref/heads/${encodePath(input.branch)}`,
  });
}

async function getCommit(input: {
  auth: SourceControlAuth;
  owner: string;
  repo: string;
  sha: string;
}): Promise<GitHubCommit> {
  return githubRequest<GitHubCommit>({
    auth: input.auth,
    path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/commits/${encodeURIComponent(input.sha)}`,
  });
}

async function listTags(input: {
  auth: SourceControlAuth;
  owner: string;
  repo: string;
}): Promise<GitHubTag[]> {
  return paginate<GitHubTag>({
    auth: input.auth,
    path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/tags`,
    maxItems: 200,
  });
}

async function latestSecondAppTag(input: {
  auth: SourceControlAuth;
  owner: string;
  repo: string;
}): Promise<GitHubTag | null> {
  const tags = await listTags(input);
  return tags
    .map((tag) => ({ tag, version: tagVersion(tag.name) }))
    .filter((entry): entry is { tag: GitHubTag; version: number } =>
      entry.version !== null,
    )
    .sort((a, b) => b.version - a.version)[0]?.tag ?? null;
}

async function readManifest(input: {
  auth: SourceControlAuth;
  owner: string;
  repo: string;
  ref?: string | null;
}) {
  const ref = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : "";
  const content = await githubRequestOrNull<GitHubContent>({
    auth: input.auth,
    path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${SECOND_APP_MANIFEST_PATH}${ref}`,
  });
  if (!content || content.type !== "file" || content.encoding !== "base64") {
    return null;
  }
  try {
    return JSON.parse(
      Buffer.from(content.content ?? "", "base64").toString("utf-8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function catalogItemFromManifest(input: {
  repo: GitHubRepo;
  manifest: Record<string, unknown>;
  tag: GitHubTag | null;
}): SourceControlCatalogItem | null {
  if (
    input.manifest.type !== "second.app.export.v1" ||
    input.manifest.schemaVersion !== 1
  ) {
    return null;
  }
  const app = asJsonObject(input.manifest.app);
  const source = asJsonObject(input.manifest.source);
  const sourceControl = asJsonObject(input.manifest.sourceControl);
  if (sourceControl?.availableInCatalog === false) {
    return null;
  }
  const builtBy = asJsonObject(sourceControl?.builtBy);
  const builtByDisplayName =
    typeof builtBy?.displayName === "string" ? builtBy.displayName : null;
  const version =
    typeof sourceControl?.version === "number"
      ? sourceControl.version
      : input.tag
        ? tagVersion(input.tag.name)
        : null;

  return {
    provider: "github",
    owner: input.repo.owner.login,
    repo: input.repo.name,
    repoId: String(input.repo.id),
    defaultBranch: input.repo.default_branch ?? "main",
    title: typeof app?.name === "string" ? app.name : input.repo.name,
    description:
      typeof app?.description === "string"
        ? app.description
        : input.repo.description ?? null,
    builtBy: builtByDisplayName,
    latestTag: input.tag?.name ?? null,
    version,
    commitSha:
      typeof sourceControl?.commitSha === "string"
        ? sourceControl.commitSha
        : input.tag?.commit.sha ?? null,
    sourceHash:
      typeof source?.hash === "string"
        ? source.hash
        : typeof sourceControl?.sourceHash === "string"
          ? sourceControl.sourceHash
          : null,
    updatedAt: input.repo.pushed_at ?? input.repo.updated_at ?? null,
    manifest: input.manifest as SourceControlCatalogItem["manifest"],
  };
}

async function createRepo(input: {
  auth: SourceControlAuth;
  owner: string;
  ownerType: "user" | "organization" | "unknown";
  name: string;
  description?: string | null;
  visibility: "private" | "public";
}): Promise<GitHubRepo> {
  const body = {
    name: input.name,
    description: input.description ?? undefined,
    private: input.visibility !== "public",
    auto_init: true,
  };
  const path =
    input.ownerType === "organization"
      ? `/orgs/${encodeURIComponent(input.owner)}/repos`
      : "/user/repos";
  return githubRequest<GitHubRepo>({
    auth: input.auth,
    path,
    method: "POST",
    body,
  });
}

async function mergeSecondAppTopic(input: {
  auth: SourceControlAuth;
  owner: string;
  repo: string;
}): Promise<void> {
  try {
    const current = await githubRequest<{ names?: string[] }>({
      auth: input.auth,
      path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/topics`,
      accept: "application/vnd.github+json",
    });
    const names = new Set(
      (current.names ?? []).map((topic) => topic.trim().toLowerCase()).filter(Boolean),
    );
    names.add(SECOND_APP_TOPIC);
    await githubRequest({
      auth: input.auth,
      path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/topics`,
      method: "PUT",
      body: { names: [...names].sort() },
      accept: "application/vnd.github+json",
    });
  } catch {
    // Topics are discovery acceleration only. The manifest remains authoritative.
  }
}

async function createTreeAndCommit(input: {
  auth: SourceControlAuth;
  owner: string;
  repo: string;
  branch: string;
  parentCommitSha: string | null;
  baseTreeSha: string | null;
  files: Record<string, string>;
  message: string;
}): Promise<CommittedSnapshot> {
  const existingTree = input.baseTreeSha
    ? await githubRequest<GitHubTree>({
        auth: input.auth,
        path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/trees/${encodeURIComponent(input.baseTreeSha)}?recursive=1`,
      })
    : null;
  const nextPaths = new Set(Object.keys(input.files));
  const tree = [
    ...(existingTree?.tree ?? [])
      .filter((entry) =>
        entry.path &&
        entry.type === "blob" &&
        !nextPaths.has(entry.path) &&
        !entry.path.startsWith(".git/"),
      )
      .map((entry) => ({
        path: entry.path!,
        mode: "100644",
        type: "blob",
        sha: null,
      })),
    ...Object.entries(input.files).map(([path, content]) => ({
      path,
      mode: "100644",
      type: "blob",
      content,
    })),
  ];
  const createdTree = await githubRequest<{ sha: string }>({
    auth: input.auth,
    path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/trees`,
    method: "POST",
    body: {
      ...(input.baseTreeSha ? { base_tree: input.baseTreeSha } : {}),
      tree,
    },
  });
  const commit = await githubRequest<GitHubCommit>({
    auth: input.auth,
    path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/commits`,
    method: "POST",
    body: {
      message: input.message,
      tree: createdTree.sha,
      parents: input.parentCommitSha ? [input.parentCommitSha] : [],
    },
  });

  if (input.parentCommitSha) {
    await githubRequest({
      auth: input.auth,
      path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/refs/heads/${encodePath(input.branch)}`,
      method: "PATCH",
      body: {
        sha: commit.sha,
        force: false,
      },
    });
  } else {
    await githubRequest({
      auth: input.auth,
      path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/refs`,
      method: "POST",
      body: {
        ref: `refs/heads/${input.branch}`,
        sha: commit.sha,
      },
    });
  }

  return {
    commitSha: commit.sha,
    treeSha: createdTree.sha,
    defaultBranch: input.branch,
  };
}

export const githubSourceControlProvider: SourceControlProvider = {
  key: "github",

  async validateConnection(input): Promise<ValidatedSourceControlConnection> {
    const owner = normalizeOwner(input.targetOwner);
    const user = await githubRequest<GitHubUser>({
      auth: input.auth,
      path: "/user",
    });
    const ownerType = await resolveOwnerType({
      auth: input.auth,
      owner,
    });

    if (ownerType === "unknown") {
      throw new SourceControlProviderError({
        code: "github_owner_not_found",
        message: "GitHub owner was not found.",
        status: 404,
      });
    }
    if (ownerType === "user" && owner.toLowerCase() !== user.login.toLowerCase()) {
      throw new SourceControlProviderError({
        code: "github_owner_mismatch",
        message:
          "For user-owned repositories, the GitHub owner must match the PAT account. Use an organization owner for org repositories.",
        status: 400,
      });
    }

    await paginate<GitHubRepo>({
      auth: input.auth,
      path:
        ownerType === "organization"
          ? `/orgs/${encodeURIComponent(owner)}/repos`
          : "/user/repos?affiliation=owner",
      maxItems: 1,
    });

    return {
      provider: "github",
      targetOwner: owner,
      targetOwnerType: ownerType,
      connectedAccountLogin: user.login,
      permissionsState: {
        canReadMetadata: true,
        canReadContents: true,
        canWriteContents: true,
        canCreateRepositories: true,
        canManageTopics: true,
        checkedAt: new Date(),
      },
    };
  },

  async listSecondApps(input): Promise<SourceControlCatalogItem[]> {
    const owner = normalizeOwner(input.connection.targetOwner);
    const repos = await paginate<GitHubRepo>({
      auth: input.auth,
      path:
        input.connection.targetOwnerType === "organization"
          ? `/orgs/${encodeURIComponent(owner)}/repos?type=all`
          : "/user/repos?affiliation=owner",
      maxItems: MAX_DISCOVERY_REPOS,
    });
    const sorted = repos.sort((a, b) => {
      const aTopic = (a.topics ?? []).includes(SECOND_APP_TOPIC) ? 0 : 1;
      const bTopic = (b.topics ?? []).includes(SECOND_APP_TOPIC) ? 0 : 1;
      if (aTopic !== bTopic) return aTopic - bTopic;
      return (b.pushed_at ?? b.updated_at ?? "").localeCompare(
        a.pushed_at ?? a.updated_at ?? "",
      );
    });
    const items: SourceControlCatalogItem[] = [];
    for (const repo of sorted) {
      const tag = await latestSecondAppTag({
        auth: input.auth,
        owner: repo.owner.login,
        repo: repo.name,
      }).catch(() => null);
      const manifest = await readManifest({
        auth: input.auth,
        owner: repo.owner.login,
        repo: repo.name,
        ref: tag?.name ?? repo.default_branch ?? undefined,
      }).catch(() => null);
      if (!manifest) continue;
      const item = catalogItemFromManifest({ repo, manifest, tag });
      if (item) items.push(item);
    }
    return items;
  },

  async ensureAppRepository(input): Promise<EnsuredRepository> {
    const previous = input.previous;
    if (previous?.owner && previous.repo) {
      const repo = await getRepo({
        auth: input.auth,
        owner: previous.owner,
        repo: previous.repo,
      });
      if (repo) {
        return {
          provider: "github",
          owner: repo.owner.login,
          repo: repo.name,
          repoId: String(repo.id),
          defaultBranch: repo.default_branch ?? previous.defaultBranch ?? "main",
          htmlUrl: repo.html_url ?? null,
          cloneUrl: repo.clone_url ?? null,
          created: false,
        };
      }
    }

    const owner = normalizeOwner(input.connection.targetOwner);
    const ownerType = input.connection.targetOwnerType ?? "unknown";
    for (const name of repoNameCandidates({
      appName: input.appName,
      prefix: input.connection.repoNamePrefix,
    })) {
      const existing = await getRepo({
        auth: input.auth,
        owner,
        repo: name,
      });
      if (existing) {
        const manifest = await readManifest({
          auth: input.auth,
          owner,
          repo: name,
          ref: existing.default_branch ?? undefined,
        }).catch(() => null);
        const sourceControl = asJsonObject(manifest?.sourceControl);
        if (
          manifest?.type === "second.app.export.v1" &&
          sourceControl?.repo === name
        ) {
          return {
            provider: "github",
            owner: existing.owner.login,
            repo: existing.name,
            repoId: String(existing.id),
            defaultBranch: existing.default_branch ?? "main",
            htmlUrl: existing.html_url ?? null,
            cloneUrl: existing.clone_url ?? null,
            created: false,
          };
        }
        continue;
      }

      const created = await createRepo({
        auth: input.auth,
        owner,
        ownerType,
        name,
        description: input.description,
        visibility: input.connection.defaultVisibility,
      });
      await mergeSecondAppTopic({
        auth: input.auth,
        owner: created.owner.login,
        repo: created.name,
      });
      return {
        provider: "github",
        owner: created.owner.login,
        repo: created.name,
        repoId: String(created.id),
        defaultBranch: created.default_branch ?? "main",
        htmlUrl: created.html_url ?? null,
        cloneUrl: created.clone_url ?? null,
        created: true,
      };
    }

    throw new SourceControlProviderError({
      code: "github_repo_name_unavailable",
      message: "Could not allocate a GitHub repository name for this app.",
      status: 409,
    });
  },

  async commitAppSnapshot(input): Promise<CommittedSnapshot> {
    const repo = await getRepo({
      auth: input.auth,
      owner: input.owner,
      repo: input.repo,
    });
    if (!repo) {
      throw new SourceControlProviderError({
        code: "github_repo_not_found",
        message: "GitHub repository was not found.",
        status: 404,
      });
    }
    const branch = input.defaultBranch ?? repo.default_branch ?? "main";
    const ref = await getBranchRef({
      auth: input.auth,
      owner: input.owner,
      repo: input.repo,
      branch,
    });
    const parentCommit = ref
      ? await getCommit({
          auth: input.auth,
          owner: input.owner,
          repo: input.repo,
          sha: ref.object.sha,
        })
      : null;
    const files = {
      ...input.files,
      [SECOND_APP_MANIFEST_PATH]: manifestJson(input.manifest),
    };
    const message = [
      "Update Second app snapshot",
      "",
      input.summary.trim() || "Updated app source.",
    ].join("\n");

    return createTreeAndCommit({
      auth: input.auth,
      owner: input.owner,
      repo: input.repo,
      branch,
      parentCommitSha: parentCommit?.sha ?? null,
      baseTreeSha: parentCommit?.tree.sha ?? null,
      files,
      message,
    });
  },

  async createVersionTag(input): Promise<CreatedVersionTag> {
    const existingRef = await githubRequestOrNull<GitHubRef>({
      auth: input.auth,
      path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/ref/tags/${encodePath(input.tag)}`,
    });
    if (existingRef) {
      return {
        tag: input.tag,
        version: input.version,
        commitSha: input.commitSha,
      };
    }
    const tag = await githubRequest<{ sha: string }>({
      auth: input.auth,
      path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/tags`,
      method: "POST",
      body: {
        tag: input.tag,
        message: input.message.trim() || "Second app version",
        object: input.commitSha,
        type: "commit",
      },
    });
    await githubRequest({
      auth: input.auth,
      path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/refs`,
      method: "POST",
      body: {
        ref: `refs/tags/${input.tag}`,
        sha: tag.sha,
      },
    });
    return {
      tag: input.tag,
      version: input.version,
      commitSha: input.commitSha,
    };
  },

  async downloadAppArchive(input) {
    const refPath = input.ref?.trim()
      ? `/${encodeURIComponent(input.ref.trim())}`
      : "";
    const archive = await githubRequestRaw({
      auth: input.auth,
      path: `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/zipball${refPath}`,
      accept: "application/vnd.github+json",
    });
    return {
      archive: archive.body,
      contentType: archive.contentType,
    };
  },
};
