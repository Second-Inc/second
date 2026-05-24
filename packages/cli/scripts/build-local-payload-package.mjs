#!/usr/bin/env node

import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");
const packagesRoot = join(cliRoot, "..");
const packageRoot = process.cwd();
const args = process.argv.slice(2);
const runtimeId = readFlag("--runtime-id");
const outDir = readFlag("--out") ?? "dist";

if (!runtimeId) {
  throw new Error("Missing required --runtime-id flag.");
}

mkdirSync(join(packageRoot, "bin"), { recursive: true });
const binTarget = join(packageRoot, "bin", "second-local.js");
copyFileSync(
  join(packagesRoot, "cli-local-darwin-arm64", "bin", "second-local.js"),
  binTarget,
);
chmodSync(binTarget, 0o755);

await run("node", [
  join(cliRoot, "scripts", "bundle-worker.mjs"),
  "--runtime-id",
  runtimeId,
  "--out",
  resolve(packageRoot, outDir),
]);

function readFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("-") ? value : undefined;
}

function run(cmd, commandArgs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cmd, commandArgs, {
      cwd: packageRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      reject(new Error(`${cmd} ${commandArgs.join(" ")} exited with code ${code}`));
    });
  });
}
