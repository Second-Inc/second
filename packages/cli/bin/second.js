#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch as osArch, platform as osPlatform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const PUBLIC_PACKAGE_NAME = "@second-inc/cli";
const FALLBACK_VERSION = "0.0.0-local";
const args = process.argv.slice(2);
const packageVersion = readPackageVersion();
const payload = resolvePayloadPackage();
const payloadPackageSpec =
  process.env.SECOND_CLI_PAYLOAD_PACKAGE?.trim() ||
  (payload ? `${payload.packageName}@${packageVersion}` : "");

const ANSI_ENABLED = process.env.NO_COLOR !== "1";
const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
};
const colors = createCliColors();
const FULLSCREEN_ENABLED =
  process.stdout.isTTY && process.env.SECOND_CLI_NO_FULLSCREEN !== "1";
let fullscreenActive = false;

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

if (!payload) {
  printUnsupportedPlatform();
  process.exit(1);
}

printLauncherBanner();

const spinner = createSpinner(`Installing ${payload.packageName}@${packageVersion}...`);
installResizeHandler(() => {
  if (!fullscreenActive) return;
  printLauncherBanner();
  spinner.redraw();
});
const payloadBinPath = await preparePayloadBinary();
spinner.stop("Payload ready. Switching to the local runtime...");
leaveFullscreen();

const child = spawn(payloadBinPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    SECOND_CLI_RELEASE_PACKAGE: PUBLIC_PACKAGE_NAME,
    SECOND_CLI_RELEASE_VERSION: packageVersion,
    SECOND_LAUNCHED_BY_CLI: "1",
    SECOND_CLI_FORCE_FULLSCREEN: FULLSCREEN_ENABLED ? "1" : "0",
    SECOND_CLI_COLUMNS: String(process.stdout.columns || process.env.COLUMNS || ""),
    SECOND_CLI_ROWS: String(process.stdout.rows || process.env.LINES || ""),
  },
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

process.on("SIGWINCH", () => {
  try {
    child.kill("SIGWINCH");
  } catch {
    // Child may already be gone.
  }
});

child.on("error", (err) => {
  leaveFullscreen();
  console.error("Could not start the Second local runtime.");
  console.error(`\n${err.message}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

function resolvePayloadPackage() {
  const runtimeId = currentRuntimeId();
  if (runtimeId === "darwin-arm64") {
    return {
      runtimeId,
      packageName: "@second-inc/cli-local-darwin-arm64",
      binName: "second-local",
    };
  }
  if (runtimeId === "linux-x64") {
    return {
      runtimeId,
      packageName: "@second-inc/cli-local-linux-x64",
      binName: "second-local",
    };
  }
  return null;
}

function currentRuntimeId() {
  const platform = osPlatform();
  const arch = osArch();
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "win32" && arch === "x64") return "win32-x64";
  return `${platform}-${arch}`;
}

function readPackageVersion() {
  try {
    const raw = readFileSync(join(__dirname, "..", "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed.version === "string" ? parsed.version : FALLBACK_VERSION;
  } catch {
    try {
      return require("../package.json").version ?? FALLBACK_VERSION;
    } catch {
      return FALLBACK_VERSION;
    }
  }
}

async function preparePayloadBinary() {
  const npmArgs = [
    "exec",
    "--yes",
    "--loglevel=error",
    "--package",
    payloadPackageSpec,
    "--",
    "node",
    "-e",
    payloadBinResolverScript(),
    payload.binName,
  ];

  const child = spawn("npm", npmArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  let code;
  try {
    code = await waitForExit(child);
  } catch (err) {
    spinner.fail("Could not start npm.");
    leaveFullscreen();
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
  if (code !== 0) {
    spinner.fail("Could not prepare the local app payload.");
    leaveFullscreen();
    const message = stderr.trim() || `npm exited with code ${code}`;
    console.error(`\n${message}\n`);
    process.exit(code ?? 1);
  }

  const binPath = stdout.trim().split(/\r?\n/).at(-1)?.trim();
  if (!binPath) {
    spinner.fail("Could not find the local runtime executable.");
    leaveFullscreen();
    console.error("\nThe payload installed, but npm did not expose second-local.\n");
    process.exit(1);
  }

  return binPath;
}

function payloadBinResolverScript() {
  return `
const fs = require("node:fs");
const path = require("node:path");
const binName = process.argv[1];
const suffixes = process.platform === "win32" ? [".cmd", ".exe", ".ps1", ""] : [""];
for (const dir of (process.env.PATH || "").split(path.delimiter)) {
  if (!dir) continue;
  for (const suffix of suffixes) {
    const candidate = path.join(dir, binName + suffix);
    if (fs.existsSync(candidate)) {
      process.stdout.write(candidate);
      process.exit(0);
    }
  }
}
console.error("Could not find " + binName + " in npm exec PATH.");
process.exit(1);
`;
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function color(code, text) {
  return ANSI_ENABLED ? `${code}${text}${ansi.reset}` : text;
}

function enterFullscreen() {
  if (!FULLSCREEN_ENABLED || fullscreenActive) return;
  fullscreenActive = true;
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[3J\x1b[H");
  process.once("exit", leaveFullscreen);
}

function leaveFullscreen() {
  if (!fullscreenActive) return;
  fullscreenActive = false;
  process.stdout.write("\x1b[?7h\x1b[?25h\x1b[?1049l");
}

function clearFullscreen() {
  if (!fullscreenActive) return;
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

function installResizeHandler(handler) {
  let scheduled = false;
  const onResize = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      handler();
    }, 25);
  };

  process.on("SIGWINCH", onResize);
  process.stdout.on?.("resize", onResize);
  process.stdin.on?.("resize", onResize);
}

function rgb(r, g, b) {
  return `\x1b[38;2;${r};${g};${b}m`;
}

function createCliColors() {
  if (!isLightTerminal()) {
    return {
      accent: rgb(91, 238, 178),
      blue: rgb(93, 137, 255),
      border: rgb(235, 228, 204),
      error: rgb(255, 107, 107),
      muted: rgb(142, 140, 128),
      strong: rgb(235, 228, 204),
    };
  }

  return {
    accent: rgb(16, 121, 91),
    blue: rgb(42, 87, 184),
    border: rgb(68, 64, 55),
    error: rgb(184, 45, 45),
    muted: rgb(91, 86, 76),
    strong: rgb(31, 29, 25),
  };
}

function isLightTerminal() {
  const explicit = process.env.SECOND_CLI_COLOR_MODE?.trim().toLowerCase();
  if (explicit === "light") return true;
  if (explicit === "dark") return false;
  if (process.env.SECOND_CLI_LIGHT_MODE === "1") return true;
  if (process.env.SECOND_CLI_DARK_MODE === "1") return false;

  const colorFgBg = process.env.COLORFGBG?.trim();
  if (!colorFgBg) return false;

  const bg = Number(colorFgBg.split(/[;:]/).at(-1));
  return Number.isInteger(bg) && bg >= 7 && bg <= 15;
}

function terminalWidth() {
  const columns =
    process.stdout.columns ||
    process.stdin.columns ||
    readPositiveInt(process.env.SECOND_CLI_COLUMNS) ||
    readPositiveInt(process.env.COLUMNS) ||
    108;
  return Math.max(20, Math.min(columns - 3, 118));
}

function readPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleLength(text) {
  return stripAnsi(text).length;
}

function fitLine(text, width) {
  if (visibleLength(text) <= width) {
    const pad = Math.max(0, width - visibleLength(text));
    return `${text}${" ".repeat(pad)}`;
  }

  const plain = stripAnsi(text);
  return `${plain.slice(0, Math.max(0, width - 3))}...`;
}

function center(text, width) {
  const pad = Math.max(0, width - visibleLength(text));
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return `${" ".repeat(left)}${text}${" ".repeat(right)}`;
}

function paintCanvasLine(content, width = terminalWidth()) {
  return fitLine(content, width);
}

function printCanvas(lines) {
  const width = terminalWidth();
  clearFullscreen();
  for (const line of fitFrameToTerminal(lines)) {
    console.log(`  ${paintCanvasLine(line, width)}`);
  }
}

function fitFrameToTerminal(lines) {
  const rows = process.stdout.rows || process.stdin.rows || 32;
  const maxLines = Math.max(1, rows - 1);
  return lines.slice(0, maxLines);
}

function printLauncherBanner() {
  enterFullscreen();
  printSplashScene({
    eyebrow: "local launcher",
    title: "Welcome to Second",
    subtitle: "A local workspace for agent-native internal software.",
    quote: "\"One command. Your team's software factory, on this machine.\"",
    rows: [
      ["version", `v${packageVersion}`],
      ["runtime", payload.runtimeId],
      ["payload", payload.packageName],
    ],
    footer:
      "First run fetches the platform payload. Later runs reuse npm's cache and jump straight to startup.",
  });
}

function printUnsupportedPlatform() {
  printSplashScene({
    eyebrow: "unsupported platform",
    title: "Second is not available here yet",
    subtitle: "The local installer currently ships for macOS Apple Silicon and Linux x64.",
    quote: "\"Detected a runtime we do not package yet.\"",
    rows: [
      ["detected", currentRuntimeId()],
      ["supported", "darwin-arm64, linux-x64"],
    ],
    tone: "error",
  });
}

function printSplashScene({
  eyebrow,
  title,
  subtitle,
  quote,
  rows,
  footer = "",
  tone = "default",
}) {
  const width = terminalWidth();
  const accent = tone === "error" ? colors.error : colors.accent;
  const muted = colors.muted;
  const strong = colors.strong;
  const blue = colors.blue;
  const lines = [
    "",
    color(accent, eyebrow),
    "",
    color(ansi.bold, color(strong, title)),
    color(muted, subtitle),
    "",
    color(muted, quote),
    "",
    ...rows.map(([name, value]) => {
      return `${color(muted, name.padEnd(9, " "))}${color(blue, value)}`;
    }),
    "",
    color(muted, footer),
    "",
  ];
  printCanvas(lines);
}

function buildSecondLogoArt({ width = 40, tone = "default" } = {}) {
  const ink = tone === "error" ? colors.error : colors.strong;
  const cols = Math.max(10, Math.floor(width / 2));
  const rows = 17;
  const out = [];

  for (let row = 0; row < rows; row++) {
    let line = "";
    for (let col = 0; col < cols; col++) {
      const x = ((col + 0.5) / cols) * 516;
      const y = ((row + 0.5) / rows) * 479;
      line += isInSecondLogo(x, y) ? "██" : "  ";
    }
    out.push(color(ink, line));
  }

  return out;
}

function isInSecondLogo(x, y) {
  return (
    inRoundedRect(x, y, 0, 0, 323.166, 478.632, 43) ||
    inRoundedRect(x, y, 230, 119, 187, 360, 34) ||
    inRoundedRect(x, y, 296, 273, 220, 206, 34)
  );
}

function inRoundedRect(x, y, rectX, rectY, width, height, radius) {
  if (x < rectX || x > rectX + width || y < rectY || y > rectY + height) {
    return false;
  }

  const cx = Math.max(rectX + radius, Math.min(x, rectX + width - radius));
  const cy = Math.max(rectY + radius, Math.min(y, rectY + height - radius));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function createSpinner(text) {
  const frames = ["◐", "◓", "◑", "◒"];
  let i = 0;
  let active = true;
  const startedAt = Date.now();

  const drawShell = () => {
    const width = terminalWidth();
    console.log(`  ${dockTop("payload install", width)}`);
  };

  const write = () => {
    const width = terminalWidth();
    const frame = color(colors.accent, frames[i++ % frames.length]);
    const shimmer = renderShimmer(i);
    const elapsed = color(ansi.dim, formatElapsed(startedAt));
    const content = `${frame} ${color(ansi.bold, text)} ${shimmer} ${elapsed}`;
    process.stdout.write(`\x1b[2K\r  ${dockLine(content, width)}`);
  };

  drawShell();
  const id = setInterval(() => {
    write();
  }, 90);
  write();

  return {
    stop(message) {
      if (!active) return;
      active = false;
      clearInterval(id);
      if (message) {
        const width = terminalWidth();
        const content = `${color(ansi.green, "OK")} ${message} ${color(ansi.dim, formatElapsed(startedAt))}`;
        process.stdout.write(
          `\x1b[2K\r  ${dockLine(content, width)}\n  ${dockBottom(width)}\n`,
        );
        return;
      }
      process.stdout.write(`\x1b[2K\r  ${dockBottom(terminalWidth())}\n`);
    },
    fail(message) {
      if (!active) return;
      active = false;
      clearInterval(id);
      const width = terminalWidth();
      const content = `${color(ansi.red, "ERROR")} ${message}`;
      process.stdout.write(`\x1b[2K\r  ${dockLine(content, width)}\n  ${dockBottom(width)}\n`);
    },
    redraw() {
      if (!active) return;
      drawShell();
      write();
    },
  };
}

function dockTop(title, width) {
  const safeTitle = fitLine(title, Math.max(1, width - 4)).trimEnd();
  const labelText = ` ${safeTitle} `;
  const fill = Math.max(0, width - visibleLength(labelText) - 2);
  const left = Math.floor(fill / 2);
  const right = fill - left;
  return color(colors.border, `╭${"─".repeat(left)}${labelText}${"─".repeat(right)}╮`);
}

function dockBottom(width) {
  return color(colors.border, `╰${"─".repeat(width - 2)}╯`);
}

function dockLine(content, width) {
  const inner = width - 4;
  return `${color(colors.border, "│")} ${fitLine(content, inner)} ${color(colors.border, "│")}`;
}

function renderShimmer(tick) {
  const width = 18;
  const active = tick % width;
  let out = "";
  for (let i = 0; i < width; i++) {
    out += i === active ? "━" : "─";
  }
  return color(ansi.dim, out);
}

function formatElapsed(startedAt) {
  const seconds = Math.max(0.1, (Date.now() - startedAt) / 1000);
  return `${seconds.toFixed(1)}s`;
}

function printUsage() {
  console.log(`
Usage: npx --yes @second-inc/cli [command] [options]
       npx --yes @second-inc/cli [command] [options]

Commands:
  run     Start Second locally
  start   Start Second locally (default)
  stop    Stop running local Second processes
  reset   Remove all local data

Options:
  --port <number>       Web port (default: 3030)
  --disable-telemetry   Disable product analytics
  --no-analytics        Alias for --disable-telemetry
  -h, --help            Show this help
`);
}
