import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";

export type ClaudeSubprocessIsolationStatus = {
  envScrubEnabled: boolean;
  bubblewrapRequired: boolean;
  bubblewrapAvailable: boolean;
  bubblewrapPath?: string;
  available: boolean;
  error?: string;
};

export function claudeSubprocessEnvScrubValue(): "0" | "1" {
  return process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB?.trim() === "0"
    ? "0"
    : "1";
}

function executableExists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutable(binary: string): string | null {
  if (binary.includes("/")) return executableExists(binary) ? binary : null;

  try {
    const resolved = execFileSync("which", [binary], {
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (resolved && executableExists(resolved)) return resolved;
  } catch {
    // Missing from PATH.
  }

  return null;
}

export function claudeSubprocessIsolationStatus(): ClaudeSubprocessIsolationStatus {
  const envScrubEnabled = claudeSubprocessEnvScrubValue() !== "0";
  const bubblewrapRequired = process.platform === "linux" && envScrubEnabled;
  const bubblewrapPath = resolveExecutable("bwrap") ??
    resolveExecutable("bubblewrap") ??
    undefined;
  const bubblewrapAvailable = Boolean(bubblewrapPath);
  const available = !bubblewrapRequired || bubblewrapAvailable;

  return {
    envScrubEnabled,
    bubblewrapRequired,
    bubblewrapAvailable,
    ...(bubblewrapPath ? { bubblewrapPath } : {}),
    available,
    ...(!available
      ? {
        error:
          "Claude Code on Linux needs bubblewrap because subprocess environment scrubbing is enabled. Install the bubblewrap package in the worker image, or explicitly set CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0 only for an externally isolated worker.",
      }
      : {}),
  };
}
