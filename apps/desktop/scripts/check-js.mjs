#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const files = [
  "src/main/main.js",
  "src/main/windows-wsl-runtime.js",
  "src/preload/preload.cjs",
  "src/renderer/startup.js",
  "scripts/build-wsl-rootfs.mjs",
  "scripts/notarize.mjs",
  "electron-builder.config.mjs",
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: desktopRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
