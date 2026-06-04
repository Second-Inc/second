import { NextResponse } from "next/server";
import {
  buildWorkspaceCookie,
  guardErrorToApiResponse,
  isRequestGuardError,
  isWorkspaceAdminRole,
  requireWorkspaceContext,
} from "@/lib/auth";
import { InvalidAgentsJsonError } from "@/lib/agents/agents-governance";
import {
  approveCurrentAppAgentsJson,
  createAppForWorkspace,
  createCompletedRun,
  deleteApp,
  saveAppSourceFiles,
  SourceFilesLimitError,
} from "@/lib/db";
import {
  DEFAULT_RUNTIME_SETTINGS,
  parseRuntimeSettings,
} from "@/lib/agent/runtime-registry";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  AppBundleError,
  parseSecondAppBundle,
} from "@/lib/app-bundles";
import { validateAppName } from "@/lib/validation";

export const runtime = "nodejs";

type ImportRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

function formString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function appNameFromFilename(filename: string): string {
  return filename
    .replace(/\.second-app\.zip$/i, "")
    .replace(/\.zip$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveImportedAppName(input: {
  explicitName?: string;
  manifestName?: string | null;
  filename: string;
}): string {
  return (
    validateAppName(input.explicitName ?? null) ??
    validateAppName(input.manifestName ?? null) ??
    validateAppName(appNameFromFilename(input.filename)) ??
    "Imported app"
  );
}

function responseForBundleError(error: AppBundleError) {
  return NextResponse.json(
    { error: error.code, message: error.message },
    { status: error.status },
  );
}

export async function POST(
  request: Request,
  context: ImportRouteContext,
) {
  const { workspaceId } = await context.params;
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

  const formData = await request.formData();
  const upload = formData.get("file");
  if (!(upload instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (upload.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "bundle_too_large" },
      { status: 413 },
    );
  }

  let bundle: ReturnType<typeof parseSecondAppBundle>;
  try {
    bundle = parseSecondAppBundle(Buffer.from(await upload.arrayBuffer()));
  } catch (error) {
    if (error instanceof AppBundleError) {
      return responseForBundleError(error);
    }
    throw error;
  }

  const importedName = resolveImportedAppName({
    explicitName: formString(formData.get("appName")),
    manifestName: bundle.manifest?.app.name ?? null,
    filename: upload.name,
  });
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
  const prompt = bundle.manifest?.app.prompt ?? undefined;

  const app = await createAppForWorkspace({
    workspaceId: workspaceContext.workspaceId,
    name: importedName,
    createdByUserId: workspaceContext.user._id,
    prompt,
    runtimeId: runtimeSettings.runtimeId,
    runtimeModel: runtimeSettings.model,
    runtimeParams: runtimeSettings.params,
  });

  try {
    await saveAppSourceFiles({
      workspaceId: workspaceContext.workspaceId,
      appId: app._id,
      sourceFiles: bundle.files,
    });
  } catch (error) {
    await deleteApp({
      workspaceId: workspaceContext.workspaceId,
      appId: app._id,
    });
    if (error instanceof AppBundleError) {
      return responseForBundleError(error);
    }
    if (error instanceof SourceFilesLimitError) {
      return NextResponse.json(
        { error: "source_files_limit", message: error.message },
        { status: 413 },
      );
    }
    throw error;
  }

  const canApproveLiveRuntime = isWorkspaceAdminRole(
    workspaceContext.membership.role,
  );
  let agentsApproval: Awaited<ReturnType<typeof approveCurrentAppAgentsJson>> | null =
    null;
  try {
    agentsApproval = await approveCurrentAppAgentsJson({
      workspaceId: workspaceContext.workspaceId,
      appId: app._id,
      approvedByUserId: workspaceContext.user._id,
      approvedByUserName: workspaceContext.user.displayName,
      source: canApproveLiveRuntime ? "build_chat" : "build_chat_mock",
    });
  } catch (error) {
    if (!(error instanceof InvalidAgentsJsonError)) {
      throw error;
    }
  }

  const importedRuns = bundle.runs.filter(
    (run) => run.mode !== "workspace_agent",
  );
  const restoredMessages = importedRuns.flatMap((run) => run.messages);
  const latestRun = await createCompletedRun({
    workspaceId: workspaceContext.workspaceId,
    appId: app._id,
    mode: "builder",
    messages: restoredMessages,
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app.imported",
    category: "apps",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId: app._id,
      appName: app.name,
      runId: latestRun?._id,
    }),
    target: { type: "app", id: app._id, name: app.name },
    action: "imported",
    summary: `Imported app ${app.name}.`,
    metadata: {
      fileCount: Object.keys(bundle.files).length,
      restoredRunCount: 1,
      importedRunCount: importedRuns.length,
      hasSecondManifest: Boolean(bundle.manifest),
      agentsJsonApproved: agentsApproval?.hasAgentsJson ?? false,
      agentsJsonApprovalHash: agentsApproval?.hash ?? null,
      agentsJsonMockOnly:
        agentsApproval?.hasAgentsJson === true && !canApproveLiveRuntime,
    },
    changes: {
      changedFields: [
        "draftSnapshotId",
        "agentsJsonApprovalHash",
      ],
    },
    relatedIds: { appId: app._id, runId: latestRun?._id },
  });

  const response = NextResponse.json(
    {
      id: app._id,
      workspaceId: app.workspaceId,
      name: app.name,
      initialRun: latestRun
        ? {
            id: latestRun._id,
            status: latestRun.status,
          }
        : null,
      imported: {
        fileCount: Object.keys(bundle.files).length,
        restoredRunCount: 1,
        hasSecondManifest: Boolean(bundle.manifest),
        agentsJsonApproved: agentsApproval?.hasAgentsJson ?? false,
      },
    },
    { status: 201 },
  );

  response.cookies.set(
    buildWorkspaceCookie({
      headers: request.headers,
      url: request.url,
      workspaceId: workspaceContext.workspaceId,
    }),
  );

  return response;
}
