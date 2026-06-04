import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import {
  getAppSourceFilesForVersion,
  listRunsForApp,
} from "@/lib/db";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  AppBundleError,
  appBundleFilename,
  createSecondAppBundle,
  filterBundleSourceFiles,
} from "@/lib/app-bundles";
import { workerFetch } from "@/lib/worker-client";

export const runtime = "nodejs";

type ExportRouteContext = {
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

function mergeFiles(
  persistedFiles: Record<string, string> | null,
  liveFiles: Record<string, string> | null,
): Record<string, string> | null {
  if (persistedFiles && liveFiles) return { ...persistedFiles, ...liveFiles };
  return liveFiles ?? persistedFiles;
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

export async function GET(
  request: Request,
  context: ExportRouteContext,
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

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!access.canCollaborate) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const persistedFiles = await getAppSourceFilesForVersion({
    workspaceId: workspaceContext.workspaceId,
    appId,
    version: "draft",
  });
  const liveFiles = await getLiveWorkerFiles(appId);
  const sourceFiles = mergeFiles(persistedFiles, liveFiles);
  if (!sourceFiles || Object.keys(sourceFiles).length === 0) {
    return NextResponse.json({ error: "no_files" }, { status: 404 });
  }

  let files: Record<string, string>;
  try {
    files = filterBundleSourceFiles(sourceFiles);
  } catch (error) {
    if (error instanceof AppBundleError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
  const runs = (await listRunsForApp(appId, workspaceContext.workspaceId))
    .filter((run) => run.mode !== "workspace_agent")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((run) => ({
      mode: "builder" as const,
      messages: run.messages,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    }));

  let bundle: Buffer;
  try {
    bundle = createSecondAppBundle({
      app: {
        name: access.app.name,
        description: access.app.description ?? null,
        prompt: access.app.prompt ?? null,
        runtimeId: access.app.runtimeId,
        runtimeModel: access.app.runtimeModel,
        runtimeParams: access.app.runtimeParams,
      },
      files,
      runs,
    });
  } catch (error) {
    if (error instanceof AppBundleError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }

  void recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app.exported",
    category: "apps",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId,
      appName: access.app.name,
    }),
    target: { type: "app", id: appId, name: access.app.name },
    action: "exported",
    summary: `Exported app ${access.app.name}.`,
    metadata: {
      fileCount: Object.keys(files).length,
      runCount: runs.length,
      bundleBytes: bundle.length,
    },
    relatedIds: { appId },
  });

  return new NextResponse(new Uint8Array(bundle), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${appBundleFilename(access.app.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
