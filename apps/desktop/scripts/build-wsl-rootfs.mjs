#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const args = process.argv.slice(2);
const payloadDir = resolve(
  readFlag("--payload-dir") ??
    join(repoRoot, "packages", "cli-local-linux-x64"),
);
const outFile = resolve(
  readFlag("--out") ??
    join(desktopRoot, "resources", "wsl", "second-wsl-rootfs.tar"),
);

if (!existsSync(join(payloadDir, "bin", "second-local.js"))) {
  throw new Error(
    `Missing Linux payload at ${payloadDir}. Build packages/cli-local-linux-x64 first.`,
  );
}

const tmpRoot = mkdtempSync(join(tmpdir(), "second-wsl-rootfs-"));
const contextDir = join(tmpRoot, "context");
const payloadTarget = join(contextDir, "payload");
mkdirSync(payloadTarget, { recursive: true });

try {
  cpSync(payloadDir, payloadTarget, {
    recursive: true,
    filter: (source) => !source.includes("/node_modules/") && !source.endsWith(".tgz"),
  });
  writeFileSync(
    join(contextDir, "Dockerfile"),
    [
      "FROM node:24-bookworm-slim",
      "ENV DEBIAN_FRONTEND=noninteractive",
      "RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates bubblewrap procps curl && rm -rf /var/lib/apt/lists/*",
      "COPY payload /opt/second/cli-local-linux-x64",
      "RUN chmod +x /opt/second/cli-local-linux-x64/bin/second-local.js && ln -sf /opt/second/cli-local-linux-x64/bin/second-local.js /usr/local/bin/second-local",
      "WORKDIR /root",
      'CMD ["/bin/bash"]',
      "",
    ].join("\n"),
  );

  const imageTag = `second-wsl-rootfs:${Date.now()}`;
  await run("docker", ["build", "-t", imageTag, contextDir]);
  const containerId = (
    await run("docker", ["create", imageTag], { capture: true })
  ).stdout.trim();
  mkdirSync(dirname(outFile), { recursive: true });
  try {
    await run("docker", ["export", "-o", outFile, containerId]);
  } finally {
    await run("docker", ["rm", containerId], { allowFailure: true });
    await run("docker", ["rmi", imageTag], { allowFailure: true });
  }
  console.log(`Managed WSL rootfs written to ${outFile}`);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

function readFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith("-") ? value : null;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || options.allowFailure) {
        resolveRun({ stdout, stderr, code });
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}
