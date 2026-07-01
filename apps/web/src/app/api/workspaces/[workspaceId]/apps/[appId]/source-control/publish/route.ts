import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import { getAppSourceFilesForVersion } from "@/lib/db";
import { canShowLocalSourceControlFeatures } from "@/lib/source-control/runtime";
import { publishAppToSourceControl } from "@/lib/source-control/sync-app";
import { workerFetch } from "@/lib/worker-client";

type PublishSourceControlRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

async function getLiveWorkerFiles(
  appId: string,
): Promise<Record<string, string> | null> {
  try {
    const res = await workerFetch(`/sessions/${appId}/files`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { files?: unknown };
    return isStringRecord(data.files) ? data.files : null;
  } catch {
    return null;
  }
}

function mergeFiles(
  persistedFiles: Record<string, string> | null,
  liveFiles: Record<string, string> | null,
): Record<string, string> | null {
  if (persistedFiles && liveFiles) return { ...persistedFiles, ...liveFiles };
  return liveFiles ?? persistedFiles;
}

export async function POST(
  request: Request,
  context: PublishSourceControlRouteContext,
) {
  const { workspaceId, appId } = await context.params;
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

  const [persistedFiles, liveFiles] = await Promise.all([
    getAppSourceFilesForVersion({
      workspaceId: workspaceContext.workspaceId,
      appId,
      version: "draft",
    }),
    getLiveWorkerFiles(appId),
  ]);
  const files = mergeFiles(persistedFiles, liveFiles);
  if (!files || Object.keys(files).length === 0) {
    return NextResponse.json({ error: "no_source_files" }, { status: 404 });
  }

  const result = await publishAppToSourceControl({
    workspaceContext,
    request,
    appId,
    files,
  });
  if (result.status === "failed") {
    return NextResponse.json(
      { error: result.code, message: result.message },
      { status: 400 },
    );
  }
  if (result.status === "skipped") {
    return NextResponse.json(
      { status: result.status, reason: result.reason },
      { status: 202 },
    );
  }

  return NextResponse.json({ status: "published", sourceControl: result });
}
