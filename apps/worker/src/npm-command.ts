import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type NpmCommand = {
  command: string;
  env: NodeJS.ProcessEnv;
};

let cachedNpmCommand: NpmCommand | null = null;

export function resolveNpmCommand(): NpmCommand {
  if (cachedNpmCommand) return cachedNpmCommand;

  const candidates = [
    fromExplicitPath(process.env.SECOND_NPM_PATH),
    fromExplicitPath(process.env.npm_execpath),
    fromCurrentPath(),
    fromLoginShell(),
    fromNvmInstall(),
  ];

  cachedNpmCommand =
    candidates.find((candidate): candidate is NpmCommand => Boolean(candidate)) ??
    {
      command: "npm",
      env: process.env,
    };
  return cachedNpmCommand;
}

function fromExplicitPath(rawPath: string | undefined): NpmCommand | null {
  const npmPath = rawPath?.trim();
  if (!npmPath || !existsSync(npmPath)) return null;
  const env = withPrependedPath(dirname(npmPath), process.env);
  return commandWorks(npmPath, env) ? { command: npmPath, env } : null;
}

function fromCurrentPath(): NpmCommand | null {
  return commandWorks("npm", process.env)
    ? { command: "npm", env: process.env }
    : null;
}

function fromLoginShell(): NpmCommand | null {
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
      ? ["-lc", 'printf "%s\\n%s" "$(command -v npm)" "$PATH"']
      : ["-ilc", 'printf "%s\\n%s" "$(command -v npm)" "$PATH"'];

    try {
      const output = execFileSync(shell, args, {
        encoding: "utf-8",
        env: process.env,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      });
      const [npmPath, shellPath] = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!npmPath || !existsSync(npmPath)) continue;

      const env = {
        ...process.env,
        PATH: shellPath || withPrependedPath(dirname(npmPath), process.env).PATH,
      };
      if (commandWorks(npmPath, env)) return { command: npmPath, env };
    } catch {
      // Try the next shell.
    }
  }

  return null;
}

function fromNvmInstall(): NpmCommand | null {
  const nvmVersionsDir = join(homedir(), ".nvm", "versions", "node");
  if (!existsSync(nvmVersionsDir)) return null;

  let versions: string[] = [];
  try {
    versions = readdirSync(nvmVersionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareNodeVersionsDesc);
  } catch {
    return null;
  }

  for (const version of versions) {
    const npmPath = join(nvmVersionsDir, version, "bin", "npm");
    if (!existsSync(npmPath)) continue;
    const env = withPrependedPath(dirname(npmPath), process.env);
    if (commandWorks(npmPath, env)) return { command: npmPath, env };
  }

  return null;
}

function commandWorks(command: string, env: NodeJS.ProcessEnv): boolean {
  try {
    execFileSync(command, ["--version"], {
      encoding: "utf-8",
      env,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function withPrependedPath(binDir: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: [binDir, env.PATH].filter(Boolean).join(":"),
  };
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
