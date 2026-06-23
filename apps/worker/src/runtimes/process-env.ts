import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntimeId } from "./types.js";

const BASE_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
] as const;

export const RUNTIME_FORBIDDEN_ENV_KEYS = [
  "INTERNAL_API_TOKEN",
  "MONGODB_URI",
  "REDIS_URL",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "TOOL_EXECUTE_URL",
  "WEB_URL",
  "WORKER_URL",
  "SECOND_INTERNAL_TOKEN",
  "COOKIE",
  "AUTHORIZATION",
] as const;

export type RuntimeProcessEnvOptions = {
  runtimeId: AgentRuntimeId;
  authEnvKeys?: string[];
  extraEnv?: Record<string, string | undefined>;
};

export function createPrivateRuntimeDir(
  runtimeId: AgentRuntimeId,
  runId: string,
): string {
  const root = join(tmpdir(), "second-runtime", runtimeId);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(root, `${runId}-`));
}

export function createStableRuntimeDir(
  runtimeId: AgentRuntimeId,
  sessionKey: string,
): string {
  const root = join(tmpdir(), "second-runtime", runtimeId);
  const safeKey = sessionKey.replace(/[^a-zA-Z0-9_.-]/g, "-");
  const dir = join(root, safeKey);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function buildRuntimeProcessEnv(
  options: RuntimeProcessEnvOptions,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of BASE_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }

  for (const key of options.authEnvKeys ?? []) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }

  for (const [key, value] of Object.entries(options.extraEnv ?? {})) {
    if (typeof value === "string") env[key] = value;
  }

  for (const key of RUNTIME_FORBIDDEN_ENV_KEYS) {
    delete env[key];
  }

  return env;
}

export function openCodeAuthEnvKeysForModel(model: string): string[] {
  const provider = model.split("/")[0]?.toLowerCase();
  if (provider === "openai") return ["OPENAI_API_KEY"];
  if (provider === "anthropic") return ["ANTHROPIC_API_KEY"];
  if (provider === "google" || provider === "gemini") {
    return ["GOOGLE_API_KEY", "GEMINI_API_KEY"];
  }
  return [];
}

export function openCodeAuthEnvConfiguredForModel(model: string): boolean {
  return openCodeAuthEnvKeysForModel(model).some((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.length > 0;
  });
}

function openCodeLocalAuthSeedingEnabled(): boolean {
  return (
    process.env.SECOND_ALLOW_OPENCODE_LOCAL_AUTH === "1" ||
    process.env.NODE_ENV !== "production"
  );
}

function openCodeLocalAuthSourcePath(): string {
  const explicitAuthFile = process.env.SECOND_OPENCODE_AUTH_FILE?.trim();
  if (explicitAuthFile) return explicitAuthFile;

  const dataHome =
    process.env.SECOND_OPENCODE_DATA_HOME?.trim() ||
    process.env.XDG_DATA_HOME?.trim() ||
    join(homedir(), ".local", "share");

  return join(dataHome, "opencode", "auth.json");
}

function openCodeConfigSourcePaths(): string[] {
  const paths: string[] = [];
  const explicitConfig = process.env.SECOND_OPENCODE_CONFIG_FILE?.trim() ||
    process.env.OPENCODE_CONFIG?.trim();
  if (explicitConfig) paths.push(explicitConfig);

  const configHome =
    process.env.SECOND_OPENCODE_CONFIG_HOME?.trim() ||
    process.env.XDG_CONFIG_HOME?.trim() ||
    join(homedir(), ".config");
  paths.push(
    join(configHome, "opencode", "opencode.json"),
    join(configHome, "opencode", "opencode.jsonc"),
  );

  return [...new Set(paths)];
}

function stripJsonComments(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    const next = value[index + 1] ?? "";

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (!inString && char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (!inString && char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += char;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
    }
  }

  return output.replace(/,\s*([}\]])/g, "$1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeRecords(
  base: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(next)) {
    const current = merged[key];
    merged[key] = isRecord(current) && isRecord(value)
      ? mergeRecords(current, value)
      : value;
  }
  return merged;
}

export function readOpenCodeProviderConfig(): Record<string, unknown> {
  let provider: Record<string, unknown> = {};

  for (const path of openCodeConfigSourcePaths()) {
    if (!existsSync(path)) continue;

    try {
      const parsed = JSON.parse(stripJsonComments(readFileSync(path, "utf-8")));
      if (isRecord(parsed) && isRecord(parsed.provider)) {
        provider = mergeRecords(provider, parsed.provider);
      }
    } catch {
      // User OpenCode config parsing is best-effort. OpenCode itself will still
      // report configuration errors when run directly.
    }
  }

  return Object.keys(provider).length > 0 ? { provider } : {};
}

export function openCodeLocalAuthAvailable(): boolean {
  return openCodeLocalAuthSeedingEnabled() && existsSync(openCodeLocalAuthSourcePath());
}

export function seedOpenCodeAuthFromLocalLogin(runtimeDir: string): void {
  if (!openCodeLocalAuthSeedingEnabled()) return;

  const sourcePath = openCodeLocalAuthSourcePath();
  if (!existsSync(sourcePath)) return;

  const targetDir = join(runtimeDir, ".local", "share", "opencode");
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const targetPath = join(targetDir, "auth.json");
  if (sourcePath === targetPath) return;
  copyFileSync(sourcePath, targetPath);
  chmodSync(targetPath, 0o600);
}

export function writePrivateJsonFile(
  dir: string,
  filename: string,
  value: unknown,
): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, filename);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  return path;
}

export function writePrivateTextFile(
  dir: string,
  filename: string,
  value: string,
): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, filename);
  writeFileSync(path, value, { encoding: "utf-8", mode: 0o600 });
  return path;
}

function codexLocalAuthSeedingEnabled(): boolean {
  return (
    process.env.SECOND_ALLOW_CODEX_LOCAL_AUTH === "1" ||
    process.env.NODE_ENV !== "production"
  );
}

export function seedCodexAuthFromLocalLogin(runtimeDir: string): void {
  if (process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY) return;
  if (!codexLocalAuthSeedingEnabled()) return;

  const sharedCodexHome =
    process.env.SECOND_CODEX_HOME?.trim() ||
    process.env.CODEX_HOME?.trim() ||
    join(homedir(), ".codex");
  const sourcePath = join(sharedCodexHome, "auth.json");
  if (!existsSync(sourcePath)) return;

  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const targetPath = join(runtimeDir, "auth.json");
  if (sourcePath === targetPath) return;
  copyFileSync(sourcePath, targetPath);
  chmodSync(targetPath, 0o600);
}

export function createScopedToken(): string {
  return randomBytes(32).toString("base64url");
}
