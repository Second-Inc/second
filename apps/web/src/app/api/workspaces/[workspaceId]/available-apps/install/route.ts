import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  findInstalledSourceControlApp,
  getValidSourceControlConnection,
} from "@/lib/db";
import { readSourceControlCredential } from "@/lib/source-control/credential-store";
import { getSourceControlProvider } from "@/lib/source-control";
import { canShowLocalSourceControlFeatures } from "@/lib/source-control/runtime";
import {
  installSourceControlAppArchive,
  responseForSourceControlImportError,
} from "@/lib/source-control/import-from-provider";
import {
  safeSourceControlErrorMessage,
  SourceControlProviderError,
} from "@/lib/source-control/types";

type InstallRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

function parseBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const owner = typeof record.owner === "string" ? record.owner.trim() : "";
  const repo = typeof record.repo === "string" ? record.repo.trim() : "";
  const tag = typeof record.tag === "string" && record.tag.trim()
    ? record.tag.trim()
    : null;
  const version = typeof record.version === "number" ? record.version : null;
  const commitSha =
    typeof record.commitSha === "string" && record.commitSha.trim()
      ? record.commitSha.trim()
      : null;
  const defaultBranch =
    typeof record.defaultBranch === "string" && record.defaultBranch.trim()
      ? record.defaultBranch.trim()
      : null;
  if (record.provider !== "github" || !owner || !repo) return null;
  return { owner, repo, tag, version, commitSha, defaultBranch };
}

export async function POST(request: Request, context: InstallRouteContext) {
  const { workspaceId } = await context.params;
  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  if (!canShowLocalSourceControlFeatures()) {
    return NextResponse.json({ error: "local_runtime_required" }, { status: 404 });
  }
  if (!hasWorkspacePermission(workspaceContext.membership, "apps:create")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = parseBody(await request.json().catch(() => null));
  if (!body) {
    return NextResponse.json({ error: "invalid_available_app" }, { status: 400 });
  }
  const connection = await getValidSourceControlConnection({
    workspaceId: workspaceContext.workspaceId,
    provider: "github",
  });
  if (!connection) {
    return NextResponse.json({ error: "source_control_not_connected" }, { status: 400 });
  }
  const existingApp = await findInstalledSourceControlApp({
    workspaceId: workspaceContext.workspaceId,
    provider: "github",
    owner: body.owner,
    repo: body.repo,
  });
  if (existingApp) {
    return NextResponse.json(
      {
        error: "source_control_app_already_installed",
        appId: existingApp._id,
      },
      { status: 409 },
    );
  }

  try {
    const token = await readSourceControlCredential(connection.credentialRef);
    const archive = await getSourceControlProvider("github").downloadAppArchive({
      auth: { token },
      owner: body.owner,
      repo: body.repo,
      ref: body.tag ?? body.defaultBranch,
    });
    const result = await installSourceControlAppArchive({
      workspaceContext,
      request,
      archive: archive.archive,
      owner: body.owner,
      repo: body.repo,
      tag: body.tag,
      version: body.version,
      commitSha: body.commitSha,
    });
    return NextResponse.json(
      {
        appId: result.app._id,
        runId: result.run?._id ?? null,
        sourceControl: result.sourceControl,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SourceControlProviderError) {
      return NextResponse.json(
        { error: error.code, message: safeSourceControlErrorMessage(error) },
        { status: error.status },
      );
    }
    return responseForSourceControlImportError(error);
  }
}
