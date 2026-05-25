import { NextResponse } from "next/server";
import { getDraftAgentsJsonApproval } from "@/lib/agents/agents-governance";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import { auditSha256 } from "@/lib/audit/redaction";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  createRun,
  getAppSourceFilesForVersion,
  listRunsForApp,
  scheduleRunAutoStart,
} from "@/lib/db";
import type { AgentRunRecoveryContext } from "@/lib/db/types";
import { normalizeAppSourceVersion } from "@/lib/app-data-scope";
import { findApprovedAppTool } from "@/lib/integrations/execute-http-action";

type AppToolFailureReportRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
    toolName: string;
  }>;
};

const MAX_DESCRIPTION_CHARS = 4000;
const MAX_ATTEMPTED_TASK_CHARS = 2000;
const MAX_REPORT_STRING_CHARS = 3000;
const MAX_PROMPT_JSON_CHARS = 14000;
const SENSITIVE_KEY_PATTERN =
  /password|token|secret|api[-_]?key|authorization|cookie|set-cookie|session|connectionstring|private[-_]?key/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\u0000/g, "");
  if (!normalized) return null;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function sanitizeReportValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > MAX_REPORT_STRING_CHARS
      ? `${value.slice(0, MAX_REPORT_STRING_CHARS)}\n...truncated`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 6) return "[Max depth reached]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeReportValue(item, depth + 1));
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 80)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : sanitizeReportValue(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}

function boundedJson(value: unknown): string {
  const json = JSON.stringify(sanitizeReportValue(value), null, 2) ?? "null";
  return json.length > MAX_PROMPT_JSON_CHARS
    ? `${json.slice(0, MAX_PROMPT_JSON_CHARS)}\n...truncated`
    : json;
}

async function scheduleBuilderRecovery(input: {
  workspaceId: string;
  appId: string;
  prompt: string;
  recoveryContext: AgentRunRecoveryContext;
}): Promise<{
  builderRunId: string;
  status: "builder_repair_message_scheduled" | "builder_repair_run_created";
  appendedToExisting: boolean;
}> {
  const runs = await listRunsForApp(input.appId, input.workspaceId);
  const latestBuilderRun = runs.find(
    (run) => (run.mode ?? "builder") === "builder",
  );

  if (latestBuilderRun && latestBuilderRun.status !== "streaming") {
    const scheduled = await scheduleRunAutoStart({
      runId: latestBuilderRun._id,
      workspaceId: input.workspaceId,
      appId: input.appId,
      autoStartPrompt: input.prompt,
      recoveryContext: input.recoveryContext,
    });
    if (scheduled) {
      return {
        builderRunId: latestBuilderRun._id,
        status: "builder_repair_message_scheduled",
        appendedToExisting: true,
      };
    }
  }

  const builderRun = await createRun({
    appId: input.appId,
    workspaceId: input.workspaceId,
    autoStartPrompt: input.prompt,
    recoveryContext: input.recoveryContext,
  });

  return {
    builderRunId: builderRun._id,
    status: "builder_repair_run_created",
    appendedToExisting: false,
  };
}

function buildRecoveryPrompt(input: {
  appId: string;
  appName: string;
  sourceVersion: "draft" | "published";
  toolName: string;
  description: string;
  attemptedTask: string | null;
  capturedFailure: unknown;
}): string {
  return [
    "Automatic app backend function failure recovery.",
    "",
    "Generated app code reported that an app-callable integration backend function failed. Repair the generated app or governed integration policy so the user can complete the workflow successfully.",
    "",
    "App context:",
    `- App: ${input.appName} (${input.appId})`,
    `- Source version: ${input.sourceVersion}`,
    `- Backend function: ${input.toolName}`,
    "",
    "App report:",
    input.description,
    ...(input.attemptedTask ? ["", "Attempted task:", input.attemptedTask] : []),
    "",
    "Captured failed backend function details (redacted and bounded by the platform):",
    "```json",
    boundedJson(input.capturedFailure),
    "```",
    "",
    "Repair instructions:",
    "1. Inspect `agents.json`, the backend function definition, `integration-setup.json`, app code that calls `callIntegrationTool`, and any typed wrappers.",
    "2. Use the provider status, error category, resolution, endpoint metadata, and app input to decide whether to fix code, setup instructions, or the approved backend function.",
    "3. If the failure is clearly a bad or expired user credential, do not ask for the secret and do not invent a replacement. Improve the app error UI or setup instructions if needed.",
    "4. If `agents.json` changes, call `present_agents` again so the user can approve the governed backend function.",
    "5. If integration setup changes, call `present_integration_setup` again with the complete current setup requirements.",
    "6. Do not add placeholder failure records to app data. Build the repair and call `done_building` when the app is ready.",
  ].join("\n");
}

export async function POST(
  request: Request,
  context: AppToolFailureReportRouteContext,
) {
  const { workspaceId, appId, toolName } = await context.params;

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

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const sourceVersion = normalizeAppSourceVersion(url.searchParams.get("version"));
  if (sourceVersion !== "draft" || !access.canCollaborate) {
    return NextResponse.json(
      {
        error: "builder_repair_requires_draft_access",
        message: "Builder repair reports are only available from editable draft previews.",
      },
      { status: 403 },
    );
  }

  const rawBody = await request.json().catch(() => null);
  if (!isRecord(rawBody)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const description = asString(rawBody.description, MAX_DESCRIPTION_CHARS);
  if (!description) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const attemptedTask = asString(rawBody.attemptedTask, MAX_ATTEMPTED_TASK_CHARS);
  const toolInput = isRecord(rawBody.input) ? rawBody.input : {};
  const result = isRecord(rawBody.result) ? rawBody.result : {};

  const sourceFiles = await getAppSourceFilesForVersion({
    workspaceId: workspaceContext.workspaceId,
    appId,
    version: "draft",
  });
  const approval = getDraftAgentsJsonApproval({
    app: access.app,
    sourceFiles,
  });
  const approvedPayload = approval.approved
    ? access.app.agentsJsonApprovedPayload
    : null;
  const toolSpec = approvedPayload
    ? findApprovedAppTool({ payload: approvedPayload, toolName })
    : null;

  const capturedFailure = sanitizeReportValue({
    id: `app-runtime-tool-failure-${Date.now()}`,
    capturedAt: new Date().toISOString(),
    source: "app_runtime",
    toolName,
    ...(toolSpec?.displayName ? { toolDisplayName: toolSpec.displayName } : {}),
    ...(toolSpec?.description ? { toolDescription: toolSpec.description } : {}),
    parsedInput: toolInput,
    toolSpec: toolSpec
      ? {
          endpoint: toolSpec.endpoint,
          integration: toolSpec.integration,
        }
      : null,
    failure: {
      kind: "app_runtime_tool_execute_error",
      error: asString(result.error, MAX_REPORT_STRING_CHARS) ?? "Unknown backend function failure",
      ...(typeof result.statusCode === "number" ? { statusCode: result.statusCode } : {}),
      ...(typeof result.errorCode === "string" ? { errorCode: result.errorCode } : {}),
      ...(typeof result.errorCategory === "string"
        ? { errorCategory: result.errorCategory }
        : {}),
      ...(typeof result.resolution === "string" ? { resolution: result.resolution } : {}),
      ...(typeof result.retryable === "boolean" ? { retryable: result.retryable } : {}),
      ...(typeof result.canRequestBuilderRepair === "boolean"
        ? { canRequestBuilderRepair: result.canRequestBuilderRepair }
        : {}),
      ...(result.details !== undefined ? { details: result.details } : {}),
      ...(result.data !== undefined ? { response: result.data } : {}),
    },
    appRuntimeReport: {
      description,
      ...(attemptedTask ? { attemptedTask } : {}),
    },
  });

  const recoveryContext: AgentRunRecoveryContext = {
    type: "app_tool_failure",
    source: "app_runtime",
    toolName,
    reportedAt: new Date(),
  };
  const prompt = buildRecoveryPrompt({
    appId,
    appName: access.app.name,
    sourceVersion,
    toolName,
    description,
    attemptedTask,
    capturedFailure,
  });
  const recovery = await scheduleBuilderRecovery({
    workspaceId: workspaceContext.workspaceId,
    appId,
    prompt,
    recoveryContext,
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app_runtime_tool_failure.reported",
    category: "tools",
    severity: "warning",
    outcome: "started",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      kind: "app_iframe",
      trust: "client_untrusted",
      appId,
      appName: access.app.name,
      sourceVersion,
    }),
    target: {
      type: "run",
      id: recovery.builderRunId,
      name: "Builder recovery run",
      parentType: "app",
      parentId: appId,
    },
    action: "recovery_requested",
    summary: `Created builder recovery run for failed backend function ${toolName}.`,
    metadata: {
      recoveryType: "app_tool_failure",
      recoverySource: "app_runtime",
      failedToolName: toolName,
      sourceVersion,
      descriptionLength: description.length,
      attemptedTaskLength: attemptedTask?.length ?? 0,
      hasApprovedToolSpec: Boolean(toolSpec),
      capturedFailureHash: auditSha256(capturedFailure),
      appendedToExistingBuilderRun: recovery.appendedToExisting,
      ...(typeof result.statusCode === "number" ? { statusCode: result.statusCode } : {}),
      ...(typeof result.errorCode === "string" ? { errorCode: result.errorCode } : {}),
      ...(typeof result.errorCategory === "string"
        ? { errorCategory: result.errorCategory }
        : {}),
    },
    relatedIds: {
      appId,
      runId: recovery.builderRunId,
    },
  });

  return NextResponse.json({
    ok: true,
    status: recovery.status,
    builderRunId: recovery.builderRunId,
    appendedToExisting: recovery.appendedToExisting,
  });
}
