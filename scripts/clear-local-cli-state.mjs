#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const home = homedir();
const secondHome = join(home, ".second");
const runtimeStateFile = join(secondHome, "runtime.json");
const defaultPorts = [3030, 3000, 3001, 27018, 6380];

if (!process.argv.includes("--yes")) {
  console.error(
    "This clears local Second state, npm npx cache, generated CLI payloads, and known local service ports.",
  );
  console.error("Run with --yes to continue:");
  console.error("  node scripts/clear-local-cli-state.mjs --yes");
  process.exit(1);
}

const runtimeState = readRuntimeState();
const pids = collectRuntimePids(runtimeState);
const ports = collectRuntimePorts(runtimeState);

console.log("Clearing local Second CLI state...");

terminatePids(pids, "SIGTERM");
await delay(3000);
terminateAlivePids(pids, "SIGKILL");

for (const port of ports) {
  killPortListeners(port);
}

const pathsToRemove = [
  secondHome,
  join(home, ".npm", "_npx"),
  join(home, ".cache", "mongodb-binaries"),
  join(home, ".mongodb-binaries"),
  join(home, "Library", "Caches", "mongodb-binaries"),
  join(repoRoot, "packages", "cli", ".runtime-cache"),
  join(repoRoot, "packages", "cli", "dist"),
  join(repoRoot, "packages", "cli-local-darwin-arm64", "dist"),
  join(repoRoot, "packages", "cli-local-darwin-x64", "bin"),
  join(repoRoot, "packages", "cli-local-darwin-x64", "dist"),
  join(repoRoot, "packages", "cli-local-linux-x64", "bin"),
  join(repoRoot, "packages", "cli-local-linux-x64", "dist"),
];

for (const target of pathsToRemove) {
  removePath(target);
}

removeGlobbedTgz(join(repoRoot, "packages", "cli"));
removeGlobbedTgz(join(repoRoot, "packages", "cli-local-darwin-arm64"));
removeGlobbedTgz(join(repoRoot, "packages", "cli-local-darwin-x64"));
removeGlobbedTgz(join(repoRoot, "packages", "cli-local-linux-x64"));

console.log("Cleaning npm cache...");
const npmCache = spawnSync("npm", ["cache", "clean", "--force"], {
  stdio: "inherit",
});
if (npmCache.status !== 0) {
  console.error("npm cache clean failed.");
  process.exitCode = npmCache.status ?? 1;
}

console.log("Checking known local service ports...");
let anyListeners = false;
for (const port of ports) {
  const listeners = listeningPids(port);
  if (listeners.length > 0) {
    anyListeners = true;
    console.log(`Port ${port} still has listeners: ${listeners.join(", ")}`);
  }
}

if (!anyListeners) {
  console.log("No listeners remain on known Second local ports.");
}

console.log("Done. npm auth was not removed.");

function readRuntimeState() {
  try {
    if (!existsSync(runtimeStateFile)) return null;
    return JSON.parse(readFileSync(runtimeStateFile, "utf8"));
  } catch {
    return null;
  }
}

function collectRuntimePids(state) {
  const result = new Set();
  if (Number.isInteger(state?.supervisorPid)) result.add(state.supervisorPid);
  for (const proc of Object.values(state?.processes ?? {})) {
    if (Number.isInteger(proc?.pid)) result.add(proc.pid);
  }
  return [...result].filter((pid) => pid > 1 && pid !== process.pid);
}

function collectRuntimePorts(state) {
  const result = new Set(defaultPorts);
  for (const key of ["port", "mongoPort", "redisPort", "workerPort", "controlPort"]) {
    const value = state?.[key];
    if (Number.isInteger(value) && value > 0 && value < 65536) {
      result.add(value);
    }
  }
  return [...result].sort((a, b) => a - b);
}

function terminatePids(pidList, signal) {
  for (const pid of pidList) {
    try {
      process.kill(pid, signal);
      console.log(`${signal} ${pid}`);
    } catch {
      // Already stopped or not owned by this user.
    }
  }
}

function terminateAlivePids(pidList, signal) {
  for (const pid of pidList) {
    try {
      process.kill(pid, 0);
      process.kill(pid, signal);
      console.log(`${signal} ${pid}`);
    } catch {
      // Already stopped or not owned by this user.
    }
  }
}

function killPortListeners(port) {
  for (const pid of listeningPids(port)) {
    if (pid <= 1 || pid === process.pid) continue;
    try {
      process.kill(pid, "SIGKILL");
      console.log(`SIGKILL ${pid} on port ${port}`);
    } catch {
      // Already stopped or not owned by this user.
    }
  }
}

function listeningPids(port) {
  const result = spawnSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  if (result.status !== 0 && !result.stdout) return [];
  return result.stdout
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function removePath(target) {
  rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${target}`);
}

function removeGlobbedTgz(dir) {
  const result = spawnSync("find", [dir, "-maxdepth", "1", "-name", "*.tgz", "-delete"], {
    stdio: "ignore",
  });
  if (result.status === 0) {
    console.log(`Removed ${join(dir, "*.tgz")}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
