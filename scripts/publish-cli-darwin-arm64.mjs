#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bumpScript = resolve(repoRoot, "scripts/bump-cli-version.mjs");
const payloadDirs = [
  resolve(repoRoot, "packages/cli-local-darwin-arm64"),
  resolve(repoRoot, "packages/cli-local-darwin-x64"),
  resolve(repoRoot, "packages/cli-local-linux-x64"),
  resolve(repoRoot, "packages/cli-local-win32-x64"),
];
const cliDir = resolve(repoRoot, "packages/cli");
const cliPackagePath = resolve(cliDir, "package.json");

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage(0);
}

if (options.bump !== false) {
  run("node", [bumpScript, options.version], { cwd: repoRoot });
}

const cliPackage = readJson(cliPackagePath);
const payloadPackages = payloadDirs.map((dir) => ({
  dir,
  pkg: readJson(resolve(dir, "package.json")),
}));

for (const { pkg } of payloadPackages) {
  if (pkg.version !== cliPackage.version) {
    throw new Error(
      `CLI package versions do not match: ${cliPackage.name}@${cliPackage.version} and ${pkg.name}@${pkg.version}.`,
    );
  }
}

console.log("");
console.log(`Publishing local CLI release ${cliPackage.version}`);
for (const { pkg } of payloadPackages) {
  console.log(`  payload:  ${pkg.name}`);
}
console.log(`  launcher: ${cliPackage.name}`);
console.log(`  access:   ${options.access}`);
console.log(`  tag:      ${options.tag}`);
console.log("");

for (const payloadDir of payloadDirs) {
  publishPackage(payloadDir, options);
}
publishPackage(cliDir, options);

console.log("");
console.log(`Published ${cliPackage.name}@${cliPackage.version}`);

function publishPackage(cwd, publishOptions) {
  const pkg = readJson(resolve(cwd, "package.json"));
  const args = [
    "publish",
    "--access",
    publishOptions.access,
    "--tag",
    publishOptions.tag,
  ];
  if (publishOptions.dryRun) args.push("--dry-run");

  console.log(`\n> ${pkg.name}@${pkg.version}`);
  run("npm", args, { cwd });
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function parseArgs(args) {
  const parsed = {
    version: "patch",
    access: "restricted",
    tag: "latest",
    dryRun: false,
    bump: true,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--no-bump") {
      parsed.bump = false;
      continue;
    }
    if (arg === "--access") {
      parsed.access = readFlagValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--access=")) {
      parsed.access = arg.slice("--access=".length);
      continue;
    }
    if (arg === "--tag") {
      parsed.tag = readFlagValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--tag=")) {
      parsed.tag = arg.slice("--tag=".length);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}".`);
    }
    parsed.version = arg;
  }

  if (parsed.access !== "restricted" && parsed.access !== "public") {
    throw new Error('Access must be "restricted" or "public".');
  }

  if (!parsed.tag.trim()) {
    throw new Error("Tag cannot be empty.");
  }

  return parsed;
}

function readFlagValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function printUsage(exitCode) {
  console.log("Usage:");
  console.log("  npm run publish:cli:darwin-arm64");
  console.log("  npm run publish:cli:darwin-arm64 -- <version|patch|minor|major>");
  console.log("");
  console.log("Defaults:");
  console.log("  version: patch");
  console.log("  access:  restricted");
  console.log("  tag:     latest");
  console.log("");
  console.log("Examples:");
  console.log("  npm run publish:cli:darwin-arm64");
  console.log("  npm run publish:cli:darwin-arm64 -- 0.1.12");
  console.log("  npm run publish:cli:darwin-arm64 -- patch --dry-run");
  console.log("  npm run publish:cli:darwin-arm64 -- --no-bump");
  process.exit(exitCode);
}
