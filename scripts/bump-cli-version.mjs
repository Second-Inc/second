#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPackagePath = resolve(repoRoot, "packages/cli/package.json");
const cliLockPath = resolve(repoRoot, "packages/cli/package-lock.json");
const localPayloadPackagePath = resolve(
  repoRoot,
  "packages/cli-local-darwin-arm64/package.json",
);
const intelMacPayloadPackagePath = resolve(
  repoRoot,
  "packages/cli-local-darwin-x64/package.json",
);
const linuxPayloadPackagePath = resolve(
  repoRoot,
  "packages/cli-local-linux-x64/package.json",
);

const versionArg = process.argv[2]?.trim();

if (!versionArg || versionArg === "--help" || versionArg === "-h") {
  printUsage(versionArg ? 0 : 1);
}

const cliPackage = readJson(cliPackagePath);
const nextVersion = resolveNextVersion(versionArg, cliPackage.version);

updatePackageJson(cliPackagePath, nextVersion);
updateCliLockfile(cliLockPath, nextVersion);
updatePackageJson(localPayloadPackagePath, nextVersion);
updatePackageJson(intelMacPayloadPackagePath, nextVersion);
updatePackageJson(linuxPayloadPackagePath, nextVersion);

console.log(`CLI release version bumped to ${nextVersion}`);
console.log("");
console.log("Updated:");
console.log("  packages/cli/package.json");
console.log("  packages/cli/package-lock.json");
console.log("  packages/cli-local-darwin-arm64/package.json");
console.log("  packages/cli-local-darwin-x64/package.json");
console.log("  packages/cli-local-linux-x64/package.json");

function printUsage(exitCode) {
  console.log("Usage:");
  console.log("  npm run bump:cli -- <version|patch|minor|major>");
  console.log("");
  console.log("Examples:");
  console.log("  npm run bump:cli -- 0.1.7");
  console.log("  npm run bump:cli -- patch");
  process.exit(exitCode);
}

function resolveNextVersion(input, currentVersion) {
  if (input === "patch" || input === "minor" || input === "major") {
    return bumpVersion(input, currentVersion);
  }

  if (!isValidVersion(input)) {
    throw new Error(
      `Invalid version "${input}". Use x.y.z, patch, minor, or major.`,
    );
  }

  return input;
}

function bumpVersion(kind, currentVersion) {
  if (!isValidVersion(currentVersion)) {
    throw new Error(
      `Current CLI version "${currentVersion}" is not a plain semver version.`,
    );
  }

  const [major, minor, patch] = currentVersion
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function updatePackageJson(path, nextVersion) {
  const json = readJson(path);
  json.version = nextVersion;
  writeJson(path, json);
}

function updateCliLockfile(path, nextVersion) {
  const json = readJson(path);
  json.version = nextVersion;
  if (!json.packages || !json.packages[""]) {
    throw new Error("packages/cli/package-lock.json is missing packages[\"\"].");
  }
  json.packages[""].version = nextVersion;
  writeJson(path, json);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isValidVersion(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
    value,
  );
}
