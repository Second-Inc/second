import { createHash } from "node:crypto";
import {
  filterBundleSourceFiles,
  SECOND_APP_BUNDLE_TYPE,
  type SecondAppBundleManifest,
} from "@/lib/app-bundles";
import type { AppMetadata } from "@/lib/db";

function sourceSummary(files: Record<string, string>) {
  let totalBytes = 0;
  for (const content of Object.values(files)) {
    totalBytes += Buffer.byteLength(content, "utf-8");
  }
  return {
    fileCount: Object.keys(files).length,
    totalBytes,
    includesPreviewArtifact: Boolean(files["dist/index.html"]),
  };
}

export function computeSourceControlHash(
  files: Record<string, string>,
): string {
  const filtered = filterBundleSourceFiles(files);
  const hash = createHash("sha256");
  for (const [path, content] of Object.entries(filtered)) {
    hash.update(path);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function buildSourceControlManifest(input: {
  app: Pick<
    AppMetadata,
    | "_id"
    | "name"
    | "description"
    | "prompt"
    | "runtimeId"
    | "runtimeModel"
    | "runtimeParams"
  >;
  files: Record<string, string>;
  summary?: string | null;
  owner: string;
  repo: string;
  tag?: string | null;
  version?: number | null;
  commitSha?: string | null;
  sourceHash?: string | null;
  builtBy?: {
    displayName?: string | null;
    remoteLogin?: string | null;
  };
  availableInCatalog?: boolean;
}): SecondAppBundleManifest {
  const filtered = filterBundleSourceFiles(input.files);
  const summary = sourceSummary(filtered);
  const sourceHash = input.sourceHash ?? computeSourceControlHash(filtered);
  const buildSummaries = input.summary?.trim() ? [input.summary.trim()] : [];

  return {
    type: SECOND_APP_BUNDLE_TYPE,
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: {
      name: input.app.name,
      description: input.app.description ?? null,
      prompt: input.app.prompt ?? null,
      runtimeId: input.app.runtimeId,
      runtimeModel: input.app.runtimeModel,
      runtimeParams: input.app.runtimeParams,
    },
    source: {
      ...summary,
      hash: sourceHash,
    } as SecondAppBundleManifest["source"] & { hash: string },
    context: {
      initialUserMessage: input.app.prompt ?? null,
      buildSummaries,
    },
    runs: [],
    sourceControl: {
      provider: "github",
      owner: input.owner,
      repo: input.repo,
      tag: input.tag ?? null,
      version: input.version ?? null,
      commitSha: input.commitSha ?? null,
      builtBy: input.builtBy ?? null,
      availableInCatalog: input.availableInCatalog ?? true,
    },
  } as SecondAppBundleManifest & {
    sourceControl: Record<string, unknown>;
  };
}

export function manifestJson(manifest: SecondAppBundleManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
