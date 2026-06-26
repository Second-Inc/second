import { spawnSync } from "node:child_process";

export type OpenCodeJsonSupportProbe =
  | {
      supported: true;
      definitive: true;
      message?: string;
    }
  | {
      supported: false;
      definitive: true;
      reason: "not_found" | "unsupported";
      message: string;
    }
  | {
      supported: false;
      definitive: false;
      reason: "probe_failed";
      message: string;
    };

const SUPPORT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_HELP_TIMEOUT_MS = 10_000;

let jsonSupportCache:
  | {
      command: string;
      expiresAt: number;
    }
  | null = null;

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function helpTimeoutMs(): number {
  const parsed = Number(process.env.SECOND_OPENCODE_HELP_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HELP_TIMEOUT_MS;
}

function spawnErrorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : null;
}

function cacheSupported(command: string): void {
  jsonSupportCache = {
    command,
    expiresAt: Date.now() + SUPPORT_CACHE_TTL_MS,
  };
}

export function clearOpenCodeJsonSupportCache(): void {
  jsonSupportCache = null;
}

export function detectOpenCodeRunJsonSupport(
  command: string,
): OpenCodeJsonSupportProbe {
  const now = Date.now();
  if (jsonSupportCache?.command === command && jsonSupportCache.expiresAt > now) {
    return { supported: true, definitive: true };
  }

  const result = spawnSync(command, ["run", "--help"], {
    timeout: helpTimeoutMs(),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = stripAnsi(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);

  if (output.includes("--format")) {
    cacheSupported(command);
    return { supported: true, definitive: true };
  }

  const errorCode = spawnErrorCode(result.error);
  if (errorCode === "ENOENT") {
    return {
      supported: false,
      definitive: true,
      reason: "not_found",
      message: "OpenCode CLI not found.",
    };
  }

  if (result.error) {
    const message =
      errorCode === "ETIMEDOUT"
        ? "Timed out while checking whether OpenCode supports JSON events."
        : `Could not check whether OpenCode supports JSON events: ${result.error.message}`;
    return {
      supported: false,
      definitive: false,
      reason: "probe_failed",
      message,
    };
  }

  return {
    supported: false,
    definitive: true,
    reason: "unsupported",
    message:
      "Installed OpenCode CLI does not support `opencode run --format json`. Upgrade OpenCode before using the OpenCode runtime.",
  };
}

