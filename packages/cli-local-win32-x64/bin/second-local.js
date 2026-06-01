#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLI_PACKAGE_NAME = process.env.SECOND_CLI_RELEASE_PACKAGE || "@second-inc/cli";
const CLI_PACKAGE_VERSION =
  process.env.SECOND_CLI_RELEASE_VERSION || readPackageVersion();
const DEFAULT_DISTRO = "Ubuntu";
const DEFAULT_PORT = 3030;
const WSL_TIMEOUT_MS = 15 * 60_000;
const SETUP_TIMEOUT_MS = 20 * 60_000;
const ANSI_ENABLED = process.env.NO_COLOR !== "1";
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};
const args = process.argv.slice(2);

if (platform() !== "win32" || arch() !== "x64") {
  console.error("This payload only supports Windows x64.");
  process.exit(1);
}

try {
  await ensureWslAvailable();
  const distroName = await ensureLinuxDistro();
  await ensureLinuxNode(distroName);
  await runSecondInWsl(distroName);
} catch (err) {
  console.error(`\n${err.message}\n`);
  process.exit(1);
}

async function ensureWslAvailable() {
  const status = await runCommand("wsl.exe", ["--status"], {
    allowFailure: true,
    timeoutMs: WSL_TIMEOUT_MS,
  });
  if (status.code === 0) return;

  console.log("Second on Windows needs WSL2. Starting the Windows WSL installer...");
  const install = await runCommand(
    "wsl.exe",
    ["--install", "--no-distribution", "--web-download"],
    { allowFailure: true, timeoutMs: WSL_TIMEOUT_MS, inherit: true },
  );
  if (install.code === 0) {
    printRestartRequired();
    process.exit(0);
  }

  await runElevatedWslInstall();
  printRestartRequired();
  process.exit(0);
}

async function runElevatedWslInstall() {
  const command = [
    "Start-Process",
    "-FilePath",
    "wsl.exe",
    "-ArgumentList",
    "'--install --no-distribution --web-download'",
    "-Verb",
    "RunAs",
    "-Wait",
  ].join(" ");
  const result = await runCommand(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { allowFailure: true, timeoutMs: WSL_TIMEOUT_MS, inherit: true },
  );
  if (result.code !== 0) {
    throw new Error(
      `Could not install WSL automatically. Open PowerShell as Administrator, run \`wsl --install --no-distribution --web-download\`, restart if asked, then run \`${rerunCommand()}\` again.`,
    );
  }
}

async function ensureLinuxDistro() {
  await runCommand("wsl.exe", ["--set-default-version", "2"], {
    allowFailure: true,
    timeoutMs: WSL_TIMEOUT_MS,
  });

  const requested = process.env.SECOND_WINDOWS_WSL_DISTRO?.trim();
  if (requested) {
    await ensureDistroVersion2(requested);
    return requested;
  }

  let distros = await listDistros();
  if (!distros.includes(DEFAULT_DISTRO)) {
    console.log(`Installing ${DEFAULT_DISTRO} for Second...`);
    const install = await runCommand(
      "wsl.exe",
      ["--install", "-d", DEFAULT_DISTRO, "--no-launch", "--web-download"],
      { allowFailure: true, timeoutMs: WSL_TIMEOUT_MS, inherit: true },
    );
    if (install.code !== 0) {
      throw new Error(
        `Could not install ${DEFAULT_DISTRO}. Open PowerShell as Administrator, run \`wsl --install -d ${DEFAULT_DISTRO} --no-launch --web-download\`, then rerun Second.`,
      );
    }
    distros = await listDistros();
  }

  const distroName = distros.includes(DEFAULT_DISTRO) ? DEFAULT_DISTRO : distros[0];
  if (!distroName) {
    throw new Error(
      `WSL is installed but no Linux distro is available. Run \`wsl --install -d ${DEFAULT_DISTRO} --no-launch --web-download\`, then rerun Second.`,
    );
  }
  await ensureDistroVersion2(distroName);
  return distroName;
}

async function listDistros() {
  const result = await runCommand("wsl.exe", ["-l", "-q"], {
    timeoutMs: WSL_TIMEOUT_MS,
  });
  return decodeWslOutput(result.stdout)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\0/g, ""))
    .filter(Boolean);
}

async function ensureDistroVersion2(distroName) {
  const verbose = await runCommand("wsl.exe", ["-l", "-v"], {
    allowFailure: true,
    timeoutMs: WSL_TIMEOUT_MS,
  });
  if (verbose.code !== 0) return;

  const line = decodeWslOutput(verbose.stdout)
    .split(/\r?\n/)
    .find((entry) => entry.replace(/^\*\s*/, "").trim().startsWith(distroName));
  if (!line || /\s2\s*$/.test(line.trim())) return;

  console.log(`Converting ${distroName} to WSL2...`);
  await runCommand("wsl.exe", ["--set-version", distroName, "2"], {
    timeoutMs: WSL_TIMEOUT_MS,
    inherit: true,
  });
}

async function ensureLinuxNode(distroName) {
  const script = `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl xz-utils
  test "$(uname -m)" = "x86_64"
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT
  cd "$tmp_dir"
  base_url="https://nodejs.org/dist/latest-v24.x"
  curl -fsSLO "$base_url/SHASUMS256.txt"
  node_file="$(awk '/linux-x64.tar.xz$/ {print $2; exit}' SHASUMS256.txt)"
  test -n "$node_file"
  curl -fsSLO "$base_url/$node_file"
  grep " $node_file$" SHASUMS256.txt | sha256sum -c -
  rm -rf /opt/second/node
  mkdir -p /opt/second/node
  tar -xJf "$node_file" -C /opt/second/node --strip-components=1
  ln -sf /opt/second/node/bin/node /usr/local/bin/node
  ln -sf /opt/second/node/bin/npm /usr/local/bin/npm
  ln -sf /opt/second/node/bin/npx /usr/local/bin/npx
fi
`;
  console.log(`Preparing ${distroName} for Second...`);
  await runCommand(
    "wsl.exe",
    ["-d", distroName, "--user", "root", "--exec", "bash", "-lc", script],
    {
      timeoutMs: SETUP_TIMEOUT_MS,
      inherit: true,
    },
  );
}

async function runSecondInWsl(distroName) {
  const port = readPort(args);
  const shouldOpen = isStartCommand(args) && !args.includes("--no-open");
  const linuxArgs = shouldOpen ? [...args, "--no-open"] : args;
  const packageSpec = `${CLI_PACKAGE_NAME}@${CLI_PACKAGE_VERSION}`;
  const childArgs = [
    "-d",
    distroName,
    "--user",
    "root",
    "--exec",
    "env",
    "SECOND_LOCAL_NO_OPEN=1",
    "npx",
    "--yes",
    packageSpec,
    ...linuxArgs,
  ];

  if (shouldOpen) openWhenReady(port);

  const child = spawn("wsl.exe", childArgs, {
    stdio: "inherit",
    windowsHide: true,
  });

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      child.kill(signal);
      void runCommand(
        "wsl.exe",
        ["-d", distroName, "--user", "root", "--exec", "npx", "--yes", packageSpec, "stop"],
        { allowFailure: true, timeoutMs: 60_000 },
      ).finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
    });
  }

  const code = await waitForExit(child);
  process.exit(code);
}

function openWhenReady(port) {
  const publicUrl = `http://localhost:${port}`;
  const started = Date.now();
  const timer = setInterval(async () => {
    if (Date.now() - started > 180_000) {
      clearInterval(timer);
      return;
    }
    try {
      const response = await fetch(`${publicUrl}/api/health`);
      if (!response.ok) return;
      clearInterval(timer);
      spawn("cmd.exe", ["/c", "start", "", publicUrl], {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      }).unref();
    } catch {
      // Still starting.
    }
  }, 1000);
  timer.unref();
}

function isStartCommand(argv) {
  const command = argv.find((arg) => !arg.startsWith("-")) ?? "start";
  return command === "start" || command === "run";
}

function readPort(argv) {
  const index = argv.indexOf("--port");
  if (index === -1) return DEFAULT_PORT;
  const port = Number(argv[index + 1]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
}

function printRestartRequired() {
  const command = rerunCommand();
  const lines = [
    "RESTART WINDOWS",
    "",
    "Second installed the Windows Linux runtime.",
    "Windows says a restart is required before it can run.",
    "",
    "1. Restart this PC now.",
    "2. Open PowerShell again.",
    `3. Run: ${command}`,
  ];
  const width = Math.max(...lines.map((line) => line.length), 24);
  const border = `+${"-".repeat(width + 2)}+`;
  console.log("");
  console.log(color(ANSI.red, border));
  for (const line of lines) {
    const padded = line.padEnd(width, " ");
    const output = line === "RESTART WINDOWS"
      ? color(ANSI.bold + ANSI.red, padded)
      : line.includes(command)
        ? padded.replace(command, color(ANSI.bold + ANSI.cyan, command))
        : padded;
    console.log(`${color(ANSI.red, "|")} ${output} ${color(ANSI.red, "|")}`);
  }
  console.log(color(ANSI.red, border));
  console.log("");
}

function rerunCommand() {
  return "npx --yes @second-inc/cli";
}

function color(code, text) {
  return ANSI_ENABLED ? `${code}${text}${ANSI.reset}` : text;
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill();
    }, options.timeoutMs ?? WSL_TIMEOUT_MS);

    if (!options.inherit) {
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
    }
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const result = {
        code: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (result.code === 0 || options.allowFailure) {
        resolveRun(result);
        return;
      }
      reject(
        new Error(
          decodeWslOutput(result.stderr).trim() ||
            decodeWslOutput(result.stdout).trim() ||
            `${command} exited with ${result.code}`,
        ),
      );
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("error", (err) => {
      console.error(err.message);
      resolve(1);
    });
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function decodeWslOutput(buffer) {
  if (!buffer) return "";
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\0")) return utf8;
  return buffer.toString("utf16le").replace(/\0/g, "");
}

function readPackageVersion() {
  try {
    const raw = readFileSync(join(__dirname, "..", "package.json"), "utf8");
    return JSON.parse(raw).version || "0.0.0-local";
  } catch {
    return "0.0.0-local";
  }
}
