#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch as hostArch, platform as hostPlatform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const MONGODB_BINARY_VERSION = "8.2.6";
const REDIS_FORMULA_NAME = "redis@8.2";
const REDIS_FORMULA_API_URL =
  "https://formulae.brew.sh/api/formula/redis@8.2.json";
const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");

const args = process.argv.slice(2);
const runtimeId = flag("--runtime-id") ?? currentRuntimeId();
const packageRootMode = args.includes("--package-root");
const outRoot = resolve(flag("--out") ?? join(cliRoot, "dist", "runtime"));
const runtimeDir = packageRootMode ? outRoot : join(outRoot, runtimeId);
const binDir = join(runtimeDir, "bin");
const buildCacheRoot = join(cliRoot, ".runtime-cache", runtimeId);

const runtime = parseRuntimeId(runtimeId);
if (!runtime) {
  throw new Error(
    `Unsupported runtime id "${runtimeId}". Expected darwin-arm64, darwin-x64, linux-arm64, linux-x64, or win32-x64.`,
  );
}

if (runtime.platform === "win32") {
  throw new Error(
    "The local runtime package does not support Windows yet. Add a Redis-compatible Windows runtime before publishing win32 builds.",
  );
}

rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });

console.log(`Preparing packaged local runtime for ${runtimeId}...`);

const mongod = await prepareMongoBinary();
const redisServer = await prepareRedisBinary();

const manifest = {
  runtimeId,
  mongodb: {
    version: MONGODB_BINARY_VERSION,
    bin: `bin/${basename(mongod)}`,
  },
  redis: {
    formula: REDIS_FORMULA_NAME,
    version: redisServer.version,
    bottle: redisServer.bottleKey,
    bin: `bin/${basename(redisServer.path)}`,
  },
};

writeFileSync(
  join(runtimeDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

rmSync(join(runtimeDir, ".cache"), { recursive: true, force: true });

if (runtimeId === currentRuntimeId()) {
  await runWithOutput(mongod, ["--version"], { timeoutMs: 5000 });
  await runWithOutput(redisServer.path, ["--version"], { timeoutMs: 5000 });
}

console.log(`Runtime bundled -> ${shortPath(runtimeDir)}`);

function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function currentRuntimeId() {
  const platform = hostPlatform();
  const arch = hostArch();
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "win32" && arch === "x64") return "win32-x64";
  return `${platform}-${arch}`;
}

function parseRuntimeId(id) {
  const [platform, arch] = id.split("-");
  if (!platform || !arch) return null;
  if (!["darwin", "linux", "win32"].includes(platform)) return null;
  if (!["arm64", "x64"].includes(arch)) return null;
  return { platform, arch };
}

async function prepareMongoBinary() {
  console.log(`MongoDB ${MONGODB_BINARY_VERSION}: preparing package binary...`);
  const mongoMemory = await import("mongodb-memory-server-core");
  const MongoBinary = mongoMemory.MongoBinary ?? mongoMemory.default?.MongoBinary;
  if (!MongoBinary) {
    throw new Error("mongodb-memory-server-core did not expose MongoBinary.");
  }

  const cacheDir = join(buildCacheRoot, "mongodb");
  mkdirSync(cacheDir, { recursive: true });
  const source = await MongoBinary.getPath({
    version: MONGODB_BINARY_VERSION,
    downloadDir: cacheDir,
    platform: runtime.platform,
    arch: runtime.arch,
  });

  const target = join(binDir, runtime.platform === "win32" ? "mongod.exe" : "mongod");
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  console.log(`MongoDB ${MONGODB_BINARY_VERSION}: packaged`);
  return target;
}

async function prepareRedisBinary() {
  console.log("Redis: fetching package metadata...");
  const formula = await fetchJson(REDIS_FORMULA_API_URL);
  const version = formula?.versions?.stable;
  const files = formula?.bottle?.stable?.files;
  if (!version || !files || typeof files !== "object") {
    throw new Error("Homebrew Redis formula metadata did not include bottles.");
  }

  const bottleKey = await selectBottleKey(files, runtime);
  const bottle = files[bottleKey];
  if (!bottle?.url || !bottle?.sha256) {
    throw new Error(`Homebrew Redis formula has no bottle for ${bottleKey}.`);
  }

  const cacheDir = join(runtimeDir, ".cache", "redis");
  const extractDir = join(cacheDir, REDIS_FORMULA_NAME);
  const archivePath = join(cacheDir, `${REDIS_FORMULA_NAME}-${version}.tar.gz`);
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });

  await downloadHomebrewBottle(bottle.url, archivePath, bottle.sha256, {
    label: `Redis ${version}`,
  });
  console.log(`Redis ${version}: extracting bottle...`);
  await runWithOutput("tar", ["-xzf", archivePath, "-C", extractDir], {
    timeoutMs: 120_000,
  });

  const redisSource = findFile(extractDir, "redis-server");
  if (!redisSource) {
    throw new Error("Downloaded Redis bottle did not contain redis-server.");
  }

  const redisTarget = join(binDir, "redis-server");
  copyFileSync(redisSource, redisTarget);
  chmodSync(redisTarget, 0o755);

  if (runtime.platform === "darwin") {
    await bundleDarwinRedisLibraries({ redisServer: redisTarget, bottleKey });
  }

  console.log(`Redis ${version}: packaged`);
  return { path: redisTarget, version, bottleKey };
}

async function bundleDarwinRedisLibraries({ redisServer, bottleKey }) {
  const refs = await dylibRefs(redisServer);
  const opensslRefs = refs
    .map((ref) =>
      ref.match(
        /^@@HOMEBREW_PREFIX@@\/opt\/(openssl@\d+)\/lib\/(lib(?:ssl|crypto)\.\d+\.dylib)$/,
      ),
    )
    .filter(Boolean);
  if (opensslRefs.length === 0) return;

  const formulaName = opensslRefs[0][1];
  const sslRef = opensslRefs.find((match) => match[2].startsWith("libssl."));
  const cryptoRef = opensslRefs.find((match) =>
    match[2].startsWith("libcrypto."),
  );
  if (!sslRef || !cryptoRef) {
    throw new Error("Redis bottle did not expose expected OpenSSL references.");
  }

  const sslName = sslRef[2];
  const cryptoName = cryptoRef[2];
  console.log(`Redis: bundling ${formulaName} libraries...`);
  const opensslDir = await prepareHomebrewFormulaBottle({
    formulaName,
    bottleKey,
  });
  const sslDylib = findFile(opensslDir, sslName);
  const cryptoDylib = findFile(opensslDir, cryptoName);
  if (!sslDylib || !cryptoDylib) {
    throw new Error("Managed OpenSSL bottle did not contain expected dylibs.");
  }

  const bundledSslDylib = join(binDir, sslName);
  const bundledCryptoDylib = join(binDir, cryptoName);
  copyFileSync(sslDylib, bundledSslDylib);
  copyFileSync(cryptoDylib, bundledCryptoDylib);
  chmodSync(bundledSslDylib, 0o755);
  chmodSync(bundledCryptoDylib, 0o755);

  await changeDylibReference({
    binary: redisServer,
    from: sslRef[0],
    to: `@loader_path/${sslName}`,
  });
  await changeDylibReference({
    binary: redisServer,
    from: cryptoRef[0],
    to: `@loader_path/${cryptoName}`,
  });
  await changeDylibReference({
    binary: bundledSslDylib,
    from: `@@HOMEBREW_PREFIX@@/opt/${formulaName}/lib/${cryptoName}`,
    to: `@loader_path/${cryptoName}`,
  });
  await changeMatchingDylibReferences({
    binary: bundledSslDylib,
    match: (ref) => ref.endsWith(`/${cryptoName}`),
    to: `@loader_path/${cryptoName}`,
  });
  await setDylibId({
    binary: bundledSslDylib,
    id: `@loader_path/${sslName}`,
  });
  await setDylibId({
    binary: bundledCryptoDylib,
    id: `@loader_path/${cryptoName}`,
  });
  await adHocSign(redisServer);
  await adHocSign(bundledSslDylib);
  await adHocSign(bundledCryptoDylib);
}

async function prepareHomebrewFormulaBottle({ formulaName, bottleKey }) {
  console.log(`${formulaName}: fetching package metadata...`);
  const formula = await fetchJson(homebrewFormulaUrl(formulaName));
  const version = formula?.versions?.stable;
  const files = formula?.bottle?.stable?.files;
  if (!version || !files || typeof files !== "object") {
    throw new Error(`${formulaName} formula metadata did not include bottles.`);
  }

  const selectedBottleKey = files[bottleKey]
    ? bottleKey
    : await selectBottleKey(files, runtime);
  const bottle = files[selectedBottleKey];
  if (!bottle?.url || !bottle?.sha256) {
    throw new Error(`${formulaName} has no bottle for ${selectedBottleKey}.`);
  }

  const formulaDirName = formulaName.replace(/[^a-zA-Z0-9_.@-]/g, "_");
  const cacheDir = join(runtimeDir, ".cache", formulaDirName);
  const extractDir = join(cacheDir, "extract");
  const archivePath = join(cacheDir, `${formulaDirName}-${version}.tar.gz`);
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });

  await downloadHomebrewBottle(bottle.url, archivePath, bottle.sha256, {
    label: `${formulaName} ${version}`,
  });
  console.log(`${formulaName} ${version}: extracting bottle...`);
  await runWithOutput("tar", ["-xzf", archivePath, "-C", extractDir], {
    timeoutMs: 120_000,
  });
  return extractDir;
}

async function selectBottleKey(files, targetRuntime) {
  const keys = Object.keys(files);

  if (targetRuntime.platform === "darwin") {
    const codename = await macosCodename();
    const exact =
      targetRuntime.arch === "arm64" ? `arm64_${codename}` : codename;
    if (files[exact]) return exact;

    const prefix = targetRuntime.arch === "arm64" ? "arm64_" : "";
    const fallback = keys.find(
      (key) =>
        key.startsWith(prefix) &&
        !key.includes("linux") &&
        (targetRuntime.arch === "arm64" || !key.startsWith("arm64_")),
    );
    if (fallback) return fallback;
  }

  if (targetRuntime.platform === "linux") {
    const key = targetRuntime.arch === "arm64" ? "arm64_linux" : "x86_64_linux";
    if (files[key]) return key;
  }

  throw new Error(
    `No Homebrew bottle is available for ${targetRuntime.platform}/${targetRuntime.arch}.`,
  );
}

async function macosCodename() {
  if (runtime.platform !== "darwin") return "sonoma";
  try {
    const { stdout } = await runWithOutput("sw_vers", ["-productVersion"], {
      timeoutMs: 3000,
    });
    const major = Number(stdout.trim().split(".")[0]);
    if (major >= 26) return "tahoe";
    if (major === 15) return "sequoia";
    if (major === 14) return "sonoma";
    if (major === 13) return "ventura";
  } catch {
    // Fall through to a recent bottle.
  }
  return "sonoma";
}

function homebrewFormulaUrl(formulaName) {
  return `https://formulae.brew.sh/api/formula/${encodeURIComponent(
    formulaName,
  )}.json`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

async function downloadHomebrewBottle(
  url,
  destination,
  expectedSha256,
  { label },
) {
  const response = await fetchHomebrewBlob(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${label}: HTTP ${response.status}`);
  }

  const totalBytes = Number(response.headers.get("content-length"));
  let downloadedBytes = 0;
  let lastProgressAt = 0;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      downloadedBytes += chunk.length;
      const now = Date.now();
      if (now - lastProgressAt >= 1000) {
        lastProgressAt = now;
        console.log(
          `${label}: downloading ${formatBytes(downloadedBytes)}${
            Number.isFinite(totalBytes) && totalBytes > 0
              ? ` / ${formatBytes(totalBytes)}`
              : ""
          }...`,
        );
      }
      callback(null, chunk);
    },
  });

  await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(destination));
  console.log(`${label}: download complete (${formatBytes(downloadedBytes)})`);

  const actualSha256 = await sha256File(destination);
  if (actualSha256 !== expectedSha256) {
    rmSync(destination, { force: true });
    throw new Error(`Downloaded ${label} checksum did not match.`);
  }
}

async function fetchHomebrewBlob(url) {
  let response = await fetch(url, { redirect: "manual" });
  if (response.status === 401) {
    const auth = parseWwwAuthenticate(response.headers.get("www-authenticate"));
    if (!auth.realm || !auth.service || !auth.scope) {
      throw new Error("Homebrew registry did not provide a usable auth challenge.");
    }
    const tokenUrl = `${auth.realm}?service=${encodeURIComponent(
      auth.service,
    )}&scope=${encodeURIComponent(auth.scope)}`;
    const tokenResponse = await fetch(tokenUrl, {
      headers: { Accept: "application/json" },
    });
    if (!tokenResponse.ok) {
      throw new Error(
        `Failed to get Homebrew registry token: HTTP ${tokenResponse.status}`,
      );
    }
    const tokenJson = await tokenResponse.json();
    if (!tokenJson.token) {
      throw new Error("Homebrew registry token response did not include a token.");
    }
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenJson.token}` },
      redirect: "follow",
    });
  } else if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Homebrew registry redirect had no location.");
    response = await fetch(location);
  }
  return response;
}

function parseWwwAuthenticate(header) {
  const entries = {};
  for (const match of String(header ?? "").matchAll(
    /(realm|service|scope)="([^"]+)"/g,
  )) {
    entries[match[1]] = match[2];
  }
  return entries;
}

async function dylibRefs(binary) {
  try {
    const { stdout } = await runWithOutput("otool", ["-L", binary], {
      timeoutMs: 5000,
    });
    return stdout
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(" ")[0])
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function changeDylibReference({ binary, from, to }) {
  const refs = await dylibRefs(binary);
  if (!refs.includes(from)) return;
  await runWithOutput("install_name_tool", ["-change", from, to, binary], {
    timeoutMs: 5000,
  });
}

async function changeMatchingDylibReferences({ binary, match, to }) {
  const refs = await dylibRefs(binary);
  for (const ref of refs) {
    if (!match(ref) || ref === to) continue;
    await runWithOutput("install_name_tool", ["-change", ref, to, binary], {
      timeoutMs: 5000,
    });
  }
}

async function setDylibId({ binary, id }) {
  await runWithOutput("install_name_tool", ["-id", id, binary], {
    timeoutMs: 5000,
  });
}

async function adHocSign(binary) {
  await runWithOutput("codesign", ["--force", "--sign", "-", binary], {
    timeoutMs: 10_000,
  });
}


function findFile(root, name) {
  if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (
        (entry.isFile() || entry.isSymbolicLink()) &&
        entry.name === name
      ) {
        return fullPath;
      }
    }
  }
  return null;
}

function sha256File(filePath) {
  return new Promise((resolveSha, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveSha(hash.digest("hex")));
  });
}

function runWithOutput(cmd, commandArgs, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolveRun, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      const err = new Error(`Command timed out: ${cmd}`);
      err.timedOut = true;
      reject(err);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `${cmd} failed`));
    });
  });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units.at(-1)) {
      return `${Math.round(value * 10) / 10} ${unit}`;
    }
    value /= 1024;
  }
  return `${Math.round(value * 10) / 10} GB`;
}

function shortPath(path) {
  const cwd = process.cwd();
  return path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
}
