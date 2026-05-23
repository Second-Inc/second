import { NextResponse } from "next/server";
import { validateInternalToken } from "@/lib/auth/internal-auth";
import { auditSha256 } from "@/lib/audit/redaction";
import { recordAuditEvent } from "@/lib/audit/record";
import {
  createRun,
  findAppById,
  listRunsForApp,
  loadAppAgentRunTriggerForTool,
  scheduleRunAutoStart,
} from "@/lib/db";
import type { AgentRunRecoveryContext } from "@/lib/db/types";

const MAX_DESCRIPTION_CHARS = 4000;
const MAX_ATTEMPTED_TASK_CHARS = 2000;
const MAX_REPORT_STRING_CHARS = 3000;
const MAX_PROMPT_JSON_CHARS = 14000;

const SENSITIVE_KEY_PATTERN =
  /password|token|secret|api[-_]?key|authorization|cookie|set-cookie|session|connectionstring|private[-_]?key/i;

type ToolFailureReportRequest = {
  workspaceId?: unknown;
  appId?: unknown;
  runId?: unknown;
  sourceVersion?: unknown;
  agentId?: unknown;
  agentName?: unknown;
  appName?: unknown;
  description?: unknown;
  attemptedTask?: unknown;
  requestedToolName?: unknown;
  capturedFailure?: unknown;
};

function asString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\u0000/g, "");
  if (!normalized) return null;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function capturedFailureToolName(capturedFailure: unknown): string | null {
  if (!isRecord(capturedFailure)) return null;
  return typeof capturedFailure.toolName === "string"
    ? capturedFailure.toolName.slice(0, 120)
    : null;
}

function capturedFailureStatus(input: unknown): {
  toolExecuteHttpStatus?: number;
  statusCode?: number;
} {
  if (!isRecord(input) || !isRecord(input.failure)) return {};
  return {
    ...(typeof input.failure.toolExecuteHttpStatus === "number"
      ? { toolExecuteHttpStatus: input.failure.toolExecuteHttpStatus }
      : {}),
    ...(typeof input.failure.statusCode === "number"
      ? { statusCode: input.failure.statusCode }
      : {}),
  };
}

function buildRecoveryPrompt(input: {
  appId: string;
  appName: string;
  appAgentRunId: string;
  sourceVersion: "draft" | "published";
  agentId: string;
  agentName: string;
  description: string;
  attemptedTask: string | null;
  requestedToolName: string | null;
  capturedFailure: unknown;
}): string {
  const failedToolName =
    capturedFailureToolName(input.capturedFailure) ?? input.requestedToolName ?? "unknown";
  const failureJson = boundedJson(input.capturedFailure);

  return [
    "Automatic app-agent tool failure recovery.",
    "",
    "An app agent could not complete a user task because a custom app tool failed. Repair the generated app so the app agent can complete the task successfully.",
    "",
    "App and run context:",
    `- App: ${input.appName} (${input.appId})`,
    `- App-agent run: ${input.appAgentRunId}`,
    `- Source version: ${input.sourceVersion}`,
    `- App agent: ${input.agentName} (${input.agentId})`,
    `- Failed tool: ${failedToolName}`,
    "",
    "App-agent report:",
    input.description,
    ...(input.attemptedTask
      ? ["", "Attempted task:", input.attemptedTask]
      : []),
    "",
    "Captured failed tool call details (redacted and bounded by the platform):",
    "```json",
    failureJson,
    "```",
    "",
    "Repair instructions:",
    "1. Inspect `agents.json`, the failed tool definition, endpoint templating, integration setup, app code, and the app-agent prompt.",
    "2. Fix the tool definition, arguments expected by the agent, integration requirements, or app UI wiring that caused the failure.",
    "3. If `agents.json` changes, call `present_agents` again so the user can approve the governed tool definition.",
    "4. If integration setup changes, call `present_integration_setup` again with the complete current setup requirements.",
    "5. Do not add placeholder failure records to app data. Build the repair and call `done_building` when the app is ready.",
  ].join("\n");
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

export async function POST(request: Request) {
  const authError = validateInternalToken(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => null)) as ToolFailureReportRequest | null;
  if (!body) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const workspaceId = asString(body.workspaceId, 200);
  const appId = asString(body.appId, 200);
  const runId = asString(body.runId, 200);
  const agentId = asString(body.agentId, 200);
  const agentName = asString(body.agentName, 200) ?? agentId;
  const description = asString(body.description, MAX_DESCRIPTION_CHARS);
  const attemptedTask = asString(body.attemptedTask, MAX_ATTEMPTED_TASK_CHARS);
  const requestedToolName = asString(body.requestedToolName, 120);

  if (!workspaceId || !appId || !runId || !agentId || !description) {
    return NextResponse.json(
      { error: "workspaceId, appId, runId, agentId, and description are required" },
      { status: 400 },
    );
  }

  const app = await findAppById({ workspaceId, appId });
  if (!app) {
    return NextResponse.json({ error: "app not found" }, { status: 404 });
  }

  const appAgentRun = await loadAppAgentRunTriggerForTool({
    runId,
    workspaceId,
    appId,
  });
  if (!appAgentRun) {
    return NextResponse.json({ error: "app-agent run not found" }, { status: 404 });
  }
  if (appAgentRun.agentId !== agentId) {
    return NextResponse.json({ error: "agentId does not match run" }, { status: 403 });
  }

  const sourceVersion = appAgentRun.sourceVersion ?? "published";
  const capturedFailure = sanitizeReportValue(body.capturedFailure);
  const failedToolName = capturedFailureToolName(capturedFailure) ?? requestedToolName;
  const recoveryContext: AgentRunRecoveryContext = {
    type: "app_tool_failure",
    source: "app_agent",
    appAgentRunId: runId,
    agentId,
    agentName,
    toolName: failedToolName,
    reportedAt: new Date(),
  };
  const prompt = buildRecoveryPrompt({
    appId,
    appName: app.name,
    appAgentRunId: runId,
    sourceVersion,
    agentId,
    agentName: agentName ?? agentId,
    description,
    attemptedTask,
    requestedToolName,
    capturedFailure,
  });

  const recovery = await scheduleBuilderRecovery({
    workspaceId,
    appId,
    prompt,
    recoveryContext,
  });
  console.info("[tool-failure-report] recovery scheduled", {
    workspaceId,
    appId,
    appAgentRunId: runId,
    builderRunId: recovery.builderRunId,
    failedToolName,
    status: recovery.status,
    appendedToExisting: recovery.appendedToExisting,
  });

  const status = capturedFailureStatus(capturedFailure);
  await recordAuditEvent({
    workspaceId,
    eventName: "app_agent_tool_failure.reported",
    category: "tools",
    severity: "warning",
    outcome: "started",
    actor: {
      kind: "agent",
      agentId,
      agentName: agentName ?? agentId,
    },
    source: {
      kind: "app_agent",
      trust: "internal_trusted",
      appId,
      appName: app.name,
      sourceVersion,
      runId,
    },
    target: {
      type: "run",
      id: recovery.builderRunId,
      name: "Builder recovery run",
      parentType: "app",
      parentId: appId,
    },
    action: "recovery_requested",
    summary: `Created builder recovery run for failed app tool ${failedToolName ?? "unknown"}.`,
    metadata: {
      recoveryType: "app_tool_failure",
      failedToolName,
      sourceVersion,
      descriptionLength: description.length,
      attemptedTaskLength: attemptedTask?.length ?? 0,
      hasCapturedFailure: Boolean(capturedFailure),
      capturedFailureHash: auditSha256(capturedFailure),
      appendedToExistingBuilderRun: recovery.appendedToExisting,
      ...status,
    },
    relatedIds: {
      appId,
      agentRunId: runId,
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
