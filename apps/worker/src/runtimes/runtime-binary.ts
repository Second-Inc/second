import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, extname, join } from "node:path";

const LOGIN_PATH_START = "__SECOND_RUNTIME_PATH_START__";
const LOGIN_PATH_END = "__SECOND_RUNTIME_PATH_END__";

let cachedRuntimeSearchPath: string | null = null;

export function runtimeBinary(envKey: string, fallback: string): string {
  const configured = process.env[envKey]?.trim();
  const command = configured || fallback;
  return resolveRuntimeBinary(command) ?? command;
}

export function runtimeBinaryEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    HOME: env.HOME || homedir(),
    PATH: runtimeSearchPath(),
  };
}

export function runtimeSearchPath(): string {
  if (cachedRuntimeSearchPath) return cachedRuntimeSearchPath;

  cachedRuntimeSearchPath = uniquePathEntries([
    process.env.PATH,
    loginShellPath(),
    commonRuntimePathEntries().join(delimiter),
  ]).join(delimiter);

  return cachedRuntimeSearchPath;
}

export function resolveRuntimeBinary(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  if (trimmed.includes("/") || (process.platform === "win32" && trimmed.includes("\\"))) {
    return executablePath(trimmed) ? trimmed : null;
  }

  for (const dir of runtimeSearchPath().split(delimiter)) {
    if (!dir) continue;
    for (const name of executableNames(trimmed)) {
      const candidate = join(dir, name);
      if (executablePath(candidate)) return candidate;
    }
  }

  return null;
}

function loginShellPath(): string | null {
  if (process.platform === "win32") return null;

  const shells = [
    process.env.SHELL,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
  ]
    .filter((shell): shell is string => Boolean(shell))
    .filter((shell, index, all) => all.indexOf(shell) === index && existsSync(shell));

  for (const shell of shells) {
    const args = shell.endsWith("/sh")
      ? ["-lc", loginPathCommand()]
      : ["-ilc", loginPathCommand()];

    try {
      const output = execFileSync(shell, args, {
        encoding: "utf-8",
        env: process.env,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      });
      const match = output.match(
        new RegExp(`${LOGIN_PATH_START}([\\s\\S]*?)${LOGIN_PATH_END}`),
      );
      const shellPath = match?.[1]?.trim();
      if (shellPath) return shellPath;
    } catch {
      // Try the next shell.
    }
  }

  return null;
}

function loginPathCommand(): string {
  return `printf "\\n${LOGIN_PATH_START}%s${LOGIN_PATH_END}\\n" "$PATH"`;
}

function commonRuntimePathEntries(): string[] {
  const entries = [
    join(homedir(), ".local", "bin"),
    join(homedir(), ".npm-global", "bin"),
    join(homedir(), ".volta", "bin"),
    join(homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];

  const nvmVersionsDir = join(homedir(), ".nvm", "versions", "node");
  try {
    const versions = readdirSync(nvmVersionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareNodeVersionsDesc);

    for (const version of versions) {
      entries.push(join(nvmVersionsDir, version, "bin"));
    }
  } catch {
    // nvm is optional.
  }

  return entries;
}

function executableNames(command: string): string[] {
  if (process.platform !== "win32" || extname(command)) return [command];
  const extensions = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean);
  return [
    command,
    ...extensions.map((extension) => `${command}${extension.toLowerCase()}`),
    ...extensions.map((extension) => `${command}${extension.toUpperCase()}`),
  ];
}

function executablePath(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function uniquePathEntries(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const entries: string[] = [];

  for (const value of values) {
    for (const entry of value?.split(delimiter) ?? []) {
      const trimmed = entry.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      entries.push(trimmed);
    }
  }

  return entries;
}

function compareNodeVersionsDesc(a: string, b: string): number {
  const aParts = parseNodeVersion(a);
  const bParts = parseNodeVersion(b);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const diff = (bParts[i] ?? 0) - (aParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

function parseNodeVersion(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}
