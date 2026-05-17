import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import {
  appHasPublishedVersion,
  appHasUnpublishedChanges,
  getAppSourceFilesForVersion,
} from "@/lib/db";
import { workerFetch } from "@/lib/worker-client";

type FilesRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

type AppSourceVersion = "draft" | "published";

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

function hasFiles(files: Record<string, string> | null | undefined): boolean {
  return !!files && Object.keys(files).length > 0;
}

function resolveFiles(
  persistedFiles: Record<string, string> | null | undefined,
  liveFiles: Record<string, string> | null,
): Record<string, string> | null {
  if (hasFiles(persistedFiles) && hasFiles(liveFiles)) {
    return { ...persistedFiles, ...liveFiles };
  }

  if (hasFiles(liveFiles)) return liveFiles;
  return persistedFiles ?? null;
}

async function getLiveWorkerFiles(
  appId: string,
): Promise<Record<string, string> | null> {
  try {
    const res = await workerFetch(`/sessions/${appId}/files`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as { files?: unknown };
    if (!isStringRecord(data.files)) {
      return null;
    }

    return data.files;
  } catch {
    return null;
  }
}

export async function GET(request: Request, context: FilesRouteContext) {
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
    if (isRequestGuardError(error)) {
      return guardErrorToApiResponse(error);
    }
    throw error;
  }

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const app = access.app;

  const requestedVersion =
    url.searchParams.get("version") === "draft" ? "draft" : "published";
  const version: AppSourceVersion =
    requestedVersion === "draft" && access.canCollaborate
      ? "draft"
      : "published";
  const persistedFiles = await getAppSourceFilesForVersion({
    workspaceId: workspaceContext.workspaceId,
    appId,
    version,
  });
  const liveFiles =
    version === "draft" && access.canCollaborate
      ? await getLiveWorkerFiles(appId)
      : null;
  const files = resolveFiles(persistedFiles, liveFiles);

  return NextResponse.json(
    {
      files,
      version,
      hasPublishedVersion: appHasPublishedVersion(app),
      hasDraftChanges: access.canCollaborate
        ? appHasUnpublishedChanges(app)
        : false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
