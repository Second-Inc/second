import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import { getValidSourceControlConnection } from "@/lib/db";
import { getSourceControlProvider } from "@/lib/source-control";
import { readSourceControlCredential } from "@/lib/source-control/credential-store";
import {
  responseForSourceControlImportError,
  updateSourceControlInstalledAppArchive,
} from "@/lib/source-control/import-from-provider";
import { canShowLocalSourceControlFeatures } from "@/lib/source-control/runtime";
import {
  safeSourceControlErrorMessage,
  SourceControlProviderError,
} from "@/lib/source-control/types";

type UpdateRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

function parseBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const owner = typeof record.owner === "string" ? record.owner.trim() : "";
  const repo = typeof record.repo === "string" ? record.repo.trim() : "";
  const tag =
    typeof record.tag === "string" && record.tag.trim()
      ? record.tag.trim()
      : null;
  const defaultBranch =
    typeof record.defaultBranch === "string" && record.defaultBranch.trim()
      ? record.defaultBranch.trim()
      : null;
  const version = typeof record.version === "number" ? record.version : null;
  const commitSha =
    typeof record.commitSha === "string" && record.commitSha.trim()
      ? record.commitSha.trim()
      : null;
  if (record.provider !== "github" || !owner || !repo) return null;
  return { owner, repo, tag, defaultBranch, version, commitSha };
}

export async function POST(request: Request, context: UpdateRouteContext) {
  const { workspaceId, appId } = await context.params;
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

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!access.canCollaborate) {
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
    return NextResponse.json(
      { error: "source_control_not_connected" },
      { status: 400 },
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
    const result = await updateSourceControlInstalledAppArchive({
      workspaceContext,
      request,
      appId,
      archive: archive.archive,
      owner: body.owner,
      repo: body.repo,
      tag: body.tag,
      version: body.version,
      commitSha: body.commitSha,
    });
    return NextResponse.json({
      appId,
      runId: result.run?._id ?? null,
      sourceControl: result.sourceControl,
    });
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
