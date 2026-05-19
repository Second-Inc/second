import { timingSafeEqual } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, sep } from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { SessionManager } from "./session-manager.js";
import {
  collectWorkspaceSnapshot,
  defaultAllowedToolsForRuntimeMode,
  type AgentConfig,
} from "./runner.js";
import { encodeMessage, encodeDone, encodeError, SSE_HEADERS } from "./event-stream.js";
import { WORKSPACE_TEMPLATE } from "./workspace-template.js";
import { startDependencyWarmup } from "./dep-warmup.js";
import { AgentRunManager, type AgentRunConfig } from "./agent-run-manager.js";
import { generateAppMetadata } from "./metadata-generator.js";
import {
  ensureBuilderSkills,
  ensureRuntimeSkills,
  type RuntimeSkill,
} from "./builder-skills.js";
import {
  handleMcpJsonRpc,
} from "./tool-broker.js";
import {
  normalizeRuntimeSettings,
  prewarmRuntimeAgent,
  type AgentRuntimeSettings,
  type ProviderSessionState,
} from "./runtimes/index.js";
import { claudeSubprocessIsolationStatus } from "./runtimes/claude-env.js";

function resolveWorkspaceDir(appId: string): string {
  return process.env.WORKSPACES_DIR
    ? `${process.env.WORKSPACES_DIR}/${appId}`
    : `/tmp/second-workspaces/${appId}`;
}

function ensureWorkingDirectory(appId: string): string {
  const dir = resolveWorkspaceDir(appId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function isWorkspaceContentEntry(entry: string): boolean {
  return !entry.startsWith(".") && entry !== "attachments";
}

function cleanupDisposableWorkspace(workingDirectory: string, marker: string): void {
  const workspaceRoot = resolve(
    process.env.WORKSPACES_DIR ?? "/tmp/second-workspaces",
  );
  const target = resolve(workingDirectory);
  if (!target.startsWith(`${workspaceRoot}${sep}`) || !target.includes(marker)) {
    return;
  }

  try {
    rmSync(target, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `[worker] Failed to clean workspace ${target}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * If a workspace directory is empty (new app), write the template scaffold.
 * If sourceFiles are provided (restore from DB), write those instead.
 */
function scaffoldWorkspace(
  dir: string,
  sourceFiles?: Record<string, string>,
): void {
  const entries = readdirSync(dir);
  // Only scaffold if the directory has no source files. Uploaded attachments
  // can arrive before the first prompt, but they should not block scaffold or
  // restore for the real app workspace.
  if (entries.some(isWorkspaceContentEntry)) return;

  const files = sourceFiles ?? WORKSPACE_TEMPLATE;
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }
  console.log(
    `[worker] Scaffolded workspace: ${dir} (${Object.keys(files).length} files)`,
  );
}

const CLAUDE_PROJECT_KEY_MAX_LENGTH = 200;

function fallbackProjectKeyHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function toClaudeProjectKey(cwd: string): string {
  const sanitized = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  if (sanitized.length <= CLAUDE_PROJECT_KEY_MAX_LENGTH) {
    return sanitized;
  }
  return `${sanitized.slice(0, CLAUDE_PROJECT_KEY_MAX_LENGTH)}-${fallbackProjectKeyHash(cwd)}`;
}

function getSessionJsonlPath(cwd: string, sessionId: string): string {
  // Claude Agent SDK stores sessions at ~/.claude/projects/<project-key>/<sessionId>.jsonl
  // where project-key is cwd sanitized with /[^a-zA-Z0-9]/g and capped at 200 chars.
  const projectsDir = join(homedir(), ".claude", "projects");
  const cwdKey = toClaudeProjectKey(cwd);
  return join(projectsDir, cwdKey, `${sessionId}.jsonl`);
}

function restoreSessionJsonl(cwd: string, sessionId: string, jsonl: string): void {
  const filePath = getSessionJsonlPath(cwd, sessionId);
  const dir = join(filePath, "..");
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, jsonl, "utf-8");
  console.log(`Restored JSONL session file: ${filePath} (${jsonl.length} bytes)`);
}

function readSessionJsonl(cwd: string, sessionId: string): string | null {
  const filePath = getSessionJsonlPath(cwd, sessionId);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf-8");
}

const app = new Hono();
const sessionManager = new SessionManager();
const agentRunManager = new AgentRunManager();

function getWorkerBaseUrl(): string {
  return process.env.WORKER_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3001"}`;
}

app.use("*", async (c, next) => {
  if (c.req.path === "/health" || c.req.path.startsWith("/mcp/")) {
    return next();
  }

  const internalToken = process.env.INTERNAL_API_TOKEN?.trim();
  if (!internalToken) {
    if (process.env.NODE_ENV !== "production") {
      return next();
    }

    return c.json({ error: "INTERNAL_API_TOKEN not configured" }, 500);
  }

  const authHeader = c.req.header("authorization");
  const expected = `Bearer ${internalToken}`;
  if (
    !authHeader ||
    authHeader.length !== expected.length ||
    !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
  ) {
    return c.json({ error: "unauthorized" }, 401);
  }

  return next();
});

app.post("/sessions/:appId/messages", async (c) => {
  const appId = c.req.param("appId");
  const body = await c.req.json<{
    prompt: string;
    systemPrompt: string;
    runtimeId?: AgentRuntimeSettings["runtimeId"];
    runtimeModel?: string;
    runtimeParams?: Record<string, string>;
    runtimeMode?: "builder" | "workspace_agent";
    selectedSkills?: RuntimeSkill[];
    workingDirectory?: string;
    allowedTools?: string[];
    maxTurns?: number;
    sessionState?: ProviderSessionState;
    sourceFiles?: Record<string, string>;
    agentConfig?: AgentConfig;
    workspaceId?: string;
    appName?: string;
    requestedByUserId?: string;
    requestedByUserName?: string;
  }>();

  if (
    !body.runtimeId ||
    !body.runtimeModel ||
    !body.runtimeParams ||
    typeof body.runtimeParams !== "object" ||
    Array.isArray(body.runtimeParams)
  ) {
    return c.json({ error: "invalid_runtime_settings" }, 400);
  }

  let runtimeSettings: AgentRuntimeSettings;
  try {
    runtimeSettings = normalizeRuntimeSettings({
      runtimeId: body.runtimeId,
      model: body.runtimeModel,
      params: body.runtimeParams,
    });
  } catch {
    return c.json({ error: "invalid_runtime_settings" }, 400);
  }

  console.log(
    `[worker] appId=${appId} runtime=${runtimeSettings.runtimeId} model=${runtimeSettings.model}`,
  );

  const workingDirectory = ensureWorkingDirectory(appId);
  const resolvedWorkDir = body.workingDirectory ?? workingDirectory;
  const runtimeMode = body.runtimeMode === "workspace_agent"
    ? "workspace_agent"
    : "builder";
  const allowedTools = body.allowedTools ??
    defaultAllowedToolsForRuntimeMode(runtimeMode);

  if (runtimeMode === "workspace_agent") {
    ensureRuntimeSkills(resolvedWorkDir, body.selectedSkills ?? []);
  } else {
    // Scaffold the workspace with template or restored source files
    scaffoldWorkspace(resolvedWorkDir, body.sourceFiles ?? undefined);
    ensureBuilderSkills(resolvedWorkDir);
    ensureRuntimeSkills(resolvedWorkDir, body.selectedSkills ?? []);

    // Pre-warm dependencies in the background so they're ready when done_building runs.
    // If node_modules already exists (warm worker), this is a no-op.
    startDependencyWarmup(resolvedWorkDir);
  }

  // If we have a JSONL session file to restore (cross-container resume),
  // write it to disk before creating the session
  if (
    body.sessionState?.runtimeId === "claude-code" &&
    body.sessionState.sessionId &&
    body.sessionState.data
  ) {
    restoreSessionJsonl(
      resolvedWorkDir,
      body.sessionState.sessionId,
      body.sessionState.data,
    );
  }

  const session = sessionManager.getOrCreate(appId, {
    systemPrompt: body.systemPrompt,
    workingDirectory: resolvedWorkDir,
    runtimeMode,
    allowedTools,
    maxTurns: body.maxTurns,
    agentConfig: body.agentConfig,
    toolExecuteUrl: process.env.TOOL_EXECUTE_URL,
    internalApiToken: process.env.INTERNAL_API_TOKEN,
    workspaceId: body.workspaceId,
    appId,
    appName: body.appName,
    requestedByUserId: body.requestedByUserId,
    requestedByUserName: body.requestedByUserName,
    runtimeSessionKey: runtimeMode === "workspace_agent"
      ? `${appId}__agent__workspace`
      : appId,
  }, body.sessionState ?? null);

  session.resetTTL();
  void prewarmRuntimeAgent({
    config: session.config,
    settings: runtimeSettings,
    sessionState: session.sessionState,
    workerBaseUrl: getWorkerBaseUrl(),
  }).catch((error) => {
    console.warn(
      `[worker] runtime prewarm skipped appId=${appId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });

  let streamClosed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (chunk: Uint8Array): boolean => {
        if (streamClosed) return false;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          streamClosed = true;
          return false;
        }
      };
      const close = () => {
        if (streamClosed) return;
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // The client may have already disconnected or cancelled the stream.
        }
      };

      try {
        for await (const msg of session.sendMessage(
          body.prompt,
          runtimeSettings,
          getWorkerBaseUrl(),
        )) {
          if (!enqueue(encodeMessage(msg))) {
            session.cancelCurrentRun("stream_closed");
            return;
          }
        }
        enqueue(encodeDone());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[worker] message stream failed appId=${appId} runtime=${runtimeSettings.runtimeId} model=${runtimeSettings.model}: ${message}`,
        );
        enqueue(encodeError(message));
      } finally {
        close();
      }
    },
    cancel() {
      streamClosed = true;
      session.cancelCurrentRun("stream_cancelled");
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
});

app.get("/sessions/:appId/status", (c) => {
  const appId = c.req.param("appId");
  const session = sessionManager.get(appId);
  const workspaceDir = resolveWorkspaceDir(appId);
  const workspaceExists = existsSync(workspaceDir);
  const workspaceHasFiles = workspaceExists
    ? readdirSync(workspaceDir).some(isWorkspaceContentEntry)
    : false;

  const baseResponse = {
    workspaceExists,
    workspaceHasFiles,
    restoreNeeded: !workspaceHasFiles,
  };

  if (!session) {
    return c.json({ exists: false, ...baseResponse });
  }
  return c.json({
    exists: true,
    status: session.status,
    sessionState: session.sessionState,
    ttlRemainingMs: session.ttlRemainingMs(),
    createdAt: session.createdAt.toISOString(),
    lastActiveAt: session.lastActiveAt.toISOString(),
    ...baseResponse,
  });
});

const MAX_ATTACHMENT_FILES = 10;
const MAX_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeAttachmentPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = posix.normalize(value).replace(/^\/+/, "");
  if (
    !normalized.startsWith("attachments/") ||
    normalized.split("/").includes("..") ||
    normalized.endsWith("/")
  ) {
    return null;
  }
  return normalized;
}

app.post("/sessions/:appId/attachments", async (c) => {
  const appId = c.req.param("appId");
  const body = (await c.req.json().catch(() => null)) as {
    files?: unknown;
  } | null;

  if (!Array.isArray(body?.files) || body.files.length === 0) {
    return c.json({ error: "missing_files" }, 400);
  }
  if (body.files.length > MAX_ATTACHMENT_FILES) {
    return c.json({ error: "too_many_files" }, 413);
  }

  const workingDirectory = ensureWorkingDirectory(appId);
  const root = resolve(workingDirectory);
  const attachments: Array<{
    id: string;
    name: string;
    path: string;
    size: number;
    contentType?: string;
  }> = [];
  let totalBytes = 0;

  for (const item of body.files) {
    const file = asObject(item);
    const id = typeof file?.id === "string" ? file.id : "";
    const name = typeof file?.name === "string" ? file.name : "";
    const contentType =
      typeof file?.contentType === "string" ? file.contentType : undefined;
    const path = normalizeAttachmentPath(file?.path);
    const dataBase64 =
      typeof file?.dataBase64 === "string" ? file.dataBase64 : "";
    const declaredSize =
      typeof file?.size === "number" && Number.isFinite(file.size)
        ? file.size
        : -1;

    if (!id || !name || !path || !dataBase64 || declaredSize < 0) {
      return c.json({ error: "invalid_file" }, 400);
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(dataBase64, "base64");
    } catch {
      return c.json({ error: "invalid_file_data" }, 400);
    }

    if (buffer.byteLength !== declaredSize) {
      return c.json({ error: "invalid_file_size" }, 400);
    }
    if (buffer.byteLength > MAX_ATTACHMENT_FILE_BYTES) {
      return c.json({ error: "file_too_large" }, 413);
    }
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      return c.json({ error: "upload_too_large" }, 413);
    }

    const target = resolve(workingDirectory, path);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      return c.json({ error: "invalid_file_path" }, 400);
    }

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buffer);
    attachments.push({
      id,
      name,
      path,
      size: buffer.byteLength,
      ...(contentType ? { contentType } : {}),
    });
  }

  return c.json({ attachments });
});

app.post("/sessions/:appId/attachments/check", async (c) => {
  const appId = c.req.param("appId");
  const body = (await c.req.json().catch(() => null)) as {
    paths?: unknown;
  } | null;

  if (!Array.isArray(body?.paths)) {
    return c.json({ error: "missing_paths" }, 400);
  }
  if (body.paths.length > MAX_ATTACHMENT_FILES) {
    return c.json({ error: "too_many_files" }, 413);
  }

  const workingDirectory = resolveWorkspaceDir(appId);
  const root = resolve(workingDirectory);
  const missing: string[] = [];

  for (const item of body.paths) {
    const path = normalizeAttachmentPath(item);
    if (!path) {
      return c.json({ error: "invalid_file_path" }, 400);
    }

    const target = resolve(workingDirectory, path);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      return c.json({ error: "invalid_file_path" }, 400);
    }

    let isPresentFile = false;
    try {
      isPresentFile = existsSync(target) && statSync(target).isFile();
    } catch {
      isPresentFile = false;
    }

    if (!isPresentFile) {
      missing.push(path);
    }
  }

  return c.json({ missing });
});

app.delete("/sessions/:appId", (c) => {
  const appId = c.req.param("appId");
  sessionManager.destroy(appId);
  return c.json({ ok: true });
});

app.post("/sessions/:appId/cancel", async (c) => {
  const appId = c.req.param("appId");
  const body = (await c.req.json().catch(() => null)) as {
    reason?: string;
    runId?: string;
  } | null;
  const cancelled = sessionManager.cancel(
    appId,
    typeof body?.reason === "string" ? body.reason : "cancelled",
  );
  return c.json({
    ok: true,
    cancelled,
    status: sessionManager.get(appId)?.status ?? "idle",
  });
});

app.get("/sessions/:appId/session-file", (c) => {
  const session = sessionManager.get(c.req.param("appId"));
  if (!session || !session.sessionState?.sessionId) {
    return c.json({ sessionState: null });
  }
  if (session.sessionState.runtimeId === "claude-code") {
    const jsonl = readSessionJsonl(
      session.config.workingDirectory,
      session.sessionState.sessionId,
    );
    return c.json({
      sessionState: {
        ...session.sessionState,
        data: jsonl,
        format: "claude-jsonl",
      },
    });
  }
  return c.json({ sessionState: session.sessionState });
});

app.post("/mcp/:sessionId", async (c) => {
  const authHeader = c.req.header("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  const payload = await c.req.json().catch(() => null);
  if (!payload) {
    return c.json({ error: "invalid_json_rpc_body" }, 400);
  }
  const result = await handleMcpJsonRpc({
    sessionId: c.req.param("sessionId"),
    serverName: c.req.query("server") ?? null,
    bearerToken,
    payload,
  });
  if (result === undefined) {
    return new Response(null, { status: 204 });
  }
  return c.json(result);
});

app.get("/sessions/:appId/files", (c) => {
  const appId = c.req.param("appId");
  const dir = resolveWorkspaceDir(appId);

  if (!existsSync(dir)) {
    return c.json({ files: {} });
  }

  try {
    const snapshot = collectWorkspaceSnapshot(dir);
    return c.json({ files: snapshot.files });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to collect workspace files";
    return c.json({ error: message }, 413);
  }
});

app.post("/sessions/:appId/metadata", async (c) => {
  const appId = c.req.param("appId");
  const startedAt = Date.now();
  console.info(`[worker] metadata request appId=${appId}`);
  const body = await c.req.json<{
    prompt?: string;
    fallbackName?: string;
    runtimeId?: AgentRuntimeSettings["runtimeId"];
    runtimeModel?: string;
    runtimeParams?: Record<string, string>;
  }>();

  if (
    typeof body.prompt !== "string" ||
    !body.prompt.trim() ||
    !body.runtimeId ||
    !body.runtimeModel ||
    !body.runtimeParams ||
    typeof body.runtimeParams !== "object" ||
    Array.isArray(body.runtimeParams)
  ) {
    console.warn(`[worker] metadata invalid request appId=${appId}`);
    return c.json({ error: "invalid_metadata_request" }, 400);
  }

  let runtimeSettings: AgentRuntimeSettings;
  try {
    runtimeSettings = normalizeRuntimeSettings({
      runtimeId: body.runtimeId,
      model: body.runtimeModel,
      params: body.runtimeParams,
    });
  } catch {
    console.warn(`[worker] metadata invalid runtime appId=${appId}`);
    return c.json({ error: "invalid_runtime_settings" }, 400);
  }

  const metadataWorkspaceId = `${appId}__metadata__${Date.now().toString(36)}`;
  const workingDirectory = ensureWorkingDirectory(metadataWorkspaceId);
  console.info(
    `[worker] metadata start appId=${appId} workspace=${metadataWorkspaceId} runtime=${runtimeSettings.runtimeId} model=${runtimeSettings.model}`,
  );

  try {
    const metadata = await generateAppMetadata({
      appId,
      prompt: body.prompt.slice(0, 10000),
      fallbackName:
        typeof body.fallbackName === "string" && body.fallbackName.trim()
          ? body.fallbackName.trim().slice(0, 80)
          : "Untitled app",
      runtimeSettings,
      workingDirectory,
      workerBaseUrl: getWorkerBaseUrl(),
    });

    console.info(
      `[worker] metadata complete appId=${appId} name=${JSON.stringify(metadata.name)} descriptionLength=${metadata.description.length} elapsedMs=${Date.now() - startedAt}`,
    );
    return c.json(metadata);
  } catch (error) {
    console.warn(
      `[worker] metadata failed appId=${appId} elapsedMs=${Date.now() - startedAt}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return c.json({ error: "metadata_generation_failed" }, 502);
  } finally {
    cleanupDisposableWorkspace(workingDirectory, "__metadata__");
  }
});

// ---------------------------------------------------------------------------
// Async agent run — fire-and-forget execution with callback
// ---------------------------------------------------------------------------

app.post("/sessions/:appId/agent-run", async (c) => {
  const appId = c.req.param("appId");
  const body = await c.req.json<{
    runId: string;
    prompt: string;
    systemPrompt: string;
    runtimeId?: AgentRuntimeSettings["runtimeId"];
    runtimeModel?: string;
    runtimeParams?: Record<string, string>;
    agentConfig: AgentConfig;
    allowedTools: string[];
    workspaceId: string;
    appId: string;
    sourceVersion?: "draft" | "published";
    sourceFiles?: Record<string, string>;
    callbackUrl: string;
  }>();
  if (
    !body.runtimeId ||
    !body.runtimeModel ||
    !body.runtimeParams ||
    typeof body.runtimeParams !== "object" ||
    Array.isArray(body.runtimeParams)
  ) {
    return c.json({ error: "invalid_runtime_settings" }, 400);
  }

  let runtimeSettings: AgentRuntimeSettings;
  try {
    runtimeSettings = normalizeRuntimeSettings({
      runtimeId: body.runtimeId,
      model: body.runtimeModel,
      params: body.runtimeParams,
    });
  } catch {
    return c.json({ error: "invalid_runtime_settings" }, 400);
  }

  const workingDirectory = ensureWorkingDirectory(appId);
  scaffoldWorkspace(workingDirectory, body.sourceFiles ?? undefined);

  const runConfig: AgentRunConfig = {
    runId: body.runId,
    prompt: body.prompt,
    systemPrompt: body.systemPrompt,
    agentConfig: body.agentConfig,
    allowedTools: body.allowedTools,
    runtimeSettings,
    workspaceId: body.workspaceId,
    appId: body.appId,
    sourceVersion: body.sourceVersion ?? "published",
    sourceFiles: body.sourceFiles,
    callbackUrl: body.callbackUrl,
    internalApiToken: process.env.INTERNAL_API_TOKEN,
    workingDirectory,
  };

  agentRunManager.start(runConfig);

  return c.json({ status: "started", runId: body.runId });
});

app.get("/sessions/:appId/agent-run/:runId/events", async (c) => {
  const runId = c.req.param("runId");
  if (!agentRunManager.getStatus(runId)) {
    return c.json({ error: "run_not_found" }, 404);
  }

  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: Uint8Array) => {
        if (closed) return false;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      try {
        for await (const msg of agentRunManager.events(runId)) {
          if (!enqueue(encodeMessage(msg))) return;
        }
        enqueue(encodeDone());
      } catch (err) {
        if (closed || c.req.raw.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[worker] agent-run event stream failed runId=${runId}: ${message}`);
        enqueue(encodeError(message));
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            // The browser disconnected between the last enqueue and close.
          } finally {
            closed = true;
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
});

function runtimeBinary(envKey: string, fallback: string): string {
  return process.env[envKey]?.trim() || fallback;
}

function commonBinaryCandidates(binary: string): string[] {
  if (process.platform !== "darwin" || binary !== "claude") return [];
  return [
    join(homedir(), ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
}

function resolveBinaryPath(binary: string): string | null {
  if (binary.includes("/")) {
    try {
      accessSync(binary, constants.X_OK);
      return binary;
    } catch {
      return null;
    }
  }

  try {
    const resolved = execFileSync("which", [binary], {
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (resolved) return resolved;
  } catch {
    // Fall back to common installer paths below.
  }

  for (const candidate of commonBinaryCandidates(binary)) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function detectBinary(binary: string, versionArgs = ["--version"]) {
  const resolved = resolveBinaryPath(binary);
  const available = Boolean(resolved);
  let version: string | undefined;

  if (resolved) {
    try {
      version = execFileSync(resolved, versionArgs, {
        timeout: 3000,
        stdio: "pipe",
      })
        .toString()
        .trim();
    } catch {
      // Binary exists; version output is best-effort.
    }
  }

  return { available, ...(version ? { version } : {}) };
}

function binaryHelpIncludes(binary: string, args: string[], expected: string): boolean {
  const resolved = resolveBinaryPath(binary);
  if (!resolved) return false;

  try {
    return execFileSync(resolved, args, {
      timeout: 3000,
      stdio: "pipe",
    })
      .toString()
      .includes(expected);
  } catch {
    return false;
  }
}

function codexLocalAuthSeedingEnabled(): boolean {
  return (
    process.env.SECOND_ALLOW_CODEX_LOCAL_AUTH === "1" ||
    process.env.NODE_ENV !== "production"
  );
}

function codexCliAuthenticated(binary: string): boolean {
  if (process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY) return true;
  if (!codexLocalAuthSeedingEnabled()) return false;

  const resolved = resolveBinaryPath(binary);
  if (!resolved) return false;

  const status = spawnSync(resolved, ["login", "status"], {
    timeout: 3000,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (status.error || status.status !== 0) return false;

  const output = `${status.stdout ?? ""}\n${status.stderr ?? ""}`.toLowerCase();
  return output.includes("logged in") && !output.includes("not logged in");
}

function claudeEnvConfigured(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      (process.env.CLAUDE_CODE_USE_BEDROCK &&
        (process.env.AWS_BEARER_TOKEN_BEDROCK ||
          process.env.AWS_ACCESS_KEY_ID ||
          process.env.AWS_PROFILE)),
  );
}

app.get("/detect-provider", (c) => {
  const claudeCommand = runtimeBinary("SECOND_CLAUDE_PATH", "claude");
  const codexCommand = runtimeBinary("SECOND_CODEX_PATH", "codex");
  const opencodeCommand = runtimeBinary("SECOND_OPENCODE_PATH", "opencode");
  const claudeCli = detectBinary(claudeCommand);
  const codexCli = detectBinary(codexCommand);
  const opencodeCli = detectBinary(opencodeCommand);
  const claudeIsolation = claudeSubprocessIsolationStatus();
  const claudeAvailable = claudeCli.available && claudeIsolation.available;
  const codexAuthenticated = codexCli.available && codexCliAuthenticated(codexCommand);
  const opencodeJsonEvents =
    opencodeCli.available &&
    binaryHelpIncludes(opencodeCommand, ["run", "--help"], "--format");

  return c.json({
    runtimes: {
      "claude-code": {
        ...claudeCli,
        available: claudeAvailable,
        features: {
          subprocessEnvScrub: claudeIsolation.envScrubEnabled,
          linuxBubblewrapRequired: claudeIsolation.bubblewrapRequired,
          linuxBubblewrapAvailable: claudeIsolation.bubblewrapAvailable,
        },
        ...(!claudeAvailable && claudeCli.available && claudeIsolation.error
          ? { error: claudeIsolation.error }
          : {}),
        auth: {
          envKeyConfigured: claudeEnvConfigured(),
          cliLikelyConfigured: claudeCli.available,
        },
      },
      "codex-cli": {
        ...codexCli,
        available: codexCli.available && codexAuthenticated,
        auth: {
          envKeyConfigured: Boolean(process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY),
          cliLikelyConfigured: codexAuthenticated,
        },
      },
      opencode: {
        ...opencodeCli,
        available: opencodeCli.available && opencodeJsonEvents,
        features: { jsonEvents: opencodeJsonEvents },
        auth: {
          envKeyConfigured: Boolean(
            process.env.OPENAI_API_KEY ||
              process.env.ANTHROPIC_API_KEY ||
              (process.env.CLAUDE_CODE_USE_BEDROCK &&
                (process.env.AWS_BEARER_TOKEN_BEDROCK ||
                  process.env.AWS_ACCESS_KEY_ID ||
                  process.env.AWS_PROFILE)) ||
              process.env.GOOGLE_API_KEY ||
              process.env.GEMINI_API_KEY,
          ),
          cliLikelyConfigured: opencodeCli.available,
        },
      },
    },
    claudeCli,
    codexCli,
    opencodeCli,
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok", sessions: sessionManager.listAll() });
});

const port = parseInt(process.env.PORT ?? "3001", 10);
const hostname = process.env.WORKER_HOST || undefined;

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Worker listening on ${info.address}:${info.port}`);
});
