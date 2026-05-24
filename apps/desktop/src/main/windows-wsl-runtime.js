import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { waitForRuntimeReady } from "@second-inc/local-supervisor";

const DEFAULT_DISTRIBUTION_NAME = "Second";
const DEFAULT_PORT = 3030;
const WSL_COMMAND_TIMEOUT_MS = 120_000;
const WSL_IMPORT_TIMEOUT_MS = 15 * 60_000;

export class ManagedWslSecondRuntime extends EventEmitter {
  constructor(options = {}) {
    super();
    this.distroName = options.distroName ?? DEFAULT_DISTRIBUTION_NAME;
    this.port = options.port ?? DEFAULT_PORT;
    this.userDataPath = options.userDataPath;
    this.rootfsPath = options.rootfsPath;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 240_000;
    this.child = null;
    this.ready = null;
  }

  async start(options = {}) {
    this.port = options.port ?? this.port;
    this.emitProgress("starting", "wsl", "Checking Windows runtime");
    await this.assertWslAvailable();
    await this.ensureDistroImported();

    this.emitProgress("starting", "runtime", "Starting Second inside managed WSL2");
    const child = spawn(
      "wsl.exe",
      [
        "-d",
        this.distroName,
        "--exec",
        "/usr/local/bin/second-local",
        "start",
        "--port",
        String(this.port),
        "--no-open",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.child = child;

    child.stdout.on("data", (chunk) => this.handleOutput(chunk.toString(), "stdout"));
    child.stderr.on("data", (chunk) => this.handleOutput(chunk.toString(), "stderr"));

    const exitEarly = new Promise((_, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (!this.ready) {
          reject(
            new Error(
              signal
                ? `Managed WSL runtime exited with signal ${signal}`
                : `Managed WSL runtime exited with code ${code ?? 1}`,
            ),
          );
        }
      });
    });

    const ready = waitForRuntimeReady({
      port: this.port,
      timeoutMs: this.startupTimeoutMs,
      onProgress: (message) => this.emitProgress("starting", "health", message),
    });

    this.ready = await Promise.race([ready, exitEarly]);
    this.emitProgress("ready", "ready", "Second is ready");
    return this.ready;
  }

  async stop() {
    await this.runInDistro(["/usr/local/bin/second-local", "stop"], {
      allowFailure: true,
    });
    if (this.child && !this.child.killed) this.child.kill("SIGTERM");
    this.child = null;
    this.ready = null;
    this.emitProgress("stopped", "shutdown", "Second stopped");
  }

  async reset() {
    await this.runInDistro(["/usr/local/bin/second-local", "reset", "--yes"], {
      allowFailure: true,
    });
    if (this.child && !this.child.killed) this.child.kill("SIGTERM");
    this.child = null;
    this.ready = null;
    this.emitProgress("stopped", "reset", "Second local data reset");
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  status() {
    return {
      running: Boolean(this.ready),
      runtimeId: "managed-wsl2-linux-x64",
      distroName: this.distroName,
      port: this.port,
      publicUrl: `http://localhost:${this.port}`,
      logsDir: this.logs().logsDir,
    };
  }

  logs() {
    return {
      logsDir: `\\\\wsl$\\${this.distroName}\\root\\.second\\logs`,
    };
  }

  diagnostics() {
    return {
      platform: "win32",
      runtimeId: "managed-wsl2-linux-x64",
      distroName: this.distroName,
      port: this.port,
      rootfsPresent: Boolean(this.rootfsPath && existsSync(this.rootfsPath)),
      status: this.status(),
    };
  }

  async assertWslAvailable() {
    try {
      await runCommand("wsl.exe", ["--status"], {
        timeoutMs: WSL_COMMAND_TIMEOUT_MS,
      });
    } catch (err) {
      const wrapped = new Error(
        [
          "WSL2 is required for Second on Windows.",
          "Windows must enable the built-in Linux runtime before Second can start.",
          "If this computer is managed by an organization, IT may need to allow WSL2 and virtualization.",
        ].join(" "),
      );
      wrapped.code = "SECOND_WSL_UNAVAILABLE";
      wrapped.cause = err;
      throw wrapped;
    }
  }

  async ensureDistroImported() {
    const distros = await this.listDistros();
    if (distros.includes(this.distroName)) {
      this.emitProgress("ready", "wsl", "Managed WSL runtime is installed");
      return;
    }

    if (!this.rootfsPath || !existsSync(this.rootfsPath)) {
      const err = new Error(
        `The managed WSL rootfs is missing at ${this.rootfsPath}. Rebuild the Windows installer.`,
      );
      err.code = "SECOND_WSL_ROOTFS_MISSING";
      throw err;
    }

    const installDir = join(this.userDataPath, "wsl", this.distroName);
    mkdirSync(installDir, { recursive: true });
    this.emitProgress("starting", "wsl", "Installing managed WSL runtime");
    await runCommand(
      "wsl.exe",
      [
        "--import",
        this.distroName,
        installDir,
        this.rootfsPath,
        "--version",
        "2",
      ],
      {
        timeoutMs: WSL_IMPORT_TIMEOUT_MS,
      },
    );
    this.emitProgress("ready", "wsl", "Managed WSL runtime installed");
  }

  async listDistros() {
    const result = await runCommand("wsl.exe", ["-l", "-q"], {
      timeoutMs: WSL_COMMAND_TIMEOUT_MS,
    });
    return decodeWslOutput(result.stdout)
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\0/g, ""))
      .filter(Boolean);
  }

  runInDistro(args, { allowFailure = false } = {}) {
    return runCommand("wsl.exe", ["-d", this.distroName, "--exec", ...args], {
      timeoutMs: WSL_COMMAND_TIMEOUT_MS,
    }).catch((err) => {
      if (allowFailure) return null;
      throw err;
    });
  }

  handleOutput(raw, stream) {
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.emit("log", { stream, line });
      this.emitProgress("starting", classifyWslLine(line), line.trim());
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

function runCommand(command, args, { timeoutMs }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
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
      const result = {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (code === 0) {
        resolveRun(result);
        return;
      }
      reject(
        new Error(
          decodeWslOutput(result.stderr).trim() ||
            decodeWslOutput(result.stdout).trim() ||
            `${command} exited with ${code}`,
        ),
      );
    });
  });
}

function decodeWslOutput(buffer) {
  if (!buffer) return "";
  if (Buffer.isBuffer(buffer)) {
    const utf8 = buffer.toString("utf8");
    if (!utf8.includes("\0")) return utf8;
    return buffer.toString("utf16le");
  }
  return String(buffer);
}

function classifyWslLine(line) {
  if (/mongo|redis/i.test(line)) return "data";
  if (/web|health/i.test(line)) return "web";
  if (/worker|agent/i.test(line)) return "agents";
  if (/ready|running locally/i.test(line)) return "ready";
  if (/stop|shutdown/i.test(line)) return "shutdown";
  return "runtime";
}
