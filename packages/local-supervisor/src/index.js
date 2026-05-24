import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { arch as osArch, homedir, platform as osPlatform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 3030;
const DEFAULT_STARTUP_TIMEOUT_MS = 180_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const SECRET_PATTERNS = [
  /SECOND_LOCAL_CLI_TOKEN=[^\s]+/gi,
  /SECOND_NO_AUTH_SESSION_SECRET=[^\s]+/gi,
  /INTERNAL_API_TOKEN=[^\s]+/gi,
  /mongodb:\/\/[^\s"']+/gi,
  /redis:\/\/[^\s"']+/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

export class SecondLocalSupervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.runtimeId = options.runtimeId ?? currentRuntimeId();
    this.port = normalizePort(options.port ?? DEFAULT_PORT);
    this.entrypoint = options.entrypoint ?? null;
    this.nodePath = options.nodePath ?? process.execPath;
    this.nodeEnv = { ...(options.nodeEnv ?? {}) };
    this.env = { ...(options.env ?? {}) };
    this.cwd = options.cwd;
    this.startupTimeoutMs =
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.commandTimeoutMs =
      options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.child = null;
    this.ready = null;
  }

  async start(options = {}) {
    if (this.child && !this.child.killed) {
      return this.status();
    }

    const port = normalizePort(options.port ?? this.port);
    this.port = port;
    const existing = await this.findExistingReadyRuntime({
      timeoutMs: 2500,
    });
    if (existing) {
      this.ready = existing;
      this.emitProgress("ready", "ready", "Second is already running");
      return existing;
    }

    const entrypoint = this.resolveEntrypoint(options.entrypoint);
    const env = this.createChildEnv({
      SECOND_DESKTOP: "1",
      SECOND_LOCAL_NO_OPEN: "1",
      SECOND_NODE_PATH: options.nodePath ?? this.nodePath,
      ...(options.env ?? {}),
    });
    const args = [entrypoint, "start", "--port", String(port), "--no-open"];

    this.emitProgress("starting", "runtime", "Starting local Second runtime");
    const child = spawn(options.nodePath ?? this.nodePath, args, {
      cwd: this.cwd ?? dirname(entrypoint),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    child.stdout.on("data", (chunk) => {
      this.handleOutput(chunk.toString(), "stdout");
    });
    child.stderr.on("data", (chunk) => {
      this.handleOutput(chunk.toString(), "stderr");
    });

    const exitEarly = new Promise((_, reject) => {
      child.once("error", reject);
      child.once("exit", async (code, signal) => {
        if (!this.ready) {
          if (code === 0 && !signal) {
            try {
              this.ready = await this.findExistingReadyRuntime({
                timeoutMs: 5000,
              });
              if (this.ready) {
                this.emitProgress("ready", "ready", "Second is already running");
                return;
              }
            } catch {
              // Fall through to the normal early-exit error.
            }
          }
          reject(
            new Error(
              signal
                ? `Second local runtime exited with signal ${signal}`
                : `Second local runtime exited with code ${code ?? 1}`,
            ),
          );
        }
      });
    });

    const ready = waitForRuntimeReady({
      port,
      timeoutMs: options.startupTimeoutMs ?? this.startupTimeoutMs,
      onProgress: (message) => {
        this.emitProgress("starting", "health", message);
      },
    });

    this.ready = await Promise.race([ready, exitEarly]);
    this.emitProgress("ready", "ready", "Second is ready");
    return this.ready;
  }

  async stop() {
    const entrypoint = this.resolveEntrypoint();
    this.emitProgress("stopping", "shutdown", "Stopping local Second runtime");
    await this.runEntrypoint(entrypoint, ["stop"]);
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.child = null;
    this.ready = null;
    this.emitProgress("stopped", "shutdown", "Second stopped");
  }

  async reset() {
    const entrypoint = this.resolveEntrypoint();
    this.emitProgress("resetting", "reset", "Resetting local Second data");
    await this.runEntrypoint(entrypoint, ["reset", "--yes"]);
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.child = null;
    this.ready = null;
    this.emitProgress("stopped", "reset", "Second local data reset");
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  async findExistingReadyRuntime({ timeoutMs }) {
    const state = readRuntimeState();
    const statePort = Number.isInteger(state?.port) ? state.port : this.port;
    if (!statePort) return null;
    try {
      return await waitForRuntimeReady({
        port: statePort,
        timeoutMs,
      });
    } catch {
      return null;
    }
  }

  status() {
    const state = readRuntimeState();
    const port = Number.isInteger(state?.port) ? state.port : this.port;
    return {
      running: Boolean(state?.supervisorPid),
      runtimeId: this.runtimeId,
      port,
      publicUrl: port ? `http://localhost:${port}` : null,
      logsDir: logsDir(),
      state,
    };
  }

  logs() {
    return { logsDir: logsDir() };
  }

  diagnostics() {
    const status = this.status();
    return redactObject({
      runtimeId: this.runtimeId,
      platform: osPlatform(),
      arch: osArch(),
      nodePath: this.nodePath,
      entrypoint: this.entrypoint,
      status,
    });
  }

  resolveEntrypoint(override) {
    const entrypoint =
      override ??
      this.entrypoint ??
      resolveSupervisorEntrypoint({ runtimeId: this.runtimeId });
    if (!entrypoint || !existsSync(entrypoint)) {
      throw new Error(
        `Could not find the Second local runtime entrypoint for ${this.runtimeId}.`,
      );
    }
    this.entrypoint = entrypoint;
    return entrypoint;
  }

  runEntrypoint(entrypoint, args) {
    return runCommand(this.nodePath, [entrypoint, ...args], {
      cwd: this.cwd ?? dirname(entrypoint),
      env: this.createChildEnv({
        SECOND_DESKTOP: "1",
        SECOND_LOCAL_NO_OPEN: "1",
        SECOND_NODE_PATH: this.nodePath,
      }),
      timeoutMs: this.commandTimeoutMs,
      onOutput: (chunk, stream) => this.handleOutput(chunk, stream),
    });
  }

  createChildEnv(extra = {}) {
    return {
      ...process.env,
      ...this.nodeEnv,
      ...this.env,
      ...extra,
    };
  }

  handleOutput(raw, stream) {
    const text = redactText(raw);
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.emit("log", { stream, line });
      const event = classifySupervisorLine(line);
      if (event) this.emit("progress", event);
    }
  }

  emitProgress(status, step, message) {
    this.emit("progress", {
      status,
      step,
      message,
      at: new Date().toISOString(),
    });
  }
}

export function createSecondLocalSupervisor(options = {}) {
  return new SecondLocalSupervisor(options);
}

export function currentRuntimeId() {
  const platform = osPlatform();
  const arch = osArch();
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "win32" && arch === "x64") return "win32-x64";
  return `${platform}-${arch}`;
}

export function resolveSupervisorEntrypoint({
  runtimeId = currentRuntimeId(),
  resourcesPath = process.resourcesPath,
  repoRoot = findRepoRoot(),
} = {}) {
  const configured = process.env.SECOND_DESKTOP_PAYLOAD_ENTRY?.trim();
  const candidates = [
    configured,
    resourcesPath
      ? join(resourcesPath, "payloads", runtimeId, "bin", "second-local.js")
      : null,
    repoRoot
      ? join(repoRoot, "packages", `cli-local-${runtimeId}`, "bin", "second-local.js")
      : null,
    repoRoot
      ? join(
          repoRoot,
          "packages",
          "cli-local-darwin-arm64",
          "bin",
          "second-local.js",
        )
      : null,
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function secondHome() {
  return join(homedir(), ".second");
}

export function logsDir() {
  return join(secondHome(), "logs");
}

export function readRuntimeState() {
  return readJson(join(secondHome(), "runtime.json"));
}

export function readLocalControlState() {
  return readJson(join(secondHome(), "local-control.json"));
}

export async function waitForRuntimeReady({
  port = DEFAULT_PORT,
  timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  onProgress,
} = {}) {
  const publicUrl = `http://localhost:${port}`;
  const deadline = Date.now() + timeoutMs;
  let lastProgressAt = 0;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${publicUrl}/api/health`);
      if (response.ok) {
        return { port, publicUrl, logsDir: logsDir(), state: readRuntimeState() };
      }
    } catch {
      // The web server is still starting.
    }

    const now = Date.now();
    if (now - lastProgressAt > 5000) {
      lastProgressAt = now;
      onProgress?.(`Waiting for Second at ${publicUrl}`);
    }
    await delay(1000);
  }

  throw new Error(`Second did not become ready at ${publicUrl}.`);
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function runCommand(command, args, { cwd, env, timeoutMs, onOutput } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 1000).unref();
    }, timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onOutput?.(text, "stdout");
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onOutput?.(text, "stderr");
    });
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolveRun({ stdout: redactText(stdout), stderr: redactText(stderr) });
        return;
      }
      reject(
        new Error(
          redactText(stderr.trim() || stdout.trim() || `${command} exited with ${code}`),
        ),
      );
    });
  });
}

function classifySupervisorLine(line) {
  const message = stripAnsi(line).trim();
  if (!message) return null;

  const step = (() => {
    if (/mongo|redis|replica/i.test(message)) return "data";
    if (/runtime|packaged/i.test(message)) return "runtime";
    if (/web server|Second web|health/i.test(message)) return "web";
    if (/worker|agent/i.test(message)) return "agents";
    if (/ready|running locally|health check passed/i.test(message)) return "ready";
    if (/stop|shutdown/i.test(message)) return "shutdown";
    if (/reset/i.test(message)) return "reset";
    return "runtime";
  })();

  const status = /failed|error|could not/i.test(message)
    ? "error"
    : /ready|started|passed|complete|running locally/i.test(message)
      ? "ready"
      : "starting";

  return {
    status,
    step,
    message,
    at: new Date().toISOString(),
  };
}

function readJson(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function findRepoRoot() {
  let current = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  for (let n = 0; n < 8; n += 1) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "apps"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function redactObject(value) {
  return JSON.parse(redactText(JSON.stringify(value, null, 2)));
}

function redactText(text) {
  let output = String(text ?? "");
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, "[redacted]");
  }
  return output;
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
