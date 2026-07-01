#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import net from "node:net";
import { arch as osArch, homedir, platform as osPlatform } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 3030;
const DEFAULT_WORKER_PORT = 3001;
const DEFAULT_MONGO_PORT = 27018;
const DEFAULT_REDIS_PORT = 6380;
const RELEASE_STATUS_CACHE_MS = 60_000;
const NPM_VIEW_TIMEOUT_MS = 10_000;
const PACKAGE_NAME_FALLBACK = "@second-inc/cli";
const PACKAGE_VERSION_FALLBACK = "0.0.0-local";

const SECOND_HOME = join(homedir(), ".second");
const DATA_ROOT_DIR = join(SECOND_HOME, "data");
const MONGO_DATA_DIR = join(DATA_ROOT_DIR, "mongo");
const REDIS_DATA_DIR = join(DATA_ROOT_DIR, "redis");
const WORKSPACES_DIR = join(DATA_ROOT_DIR, "workspaces");
const SECRETS_DIR = join(SECOND_HOME, "secrets");
const LOGS_DIR = join(SECOND_HOME, "logs");
const NO_AUTH_SESSION_SECRET_FILE = join(SECRETS_DIR, "no-auth-session-secret");
const INTERNAL_API_TOKEN_FILE = join(SECRETS_DIR, "internal-api-token");
const LOCAL_CONTROL_TOKEN_FILE = join(SECRETS_DIR, "local-control-token");
const LOCAL_CONTROL_STATE_FILE = join(SECOND_HOME, "local-control.json");
const RUNTIME_STATE_FILE = join(SECOND_HOME, "runtime.json");
const RUNTIME_LOCK_DIR = join(SECOND_HOME, "runtime.lock");
const RUNTIME_LOCK_FILE = join(RUNTIME_LOCK_DIR, "owner.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
let MongoClientConstructor = null;

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

const flagValues = new Set();
for (const name of ["--port", "--image"]) {
  const i = args.indexOf(name);
  if (i !== -1) {
    flagValues.add(i);
    flagValues.add(i + 1);
  }
}

const command =
  args.find((a, i) => !a.startsWith("-") && !flagValues.has(i)) ?? "start";
const port = Number(flag("--port") ?? DEFAULT_PORT);
const packageMetadata = readPackageMetadata();
const telemetryDisabled =
  args.includes("--disable-telemetry") ||
  args.includes("--no-analytics") ||
  process.env.SECOND_POSTHOG_DISABLED === "1" ||
  process.env.SECOND_TELEMETRY_DISABLED === "1";
const openBrowserDisabled =
  args.includes("--no-open") ||
  process.env.SECOND_LOCAL_NO_OPEN === "1" ||
  process.env.SECOND_DESKTOP === "1";
const nodeCommand = process.env.SECOND_NODE_PATH?.trim() || "node";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid --port value: ${flag("--port")}`);
  process.exit(1);
}

let activeSpinner = null;
let controlServer = null;
let updateInProgress = false;
let runtimeLockHeld = false;
const childProcesses = new Map();
const runtimeStopState = { stopping: false };

const ANSI_ENABLED = process.env.NO_COLOR !== "1";
const ui = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
};
const colors = createCliColors();
const FULLSCREEN_ENABLED =
  process.env.SECOND_CLI_NO_FULLSCREEN !== "1" &&
  (process.stdout.isTTY || process.env.SECOND_CLI_FORCE_FULLSCREEN === "1");
let fullscreenActive = false;
let bootUi = null;
let resizeHandlerInstalled = false;

const BOOT_STEP_DEFS = [
  {
    key: "runtime",
    title: "Runtime",
    caption: "Packaged MongoDB, Redis, OpenSSL, web, and worker",
  },
  {
    key: "data",
    title: "Data Plane",
    caption: "MongoDB replica set and Redis",
  },
  {
    key: "web",
    title: "Web Server",
    caption: "Next.js local app",
  },
  {
    key: "agents",
    title: "Agents",
    caption: "Worker runtime and scoped tools",
  },
  {
    key: "verify",
    title: "Verify",
    caption: "Health checks and browser handoff",
  },
];

setInterruptHandler(() => {
  runtimeStopState.stopping = true;
  if (activeSpinner) activeSpinner.stop("Cancelled.");
  void shutdownOwnedProcesses().finally(() => process.exit(130));
});

switch (command) {
  case "run":
  case "start":
    await start();
    break;
  case "stop":
    await stop();
    break;
  case "reset":
    await reset();
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    printUsage();
    process.exit(1);
}

async function start() {
  warnAboutRemovedContainerFlags();
  printStartupBanner();
  runtimeStopState.stopping = false;

  const existingRuntime = await findExistingRuntime();
  if (existingRuntime) {
    leaveFullscreen();
    printAlreadyRunning(existingRuntime);
    if (!openBrowserDisabled && existingRuntime.publicUrl) {
      openBrowser(existingRuntime.publicUrl);
    }
    process.exit(0);
  }

  const lock = acquireRuntimeLock({ port });
  if (!lock.acquired) {
    leaveFullscreen();
    printAlreadyRunning(lock);
    if (!openBrowserDisabled && lock.publicUrl) {
      openBrowser(lock.publicUrl);
    }
    process.exit(0);
  }

  const webServer = findWebServer();
  if (!webServer) {
    leaveFullscreen();
    console.error("Error: Could not find the packaged Next.js web server.");
    console.error(
      "Build it with: npm --prefix apps/web run build && npm --prefix packages/cli run build",
    );
    process.exit(1);
  }

  const workerScript = findWorkerScript();
  if (!workerScript) {
    leaveFullscreen();
    console.error("Error: Could not find the agent worker bundle.");
    console.error("If running from the repo, make sure apps/worker/ exists.");
    process.exit(1);
  }

  if (!(await isPortAvailable(port))) {
    leaveFullscreen();
    console.error(`Error: port ${port} is already in use.`);
    console.error("Use --port <number> to choose another web port.");
    process.exit(1);
  }

  mkdirSync(MONGO_DATA_DIR, { recursive: true });
  mkdirSync(REDIS_DATA_DIR, { recursive: true });
  mkdirSync(WORKSPACES_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });

  const noAuthSessionSecret = readOrCreateSecret({
    envName: "SECOND_NO_AUTH_SESSION_SECRET",
    filePath: NO_AUTH_SESSION_SECRET_FILE,
  });
  const internalApiToken = readOrCreateSecret({
    envName: "INTERNAL_API_TOKEN",
    filePath: INTERNAL_API_TOKEN_FILE,
  });
  const localControlToken = readOrCreateSecret({
    envName: "SECOND_LOCAL_CLI_TOKEN",
    filePath: LOCAL_CONTROL_TOKEN_FILE,
  });

  let mongod;
  let redisServer;
  const runtimeStatus = createRuntimeStatusReporter();
  runtimeStatus.log("Checking packaged local runtime...");
  try {
    mongod = await resolveMongodCommand({ status: runtimeStatus.log });
    runtimeStatus.ok("MongoDB binary ready");
    redisServer = await resolveRedisCommand({ status: runtimeStatus.log });
    runtimeStatus.ok("Redis binary ready");
    runtimeStatus.ok("Packaged local runtime ready");
  } catch (err) {
    runtimeStatus.error("Local runtime setup failed");
    leaveFullscreen();
    console.error(`\n${sanitizeErrorMessage(err)}\n`);
    process.exit(1);
  }

  const mongoPort = process.env.SECOND_MONGO_PORT
    ? await choosePort(process.env.SECOND_MONGO_PORT)
    : await choosePreferredOrRandomPort(DEFAULT_MONGO_PORT);
  const redisPort = process.env.SECOND_REDIS_PORT
    ? await choosePort(process.env.SECOND_REDIS_PORT)
    : await choosePreferredOrRandomPort(DEFAULT_REDIS_PORT);
  const workerPort = process.env.SECOND_WORKER_PORT
    ? await choosePort(process.env.SECOND_WORKER_PORT)
    : await choosePreferredOrRandomPort(DEFAULT_WORKER_PORT);

  try {
    controlServer = await startControlServer({
      token: localControlToken,
      packageName: packageMetadata.name,
      currentVersion: packageMetadata.version,
      onStopRequested: () => {
        runtimeStopState.stopping = true;
      },
    });
  } catch (err) {
    leaveFullscreen();
    console.error("Error: Could not start the local Second control server.");
    console.error(`       ${sanitizeErrorMessage(err)}`);
    process.exit(1);
  }

  const mongoUri = `mongodb://127.0.0.1:${mongoPort}/second?directConnection=true&replicaSet=rs0`;
  const redisUrl = `redis://127.0.0.1:${redisPort}`;
  const publicUrl = `http://localhost:${port}`;
  const workerUrl = `http://127.0.0.1:${workerPort}`;

  writeLocalControlState(controlServer);
  writeRuntimeState({
    port,
    mongoPort,
    redisPort,
    workerPort,
    controlPort: controlServer.port,
    webServer: webServer.script,
  });

  console.log();

  let spinner = createSpinner("Starting MongoDB and Redis...");
  try {
    await Promise.all([
      runStartupTask("MongoDB replica set", async () => {
        await startMongo({ command: mongod, port: mongoPort });
        await ensureMongoReplicaSet({ port: mongoPort, uri: mongoUri });
      }),
      runStartupTask("Redis", async () => {
        await startRedis({ command: redisServer, port: redisPort });
      }),
    ]);
    spinner.succeed("MongoDB replica set and Redis ready");
  } catch (err) {
    spinner.fail(`${getStartupTaskName(err)} failed`);
    console.error(`\n${sanitizeErrorMessage(err)}\n`);
    await shutdownOwnedProcesses();
    process.exit(1);
  }

  spinner = createSpinner("Starting Second web server...");
  try {
    await startWeb({
      webServer,
      port,
      publicUrl,
      mongoUri,
      redisUrl,
      workerUrl,
      noAuthSessionSecret,
      internalApiToken,
      localControlUrl: controlServer.hostUrl,
      localControlToken,
    });
    spinner.succeed("Second web server started");
  } catch (err) {
    spinner.fail("Second web server failed to start");
    console.error(`\n${sanitizeErrorMessage(err)}\n`);
    await shutdownOwnedProcesses();
    process.exit(1);
  }

  spinner = createSpinner("Starting agent worker...");
  try {
    await startWorker({
      scriptPath: workerScript,
      webPort: port,
      workerPort,
      internalApiToken,
    });
    spinner.succeed("Agent worker started");
  } catch (err) {
    spinner.fail("Agent worker failed to start");
    console.error(`\n${sanitizeErrorMessage(err)}\n`);
    await shutdownOwnedProcesses();
    process.exit(1);
  }

  spinner = createSpinner("Running Second health check...");
  const appOk = await waitForReady(`${publicUrl}/api/health`);
  if (!appOk) {
    spinner.fail("Second health check failed");
    console.error(`\n  Check logs under ${shortPath(LOGS_DIR)}\n`);
    await shutdownOwnedProcesses();
    process.exit(1);
  }
  spinner.succeed("Second health check passed");

  printReadyPanel({
    publicUrl,
    dataPath: shortPath(DATA_ROOT_DIR),
    logsPath: shortPath(LOGS_DIR),
    updateUrl: controlServer.hostUrl,
    opensBrowser: !openBrowserDisabled,
  });

  setInterruptHandler(() => {
    runtimeStopState.stopping = true;
  });

  if (!openBrowserDisabled) {
    for (let n = 2; n >= 1 && !runtimeStopState.stopping; n--) {
      writeOpeningCountdown(publicUrl, n);
      await delay(1000);
    }

    if (!runtimeStopState.stopping) {
      openBrowser(publicUrl);
      writeOpenedBrowser(publicUrl);
    }
  } else if (setBootFooter(`Second is ready at ${publicUrl}.`)) {
    // Boot UI was updated.
  } else {
    console.log(`\n  Second is ready at ${publicUrl}\n`);
  }

  await watchUntilStopped(runtimeStopState);
}

async function stop() {
  const controlStopRequested = await requestRuntimeStopFromControlState();
  const state = readRuntimeState({ allowAnyPackageName: true });
  if (!state) {
    removeLocalControlState();
    removeRuntimeLock();
    if (controlStopRequested) {
      printNotice("Second stopped.", "The local runtime accepted the stop request.");
      return;
    }
    printNotice("Second is not running.", "No local runtime state was found.");
    return;
  }

  console.log();
  const spinner = createSpinner("Stopping Second...");
  await stopRuntimeFromState(state);
  if (controlStopRequested) {
    await waitForControlServerDown(controlStopRequested.hostUrl, 10_000);
  }
  spinner.succeed("Second stopped");
  console.log();
}

async function reset() {
  if (!args.includes("-y") && !args.includes("--yes")) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await rl.question(
      "This will stop Second and delete all local data. Continue? [y/N] ",
    );
    rl.close();
    if (answer.toLowerCase() !== "y") {
      printNotice("Reset aborted.", "No local data was removed.");
      return;
    }
  }

  console.log();
  const spinner = createSpinner("Resetting Second...");

  const state = readRuntimeState();
  if (state) {
    await stopRuntimeFromState(state);
  }

  rmSync(DATA_ROOT_DIR, { recursive: true, force: true });
  rmSync(NO_AUTH_SESSION_SECRET_FILE, { force: true });
  rmSync(INTERNAL_API_TOKEN_FILE, { force: true });
  rmSync(LOCAL_CONTROL_TOKEN_FILE, { force: true });
  removeLocalControlState();
  removeRuntimeState();

  spinner.succeed("Reset complete");
  printNotice("Reset complete.", "Run 'npx --yes @second-inc/cli' to start fresh.");
}

async function runStartupTask(name, task) {
  try {
    return await task();
  } catch (err) {
    if (err && typeof err === "object") {
      err.startupTaskName = name;
    }
    throw err;
  }
}

function getStartupTaskName(err) {
  if (err && typeof err === "object" && typeof err.startupTaskName === "string") {
    return err.startupTaskName;
  }
  return "Local services";
}

async function findExistingRuntime() {
  const state = readRuntimeState({ allowAnyPackageName: true });
  const control = await readHealthyLocalControlState();

  if (control) {
    return runtimeInfoFromState(state, "control server");
  }

  if (state) {
    if (await isRuntimeStateReady(state)) {
      return runtimeInfoFromState(state, "runtime state");
    }

    await cleanupInactiveRuntimeState(state);
  }

  const lock = readRuntimeLock();
  if (!lock) return null;

  if (
    Number.isInteger(lock.supervisorPid) &&
    lock.supervisorPid !== process.pid &&
    isProcessAlive(lock.supervisorPid)
  ) {
    if (await isRuntimeStateReady(lock)) {
      return runtimeInfoFromState(lock, "runtime lock");
    }
    if (isKnownSecondRuntimeProcess(lock.supervisorPid)) {
      await terminatePid(lock.supervisorPid);
    }
  }

  removeRuntimeLock();
  return null;
}

async function isRuntimeStateReady(state) {
  const runningPort = Number.isInteger(state?.port) ? state.port : null;
  if (!runningPort) return false;
  return waitForReady(`http://localhost:${runningPort}/api/health`, 1500);
}

function runtimeInfoFromState(state, source) {
  const runningPort = Number.isInteger(state?.port) ? state.port : null;
  return {
    acquired: false,
    source,
    port: runningPort,
    publicUrl: runningPort ? `http://localhost:${runningPort}` : null,
    requestedPort: port,
  };
}

function isRuntimeStateActive(state) {
  if (
    Number.isInteger(state?.supervisorPid) &&
    state.supervisorPid !== process.pid &&
    isProcessAlive(state.supervisorPid)
  ) {
    return true;
  }

  for (const proc of Object.values(state?.processes ?? {})) {
    if (
      Number.isInteger(proc?.pid) &&
      proc.pid !== process.pid &&
      isProcessAlive(proc.pid)
    ) {
      return true;
    }
  }

  return false;
}

async function cleanupInactiveRuntimeState(state) {
  if (!isRuntimeStateActive(state)) {
    await stopRuntimeFromState(state);
    return;
  }

  const pids = [
    state.processes?.worker?.pid,
    state.processes?.web?.pid,
    state.processes?.redis?.pid,
    state.processes?.mongo?.pid,
    state.supervisorPid,
  ].filter((pid) => Number.isInteger(pid) && pid !== process.pid);

  for (const pid of pids) {
    if (isKnownSecondRuntimeProcess(pid)) {
      await terminatePid(pid);
    }
  }

  removeRuntimeState();
  removeLocalControlState();
  removeRuntimeLock();
}

function isKnownSecondRuntimeProcess(pid) {
  const command = readProcessCommand(pid);
  if (!command) return false;
  return /second-local\.js|payloads\/[^ ]+\/dist\/(?:web\/server\.js|worker\.mjs)|dist\/runtime\/|mongod|redis-server|@second-inc\/cli-local|Second\.app\/Contents\/Resources/.test(
    command,
  );
}

function readProcessCommand(pid) {
  try {
    const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    });
    if (result.status !== 0) return "";
    return result.stdout.trim();
  } catch {
    return "";
  }
}

function printAlreadyRunning(info) {
  const inner = terminalWidth() - 4;
  const localUrl = info.publicUrl ?? "an existing local Second runtime";
  const lines = [
    centerLine(color(ui.bold, "Second is already running"), inner),
    "",
    `${label("Running")} ${color(ui.cyan, localUrl)}`,
    `${label("Source")} ${info.source ?? "local runtime state"}`,
  ];

  if (Number.isInteger(info.port) && info.port !== port) {
    lines.push("");
    lines.push(
      `Requested port ${port}, but the existing local runtime owns port ${info.port}.`,
    );
  }

  lines.push("");
  lines.push("No second copy was started. Use `npx --yes @second-inc/cli stop` before changing ports.");

  printPanel(lines, { title: "Second" });
}

function acquireRuntimeLock({ port: webPort }) {
  mkdirSync(SECOND_HOME, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(RUNTIME_LOCK_DIR, { mode: 0o700 });
      writeFileSync(
        RUNTIME_LOCK_FILE,
        `${JSON.stringify(
          {
            packageName: packageMetadata.name,
            version: packageMetadata.version,
            runtime: "native",
            supervisorPid: process.pid,
            port: webPort,
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      runtimeLockHeld = true;
      return { acquired: true };
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;

      const lock = readRuntimeLock();
      if (
        Number.isInteger(lock?.supervisorPid) &&
        lock.supervisorPid !== process.pid &&
        isProcessAlive(lock.supervisorPid)
      ) {
        return runtimeInfoFromState(lock, "runtime lock");
      }

      removeRuntimeLock();
    }
  }

  return {
    acquired: false,
    source: "runtime lock",
    port: null,
    publicUrl: null,
    requestedPort: webPort,
  };
}

function readRuntimeLock() {
  try {
    if (!existsSync(RUNTIME_LOCK_FILE)) return null;
    const lock = JSON.parse(readFileSync(RUNTIME_LOCK_FILE, "utf8"));
    if (!lock || typeof lock !== "object") return null;
    return lock;
  } catch {
    return null;
  }
}

function releaseRuntimeLock() {
  const lock = readRuntimeLock();
  if (runtimeLockHeld || lock?.supervisorPid === process.pid) {
    removeRuntimeLock();
  }
}

function removeRuntimeLock() {
  rmSync(RUNTIME_LOCK_DIR, { recursive: true, force: true });
  runtimeLockHeld = false;
}

async function readHealthyLocalControlState() {
  const state = readLocalControlState();
  if (!state?.hostUrl) return null;

  try {
    const res = await fetch(`${state.hostUrl}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok ? state : null;
  } catch {
    return null;
  }
}

async function requestRuntimeStopFromControlState() {
  const state = readLocalControlState();
  if (!state?.hostUrl || !state?.tokenPath) return null;

  let token = "";
  try {
    token = readFileSync(state.tokenPath, "utf8").trim();
  } catch {
    return null;
  }
  if (!token) return null;

  try {
    const res = await fetch(`${state.hostUrl}/stop`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? state : null;
  } catch {
    return null;
  }
}

function readLocalControlState() {
  try {
    if (!existsSync(LOCAL_CONTROL_STATE_FILE)) return null;
    const state = JSON.parse(readFileSync(LOCAL_CONTROL_STATE_FILE, "utf8"));
    if (!state || typeof state !== "object") return null;
    return state;
  } catch {
    return null;
  }
}

async function waitForControlServerDown(hostUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${hostUrl}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (!res.ok) return true;
    } catch {
      return true;
    }
    await delay(250);
  }
  return false;
}

async function startMongo({ command, port: mongoPort }) {
  const child = await spawnManagedProcess("mongo", command, [
    "--dbpath",
    MONGO_DATA_DIR,
    "--bind_ip",
    "127.0.0.1",
    "--port",
    String(mongoPort),
    "--replSet",
    "rs0",
    "--quiet",
  ]);

  await waitForTcp("127.0.0.1", mongoPort, 30_000);
  return child;
}

async function ensureMongoReplicaSet({ port: mongoPort, uri }) {
  const adminUri = `mongodb://127.0.0.1:${mongoPort}/admin?directConnection=true`;
  const replicaHost = `127.0.0.1:${mongoPort}`;
  await waitForMongoConnection(adminUri, 30_000);

  const client = createMongoClient(adminUri, {
    serverSelectionTimeoutMS: 3000,
    directConnection: true,
  });

  try {
    await client.connect();
    const admin = client.db("admin");
    try {
      await admin.command({ replSetGetStatus: 1 });
    } catch (err) {
      if (isMongoReplicaSetUninitialized(err)) {
        await admin.command({
          replSetInitiate: {
            _id: "rs0",
            members: [{ _id: 0, host: replicaHost }],
          },
        });
      } else if (isMongoReplicaSetConfigInvalid(err)) {
        await repairSingleNodeReplicaSet({ client, admin, host: replicaHost });
      } else {
        throw err;
      }
    }

    await ensureSingleNodeReplicaSetHost({ client, admin, host: replicaHost });
  } finally {
    await client.close().catch(() => undefined);
  }

  await waitForMongoPrimary(uri, 30_000);
}

async function ensureSingleNodeReplicaSetHost({ client, admin, host }) {
  const config = await readReplicaSetConfig({ client, admin });
  if (!config) return;

  const members = Array.isArray(config.members) ? config.members : [];
  if (members.length === 1 && members[0]?.host === host) return;

  await reconfigureSingleNodeReplicaSet({ admin, config, host });
}

async function repairSingleNodeReplicaSet({ client, admin, host }) {
  const config = await readReplicaSetConfig({ client, admin });
  if (!config) {
    await admin.command({
      replSetInitiate: {
        _id: "rs0",
        members: [{ _id: 0, host }],
      },
    });
    return;
  }

  await reconfigureSingleNodeReplicaSet({ admin, config, host });
}

async function readReplicaSetConfig({ client, admin }) {
  try {
    const result = await admin.command({ replSetGetConfig: 1 });
    if (result?.config) return result.config;
  } catch {
    // If the stored host points at an old random port, Mongo may refuse
    // replica-set commands. The local config document is still readable.
  }

  try {
    return await client.db("local").collection("system.replset").findOne({
      _id: "rs0",
    });
  } catch {
    return null;
  }
}

async function reconfigureSingleNodeReplicaSet({ admin, config, host }) {
  const members = Array.isArray(config.members) ? config.members : [];
  if (members.length > 1) {
    throw new Error(
      "Local MongoDB has a multi-node replica set config. The local CLI only repairs its own single-node replica set.",
    );
  }

  const member = members[0] ?? {};
  const nextConfig = {
    ...config,
    _id: "rs0",
    version: Number.isInteger(config.version) ? config.version + 1 : 1,
    members: [
      {
        ...member,
        _id: Number.isInteger(member._id) ? member._id : 0,
        host,
      },
    ],
  };
  delete nextConfig.term;

  await admin.command({
    replSetReconfig: nextConfig,
    force: true,
  });
}

async function startRedis({ command, port: redisPort }) {
  const child = await spawnManagedProcess("redis", command, [
    "--bind",
    "127.0.0.1",
    "--port",
    String(redisPort),
    "--dir",
    REDIS_DATA_DIR,
    "--appendonly",
    "yes",
    "--daemonize",
    "no",
    "--save",
    "60",
    "1000",
  ]);

  await waitForRedisPing(redisPort, 20_000);
  return child;
}

async function startWeb({
  webServer,
  port: webPort,
  publicUrl,
  mongoUri,
  redisUrl,
  workerUrl,
  noAuthSessionSecret,
  internalApiToken,
  localControlUrl,
  localControlToken,
}) {
  const disableTelemetry = telemetryDisabled ? "1" : "";
  await spawnManagedProcess("web", nodeCommand, [webServer.script], {
    cwd: webServer.cwd,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1",
      PORT: String(webPort),
      SECOND_AUTH_MODE: "none",
      SECOND_NO_AUTH_SESSION_SECRET: noAuthSessionSecret,
      INTERNAL_API_TOKEN: internalApiToken,
      MONGODB_URI: mongoUri,
      SECOND_PUBLIC_URL: publicUrl,
      WEB_URL: publicUrl,
      TOOL_EXECUTE_URL: `${publicUrl}/api/internal/tool-execute`,
      WORKER_URL: workerUrl,
      REDIS_URL: redisUrl,
      SECOND_LOCAL_INSTALL: "1",
      SECOND_RELEASE_RUNTIME: "native",
      SECOND_RELEASE_VERSION: packageMetadata.version,
      SECOND_RELEASE_PACKAGE: packageMetadata.name,
      SECOND_LOCAL_CLI_URL: localControlUrl,
      SECOND_LOCAL_CLI_TOKEN: localControlToken,
      SECOND_POSTHOG_TOKEN: process.env.SECOND_POSTHOG_TOKEN?.trim() || "",
      SECOND_POSTHOG_HOST: process.env.SECOND_POSTHOG_HOST?.trim() || "",
      SECOND_POSTHOG_DISABLED: disableTelemetry,
      SECOND_TELEMETRY_DISABLED: disableTelemetry,
      SECOND_SENTRY_DSN: process.env.SECOND_SENTRY_DSN?.trim() || "",
      NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || "",
      SENTRY_DSN: process.env.SENTRY_DSN?.trim() || "",
      SECOND_SENTRY_DISABLED: process.env.SECOND_SENTRY_DISABLED === "1" ? "1" : "",
      SECOND_ERROR_REPORTING_DISABLED:
        process.env.SECOND_ERROR_REPORTING_DISABLED === "1" ? "1" : "",
    },
  });

  const ok = await waitForReady(`${publicUrl}/api/health`, 90_000);
  if (!ok) {
    throw new Error("Second web health check failed.");
  }
}

async function startWorker({
  scriptPath,
  webPort,
  workerPort,
  internalApiToken,
}) {
  const isTs = scriptPath.endsWith(".ts");
  const nodeArgs = isTs ? ["--import", "tsx", scriptPath] : [scriptPath];
  const cwd = isTs ? join(scriptPath, "..", "..") : undefined;

  await spawnManagedProcess("worker", nodeCommand, nodeArgs, {
    cwd,
    env: {
      ...process.env,
      PORT: String(workerPort),
      INTERNAL_API_TOKEN: internalApiToken,
      WEB_URL: `http://localhost:${webPort}`,
      TOOL_EXECUTE_URL: `http://localhost:${webPort}/api/internal/tool-execute`,
      WORKSPACES_DIR,
    },
  });

  const ok = await waitForReady(`http://127.0.0.1:${workerPort}/health`, 30_000);
  if (!ok) {
    throw new Error("Agent worker health check failed.");
  }
}

function startControlServer({
  token,
  packageName,
  currentVersion,
  onStopRequested,
}) {
  const statusCache = {
    value: null,
    expiresAt: 0,
    pending: null,
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, {
          ok: true,
          packageName,
          currentVersion,
          runtime: "native",
          updating: updateInProgress,
        });
      }

      if (!isAuthorizedControlRequest(req, token)) {
        return sendJson(res, 401, { error: "unauthorized" });
      }

      if (req.method === "POST" && url.pathname === "/stop") {
        sendJson(res, 202, {
          accepted: true,
          stopping: true,
        });
        onStopRequested?.();
        return;
      }

      if (req.method === "GET" && url.pathname === "/release/status") {
        const status = await getReleaseStatus({
          cache: statusCache,
          packageName,
          currentVersion,
        });
        return sendJson(res, 200, {
          ...status,
          updating: updateInProgress,
        });
      }

      if (req.method === "POST" && url.pathname === "/update/install") {
        if (updateInProgress) {
          return sendJson(res, 202, {
            accepted: true,
            updating: true,
            alreadyUpdating: true,
          });
        }

        const npxReady = await ensureNpxAvailable();
        if (!npxReady.ok) {
          return sendJson(res, 500, {
            accepted: false,
            error: npxReady.error,
          });
        }

        updateInProgress = true;
        sendJson(res, 202, {
          accepted: true,
          updating: true,
          alreadyUpdating: false,
        });

        setTimeout(() => {
          void performUpdateInstall();
        }, 25).unref();
        return;
      }

      return sendJson(res, 404, { error: "not_found" });
    } catch (err) {
      return sendJson(res, 500, {
        error: "internal_error",
        message: sanitizeErrorMessage(err),
      });
    }
  });

  return new Promise((resolve, reject) => {
    const rejectOnError = (err) => reject(err);
    server.once("error", rejectOnError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectOnError);
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Control server did not bind to a TCP port."));
        return;
      }

      resolve({
        server,
        port: address.port,
        hostUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function closeControlServer() {
  if (controlServer?.server) {
    try {
      controlServer.server.close();
    } catch {
      // best-effort cleanup
    }
  }
  controlServer = null;
  removeLocalControlState();
}

async function getReleaseStatus({ cache, packageName, currentVersion }) {
  const now = Date.now();
  if (cache.value && cache.expiresAt > now) {
    return cache.value;
  }

  if (cache.pending) {
    return cache.pending;
  }

  cache.pending = (async () => {
    const checkedAt = new Date().toISOString();
    const latest = await readLatestPackageVersion(packageName);
    const latestVersion = latest.version;
    const updateAvailable = latestVersion
      ? isVersionGreater(latestVersion, currentVersion)
      : false;

    const value = {
      enabled: true,
      mode: "cli",
      runtime: "native",
      packageName,
      currentVersion,
      latestVersion,
      updateAvailable,
      checkedAt,
      error: latest.error,
    };

    cache.value = value;
    cache.expiresAt = Date.now() + RELEASE_STATUS_CACHE_MS;
    cache.pending = null;
    return value;
  })().catch((err) => {
    const value = {
      enabled: true,
      mode: "cli",
      runtime: "native",
      packageName,
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      checkedAt: new Date().toISOString(),
      error: sanitizeReleaseError(err),
    };
    cache.value = value;
    cache.expiresAt = Date.now() + RELEASE_STATUS_CACHE_MS;
    cache.pending = null;
    return value;
  });

  return cache.pending;
}

async function performUpdateInstall() {
  const npxArgs = buildUpdateNpxArgs();

  console.log();
  console.log("  Installing Second update...");
  console.log(`  Restart command: npx ${npxArgs.join(" ")}`);
  console.log("  Recovery command if restart fails: npx --yes @second-inc/cli");

  await shutdownOwnedProcesses({ keepState: true });
  removeRuntimeState();
  removeRuntimeLock();

  let child;
  try {
    child = spawn("npx", npxArgs, {
      detached: true,
      env: process.env,
      stdio: "inherit",
    });
    await waitForChildSpawn(child);
  } catch (err) {
    console.error("\n  Failed to start the updated Second CLI.");
    console.error(`  ${sanitizeErrorMessage(err)}`);
    console.error("\n  Run this command to recover:");
    console.error("  npx --yes @second-inc/cli\n");
    process.exit(1);
  }

  child.unref();
  process.exit(0);
}

function buildUpdateNpxArgs() {
  const npxArgs = [
    "--yes",
    `${packageMetadata.name}@latest`,
    "run",
    "--port",
    String(port),
  ];

  if (telemetryDisabled) {
    npxArgs.push("--disable-telemetry");
  }

  return npxArgs;
}

async function watchUntilStopped(state = { stopping: false }) {
  setInterruptHandler(() => {
    state.stopping = true;
  });

  while (!state.stopping) {
    await delay(1000);

    for (const [name, child] of childProcesses) {
      if (child.exitCode !== null || child.signalCode !== null) {
        if (updateInProgress) continue;
        leaveFullscreen();
        const reason =
          child.signalCode !== null
            ? `signal ${child.signalCode}`
            : `exit code ${child.exitCode}`;
        console.error(`\n  ${name} stopped unexpectedly (${reason}). Stopping Second.\n`);
        printProcessLogTail(name);
        state.stopping = true;
        break;
      }
    }
  }

  setInterruptHandler(() => {});
  console.log();
  const spinner = createSpinner("Stopping Second...");
  await shutdownOwnedProcesses();
  spinner.succeed("Second stopped");
  console.log();
  process.exit(0);
}

async function shutdownOwnedProcesses({ keepState = false } = {}) {
  closeControlServer();

  const children = Array.from(childProcesses.values()).reverse();
  for (const child of children) {
    await terminateChild(child);
  }
  childProcesses.clear();

  if (!keepState) {
    removeRuntimeState();
  }
  releaseRuntimeLock();
}

async function stopRuntimeFromState(state) {
  const pids = [
    state.processes?.worker?.pid,
    state.processes?.web?.pid,
    state.processes?.redis?.pid,
    state.processes?.mongo?.pid,
  ].filter((pid) => Number.isInteger(pid));

  for (const pid of pids) {
    await terminatePid(pid);
  }

  const supervisorPid = state.supervisorPid;
  if (
    Number.isInteger(supervisorPid) &&
    supervisorPid !== process.pid &&
    isProcessAlive(supervisorPid)
  ) {
    await terminatePid(supervisorPid);
  }

  removeRuntimeState();
  removeLocalControlState();
  removeRuntimeLock();
}

async function spawnManagedProcess(name, cmd, cmdArgs, options = {}) {
  const out = createWriteStream(join(LOGS_DIR, `${name}.log`), { flags: "a" });
  out.write(`\n[${new Date().toISOString()}] ${cmd} ${cmdArgs.join(" ")}\n`);

  const child = spawn(cmd, cmdArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.pipe(out);
  child.stderr.pipe(out);
  childProcesses.set(name, child);
  writeRuntimeStatePatch(name, child.pid);

  child.on("exit", () => {
    out.end();
  });

  await waitForChildSpawn(child);
  return child;
}

function printProcessLogTail(name) {
  const logPath = join(LOGS_DIR, `${name}.log`);
  let text = "";
  try {
    text = readFileSync(logPath, "utf-8");
  } catch {
    console.error(`  Log file: ${shortPath(logPath)}\n`);
    return;
  }

  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-30);

  console.error(`  Log file: ${shortPath(logPath)}`);
  if (lines.length === 0) {
    console.error("  No log output was captured.\n");
    return;
  }

  console.error("  Last log lines:");
  for (const line of lines) {
    const trimmed = line.length > 500 ? `${line.slice(0, 500)}...` : line;
    console.error(`    ${trimmed}`);
  }
  console.error();
}

function waitForChildSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const stopped = await waitForChildExit(child, 7000);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForChildExit(child, 3000);
  }
}

async function terminatePid(pid) {
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await delay(250);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already stopped
  }
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readRuntimeState({ allowAnyPackageName = false } = {}) {
  try {
    if (!existsSync(RUNTIME_STATE_FILE)) return null;
    const state = JSON.parse(readFileSync(RUNTIME_STATE_FILE, "utf8"));
    if (!isSecondRuntimeState(state)) return null;
    if (!allowAnyPackageName && !isCompatibleRuntimePackage(state.packageName)) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function isSecondRuntimeState(state) {
  if (!state || typeof state !== "object") return false;
  if (state.runtime && state.runtime !== "native") return false;
  if (state.packageName && !String(state.packageName).startsWith("@second-inc/cli")) {
    return false;
  }
  return true;
}

function isCompatibleRuntimePackage(name) {
  if (!name) return true;
  return name === packageMetadata.name || name === PACKAGE_NAME_FALLBACK;
}

function writeRuntimeState(details) {
  mkdirSync(SECOND_HOME, { recursive: true });
  writeFileSync(
    RUNTIME_STATE_FILE,
    `${JSON.stringify(
      {
        packageName: packageMetadata.name,
        version: packageMetadata.version,
        runtime: "native",
        supervisorPid: process.pid,
        startedAt: new Date().toISOString(),
        ...details,
        processes: {},
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function writeRuntimeStatePatch(name, pid) {
  const state = readRuntimeState();
  if (!state) return;
  state.processes = {
    ...(state.processes ?? {}),
    [name]: { pid, startedAt: new Date().toISOString() },
  };
  writeFileSync(RUNTIME_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function removeRuntimeState() {
  rmSync(RUNTIME_STATE_FILE, { force: true });
}

function writeLocalControlState(serverInfo) {
  mkdirSync(SECOND_HOME, { recursive: true });
  writeFileSync(
    LOCAL_CONTROL_STATE_FILE,
    `${JSON.stringify(
      {
        hostUrl: serverInfo.hostUrl,
        tokenPath: LOCAL_CONTROL_TOKEN_FILE,
        packageName: packageMetadata.name,
        currentVersion: packageMetadata.version,
        runtime: "native",
        mode: "cli",
        writtenAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function removeLocalControlState() {
  rmSync(LOCAL_CONTROL_STATE_FILE, { force: true });
}

function isAuthorizedControlRequest(req, token) {
  return req.headers.authorization === `Bearer ${token}`;
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

async function readLatestPackageVersion(packageName) {
  try {
    const { stdout } = await runWithOutput(
      "npm",
      ["view", `${packageName}@latest`, "version", "--json", "--silent"],
      { timeoutMs: NPM_VIEW_TIMEOUT_MS },
    );
    const version = parseNpmVersion(stdout);
    if (!version) {
      return {
        version: null,
        error: {
          code: "invalid_registry_response",
          message: "The npm registry did not return a valid package version.",
        },
      };
    }

    return { version, error: null };
  } catch (err) {
    return {
      version: null,
      error: sanitizeReleaseError(err),
    };
  }
}

function parseNpmVersion(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "string" && parsed.trim() ? parsed.trim() : null;
  } catch {
    return trimmed.startsWith('"') ? null : trimmed;
  }
}

async function ensureNpxAvailable() {
  try {
    await runWithOutput("npx", ["--version"], { timeoutMs: 5000 });
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: {
        code: "npx_unavailable",
        message:
          "Could not find a working npx command on this machine. Install Node.js/npm, then retry the update.",
      },
    };
  }
}

async function resolveMongodCommand({ status } = {}) {
  const configured = process.env.SECOND_MONGOD_PATH?.trim();
  if (configured) {
    status?.("MongoDB: using SECOND_MONGOD_PATH override...");
    await ensureBinaryWorks(configured, "MongoDB server");
    return configured;
  }

  const runtime = resolvePackagedRuntime();
  status?.(`MongoDB: using packaged runtime ${runtime.runtimeId}...`);
  await ensureBinaryWorks(runtime.mongodb, "Packaged MongoDB server");
  return runtime.mongodb;
}

async function resolveRedisCommand({ status } = {}) {
  const configured = process.env.SECOND_REDIS_SERVER_PATH?.trim();
  if (configured) {
    status?.("Redis: using SECOND_REDIS_SERVER_PATH override...");
    await ensureBinaryWorks(configured, "Redis server");
    return configured;
  }

  const runtime = resolvePackagedRuntime();
  status?.(`Redis: using packaged runtime ${runtime.runtimeId}...`);
  await ensureBinaryWorks(runtime.redis, "Packaged Redis server");
  return runtime.redis;
}

function createMongoClient(uri, options) {
  return new (getMongoClientConstructor())(uri, options);
}

function getMongoClientConstructor() {
  if (MongoClientConstructor) return MongoClientConstructor;

  const candidates = [
    join(__dirname, "..", "dist", "web", "node_modules", "mongodb"),
    "mongodb",
  ];

  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      if (typeof mod.MongoClient === "function") {
        MongoClientConstructor = mod.MongoClient;
        return MongoClientConstructor;
      }
    } catch {
      // try the next packaged or installed location
    }
  }

  throw new Error(
    "Could not load the packaged MongoDB Node.js driver. Rebuild and republish the local CLI payload.",
  );
}

function resolvePackagedRuntime() {
  const runtimeId = currentRuntimeId();
  const candidates = [
    optionalRuntimePackageManifest(runtimeId),
    join(__dirname, "..", "dist", "runtime", runtimeId, "manifest.json"),
  ].filter(Boolean);

  for (const manifestPath of candidates) {
    const runtime = readRuntimeManifest(manifestPath, runtimeId);
    if (runtime) return runtime;
  }

  throw new Error(
    [
      `The packaged local runtime for ${runtimeId} is missing.`,
      "The CLI no longer downloads MongoDB or Redis during startup.",
      "Rebuild the package with: npm --prefix packages/cli run build",
      "For npm releases, publish the matching @second-inc/runtime-* package before publishing @second-inc/cli.",
    ].join(" "),
  );
}

function optionalRuntimePackageManifest(runtimeId) {
  try {
    return require.resolve(`@second-inc/runtime-${runtimeId}/manifest.json`);
  } catch {
    return null;
  }
}

function readRuntimeManifest(manifestPath, runtimeId) {
  if (!existsSync(manifestPath)) return null;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(
      `Could not read packaged runtime manifest at ${manifestPath}: ${sanitizeErrorMessage(err)}`,
    );
  }

  if (manifest.runtimeId !== runtimeId) {
    throw new Error(
      `Packaged runtime manifest ${manifestPath} is for ${manifest.runtimeId}, expected ${runtimeId}.`,
    );
  }

  const root = dirname(manifestPath);
  const mongodb = join(root, manifest.mongodb?.bin ?? "");
  const redis = join(root, manifest.redis?.bin ?? "");
  if (!existsSync(mongodb) || !existsSync(redis)) {
    throw new Error(
      `Packaged runtime manifest ${manifestPath} is missing MongoDB or Redis binaries.`,
    );
  }

  return {
    runtimeId,
    mongodb,
    redis,
  };
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

async function ensureBinaryWorks(command, label) {
  try {
    await runWithOutput(command, ["--version"], { timeoutMs: 5000 });
  } catch (err) {
    throw new Error(`${label} does not run: ${sanitizeErrorMessage(err)}`);
  }
}

async function resolveCommand({ envNames, candidates, label, installHint }) {
  for (const envName of envNames) {
    const configured = process.env[envName]?.trim();
    if (configured) return configured;
  }

  for (const candidate of candidates) {
    if (await commandWorks(candidate)) return candidate;
  }

  console.error(`Error: ${label} was not found.`);
  console.error(installHint);
  process.exit(1);
}

async function commandWorks(cmd) {
  try {
    await runWithOutput(cmd, ["--version"], { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}

function runWithOutput(cmd, cmdArgs, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(cmd, cmdArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 1000).unref();
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        Object.assign(
          new Error(timedOut ? "Command timed out." : "Command failed."),
          { code, stderr, timedOut },
        ),
      );
    });
  });
}

async function choosePort(preferred) {
  const parsed = preferred ? Number(preferred) : 0;
  if (preferred && (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535)) {
    throw new Error(`Invalid port value: ${preferred}`);
  }

  if (parsed > 0) {
    if (!(await isPortAvailable(parsed))) {
      throw new Error(`Port ${parsed} is already in use.`);
    }
    return parsed;
  }

  return getAvailablePort();
}

async function choosePreferredOrRandomPort(preferred) {
  if (await isPortAvailable(preferred)) {
    return preferred;
  }

  return getAvailablePort();
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local TCP port."));
        return;
      }
      const selected = address.port;
      server.close(() => resolve(selected));
    });
  });
}

function isPortAvailable(candidatePort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(candidatePort, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForTcp(host, tcpPort, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnectTcp(host, tcpPort)) return true;
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${host}:${tcpPort}.`);
}

function canConnectTcp(host, tcpPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: tcpPort });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForRedisPing(redisPort, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await redisPing(redisPort)) return true;
    await delay(500);
  }
  throw new Error("Timed out waiting for Redis PONG.");
}

function redisPing(redisPort) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host: "127.0.0.1", port: redisPort });
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.write("*1\r\n$4\r\nPING\r\n");
    });
    socket.on("data", (chunk) => {
      finish(chunk.toString().includes("PONG"));
    });
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForMongoConnection(uri, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const client = createMongoClient(uri, {
      serverSelectionTimeoutMS: 1000,
      directConnection: true,
    });
    try {
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      await client.close();
      return;
    } catch {
      await client.close().catch(() => undefined);
      await delay(500);
    }
  }

  throw new Error("Timed out waiting for MongoDB.");
}

async function waitForMongoPrimary(uri, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const client = createMongoClient(uri, { serverSelectionTimeoutMS: 1000 });
    try {
      await client.connect();
      const hello = await client.db("admin").command({ hello: 1 });
      await client.close();
      if (hello.isWritablePrimary || hello.ismaster) return;
    } catch {
      await client.close().catch(() => undefined);
    }
    await delay(500);
  }

  throw new Error("Timed out waiting for MongoDB primary.");
}

function isMongoReplicaSetUninitialized(err) {
  return (
    err?.code === 94 ||
    err?.codeName === "NotYetInitialized" ||
    String(err?.message ?? "").includes("no replset config has been received")
  );
}

function isMongoReplicaSetConfigInvalid(err) {
  const message = String(err?.message ?? "");
  return (
    err?.code === 93 ||
    err?.code === 74 ||
    err?.codeName === "InvalidReplicaSetConfig" ||
    err?.codeName === "NodeNotFound" ||
    message.includes("not a member") ||
    message.includes("No host described") ||
    message.includes("Our replica set config is invalid")
  );
}

async function waitForReady(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await delay(1000);
  }
  return false;
}

function findWebServer() {
  const configured = process.env.SECOND_WEB_SERVER_PATH?.trim();
  if (configured && existsSync(configured)) {
    return { cwd: dirname(configured), script: configured };
  }

  const packagedRoot = join(__dirname, "..", "dist", "web");
  const packagedScript = join(packagedRoot, "server.js");
  if (existsSync(packagedScript)) {
    return { cwd: packagedRoot, script: packagedScript };
  }

  const monoRoot = join(
    __dirname,
    "..",
    "..",
    "..",
    "apps",
    "web",
    ".next",
    "standalone",
  );
  const monoScript = join(monoRoot, "server.js");
  if (existsSync(monoScript)) {
    return { cwd: monoRoot, script: monoScript };
  }

  return null;
}

function findWorkerScript() {
  const mono = join(
    __dirname,
    "..",
    "..",
    "..",
    "apps",
    "worker",
    "src",
    "index.ts",
  );
  if (existsSync(mono)) return mono;

  const bundled = join(__dirname, "..", "dist", "worker.mjs");
  if (existsSync(bundled)) return bundled;

  return null;
}

function readOrCreateSecret({ envName, filePath }) {
  const configured = process.env[envName]?.trim();
  if (configured) return configured;

  mkdirSync(SECRETS_DIR, { recursive: true });

  if (existsSync(filePath)) {
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // best-effort permissions repair
    }
    const existing = readFileSync(filePath, "utf8").trim();
    if (existing.length >= 32) return existing;
  }

  const secret = randomBytes(32).toString("hex");
  writeFileSync(filePath, `${secret}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return secret;
}

function readPackageMetadata() {
  const envPackageName = process.env.SECOND_CLI_RELEASE_PACKAGE?.trim();
  const envVersion = process.env.SECOND_CLI_RELEASE_VERSION?.trim();
  if (envPackageName || envVersion) {
    return {
      name: envPackageName || PACKAGE_NAME_FALLBACK,
      version: envVersion || PACKAGE_VERSION_FALLBACK,
    };
  }

  try {
    const raw = readFileSync(join(__dirname, "..", "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return {
      name: typeof parsed.name === "string" ? parsed.name : PACKAGE_NAME_FALLBACK,
      version:
        typeof parsed.version === "string"
          ? parsed.version
          : PACKAGE_VERSION_FALLBACK,
    };
  } catch {
    return {
      name: PACKAGE_NAME_FALLBACK,
      version: PACKAGE_VERSION_FALLBACK,
    };
  }
}

function sanitizeErrorMessage(err) {
  if (!err) return "Unknown error.";
  if (err.timedOut) return "Command timed out.";
  if (err.code === "ENOENT") return "Required command was not found on PATH.";
  return err.message?.trim() || "Command failed.";
}

function sanitizeReleaseError(err) {
  if (err?.timedOut) {
    return {
      code: "npm_timeout",
      message: "Timed out while checking npm for the latest Second CLI version.",
    };
  }

  if (err?.code === "ENOENT") {
    return {
      code: "npm_unavailable",
      message:
        "Could not find npm on this machine, so update status is unavailable.",
    };
  }

  return {
    code: "npm_check_failed",
    message:
      "Could not check npm for the latest Second CLI version. If the package is private, run npm login for the @second-inc scope.",
  };
}

function isVersionGreater(candidate, current) {
  const candidateVersion = parseSemver(candidate);
  const currentVersion = parseSemver(current);
  if (!candidateVersion || !currentVersion) return false;

  for (const key of ["major", "minor", "patch"]) {
    if (candidateVersion[key] > currentVersion[key]) return true;
    if (candidateVersion[key] < currentVersion[key]) return false;
  }

  return comparePrerelease(candidateVersion.prerelease, currentVersion.prerelease) > 0;
}

function parseSemver(version) {
  const match = String(version).trim().match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

function comparePrerelease(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const aParts = a.split(".");
  const bParts = b.split(".");
  const max = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < max; i++) {
    const aPart = aParts[i];
    const bPart = bParts[i];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;

    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);

    if (aNumeric && bNumeric) {
      const aNumber = Number(aPart);
      const bNumber = Number(bPart);
      if (aNumber > bNumber) return 1;
      if (aNumber < bNumber) return -1;
      continue;
    }

    if (aNumeric) return -1;
    if (bNumeric) return 1;

    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }

  return 0;
}

function color(code, text) {
  return ANSI_ENABLED ? `${code}${text}${ui.reset}` : text;
}

function enterFullscreen() {
  if (!FULLSCREEN_ENABLED || fullscreenActive) return;
  fullscreenActive = true;
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[3J\x1b[H");
  process.once("exit", leaveFullscreen);
  installResizeHandler(() => {
    renderBootUi();
  });
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
  if (resizeHandlerInstalled) return;
  resizeHandlerInstalled = true;

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

function terminalHeight() {
  return Math.max(
    18,
    process.stdout.rows ||
      process.stdin.rows ||
      readPositiveInt(process.env.SECOND_CLI_ROWS) ||
      readPositiveInt(process.env.LINES) ||
      32,
  );
}

function readPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleLength(text) {
  return Array.from(stripAnsi(text)).length;
}

function fitLine(text, width) {
  if (visibleLength(text) <= width) {
    return `${text}${" ".repeat(Math.max(0, width - visibleLength(text)))}`;
  }

  const plain = stripAnsi(text);
  const sliced = Array.from(plain).slice(0, Math.max(0, width - 3)).join("");
  return `${sliced}...`;
}

function centerLine(text, width) {
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
  const maxLines = Math.max(1, terminalHeight() - 1);
  return lines.slice(0, maxLines);
}

function printPanel(lines, { title = "Second" } = {}) {
  const width = terminalWidth();
  const inner = width - 4;
  const topTitle = ` ${title} `;
  const topFill = Math.max(0, width - 2 - visibleLength(topTitle));
  const leftFill = Math.floor(topFill / 2);
  const rightFill = topFill - leftFill;

  console.log();
  console.log(`  ╭${"─".repeat(leftFill)}${topTitle}${"─".repeat(rightFill)}╮`);
  for (const line of lines) {
    console.log(`  │ ${fitLine(line, inner)} │`);
  }
  console.log(`  ╰${"─".repeat(width - 2)}╯`);
  console.log();
}

function initBootUi({ launchMode }) {
  enterFullscreen();
  bootUi = {
    tick: 0,
    startedAt: Date.now(),
    title: "Second is coming online",
    subtitle: "Native services, web, and agents are starting together.",
    meta: [
      ["version", `v${packageMetadata.version}`],
      ["mode", launchMode],
      ["local", `http://localhost:${port}`],
      ["runtime", "native local payload"],
    ],
    footer: "Preparing local services...",
    ready: null,
    steps: BOOT_STEP_DEFS.map((step) => ({
      ...step,
      status: "pending",
      detail: "Waiting",
      logs: [],
      startedAt: null,
      finishedAt: null,
    })),
  };
  renderBootUi();
}

function updateBootStep(key, patch = {}) {
  if (!bootUi) return false;

  const step = bootUi.steps.find((candidate) => candidate.key === key);
  if (!step) return false;

  if (patch.status === "active" && step.status !== "active") {
    step.startedAt = Date.now();
  }
  if ((patch.status === "ok" || patch.status === "error") && !step.finishedAt) {
    step.finishedAt = Date.now();
  }
  if (Array.isArray(patch.logs)) {
    step.logs = patch.logs.slice(-3);
  }

  Object.assign(step, patch);
  renderBootUi();
  return true;
}

function appendBootStepLog(key, message, status = "active") {
  if (!bootUi) return false;

  const step = bootUi.steps.find((candidate) => candidate.key === key);
  if (!step) return false;

  if (status === "active" && step.status !== "active") {
    step.startedAt = Date.now();
  }

  step.status = status;
  step.detail = message;
  step.logs = [...step.logs, message].slice(-3);
  renderBootUi();
  return true;
}

function setBootFooter(message) {
  if (!bootUi) return false;
  bootUi.footer = message;
  renderBootUi();
  return true;
}

function setBootReady({
  publicUrl,
  dataPath,
  logsPath,
  updateUrl,
  opensBrowser = true,
}) {
  if (!bootUi) return false;
  bootUi.ready = { publicUrl, dataPath, logsPath, updateUrl };
  bootUi.title = "Second is running locally";
  bootUi.subtitle = "Your agent-native workspace is ready.";
  bootUi.footer = opensBrowser
    ? "Press Ctrl+C to stop. The browser opens automatically in a few seconds."
    : "Press Ctrl+C to stop. The desktop app will open this workspace.";
  renderBootUi();
  return true;
}

function renderBootUi() {
  if (!bootUi || !fullscreenActive) return;

  bootUi.tick += 1;
  clearFullscreen();

  const width = terminalWidth();
  const accent = colors.accent;
  const muted = colors.muted;
  const strong = colors.strong;
  const blue = colors.blue;

  const lines = [
    "",
    `${color(accent, "Second")} ${color(ui.dim, `v${packageMetadata.version}`)}  ${color(ui.bold, color(strong, bootUi.title))}`,
    color(muted, bootUi.subtitle),
    `${color(muted, "mode")} ${color(blue, bootUi.meta.find(([name]) => name === "mode")?.[1] ?? "")}  ${color(muted, "local")} ${color(blue, `http://localhost:${port}`)}`,
    "",
    progressRailLine(width),
    "",
  ];

  for (const step of bootUi.steps) {
    lines.push(...renderBootStep(step, width));
  }

  if (bootUi.ready) {
    lines.push(...renderReadyDetails(bootUi.ready, width));
  }

  lines.push("");
  lines.push(color(muted, bootUi.footer));

  for (const line of fitFrameToTerminal(lines)) {
    console.log(`  ${paintCanvasLine(line, width)}`);
  }
}

function progressRailLine(width) {
  const pieces = bootUi.steps.map((step) => {
    const marker =
      step.status === "ok"
        ? color(ui.green, "●")
        : step.status === "error"
          ? color(ui.red, "●")
          : step.status === "active"
            ? color(ui.cyan, spinnerFrame())
            : color(ui.dim, "○");
    return `${marker} ${step.title}`;
  });
  return fitLine(pieces.join(color(ui.dim, " ─ ")), width);
}

function renderBootStep(step, width) {
  const state =
    step.status === "ok"
      ? color(ui.green, "ready")
      : step.status === "error"
        ? color(ui.red, "failed")
        : step.status === "active"
          ? color(ui.cyan, `running ${spinnerFrame()}`)
          : color(ui.dim, "pending");
  const elapsed =
    step.startedAt && (step.status === "active" || step.finishedAt)
      ? color(ui.dim, formatDuration(step.startedAt, step.finishedAt ?? Date.now()))
      : "";
  const detail = step.status === "pending" ? step.caption : step.detail;

  return [
    dockTop(step.title, width),
    dockLine(`${state.padEnd(16, " ")} ${detail} ${elapsed}`.trim(), width),
    dockBottom(width),
  ];
}

function renderReadyDetails({ publicUrl, dataPath, logsPath, updateUrl }, width) {
  return [
    dockTop("ready", width),
    dockLine(`${label("Local")} ${color(ui.cyan, publicUrl)}`, width),
    dockLine(`${label("Data")} ${dataPath}  ${label("Logs")} ${logsPath}`, width),
    dockLine(`${label("Update")} ${updateUrl}`, width),
    dockBottom(width),
  ];
}

function spinnerFrame() {
  return ["◐", "◓", "◑", "◒"][bootUi?.tick % 4 ?? 0];
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
    color(ui.bold, color(strong, title)),
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

function buildSecondLogoArt({ width = 40, height = 17, tone = "default" } = {}) {
  const ink = tone === "error" ? colors.error : colors.strong;
  const cols = Math.max(10, Math.floor(width / 2));
  const rows = height;
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

function label(text) {
  return color(ui.dim, text.padEnd(8, " "));
}

function printSection(title, detail) {
  const width = terminalWidth();
  clearFullscreen();
  console.log(`  ${dockTop(title, width)}`);
  if (detail) {
    console.log(`  ${dockLine(color(ui.dim, detail), width)}`);
  }
}

function printStatusRow(kind, message, { close = false } = {}) {
  const width = terminalWidth();
  const badge =
    kind === "ok"
      ? color(ui.green, "OK ")
      : kind === "error"
        ? color(ui.red, "ERR")
        : color(ui.cyan, "...");
  console.log(`  ${dockLine(`${badge} ${message}`, width)}`);
  if (close) console.log(`  ${dockBottom(width)}`);
  if (kind === "error") leaveFullscreen();
}

function createRuntimeStatusReporter() {
  let closed = false;

  const ensureOpened = () => {
    updateBootStep("runtime", {
      status: "active",
      detail: "Checking packaged runtime...",
    });
  };

  const shouldClose = (message) => {
    return /Packaged local runtime ready|failed/i.test(message) && !closed;
  };

  const markClosed = () => {
    closed = true;
  };

  return {
    log(message) {
      ensureOpened();
      if (!appendBootStepLog("runtime", message)) {
        printStatusRow("log", message);
      }
    },
    ok(message) {
      ensureOpened();
      const close = shouldClose(message);
      const status = close ? "ok" : "active";
      if (!appendBootStepLog("runtime", message, status)) {
        printStatusRow("ok", message, { close });
      }
      if (close) markClosed();
    },
    error(message) {
      ensureOpened();
      const close = shouldClose(message);
      if (!appendBootStepLog("runtime", message, "error")) {
        printStatusRow("error", message, { close });
      }
      if (close) markClosed();
    },
  };
}

function createSpinner(text) {
  const frames = ["◐", "◓", "◑", "◒"];
  let i = 0;
  let active = true;
  const startedAt = Date.now();
  const width = terminalWidth();
  const phase = phaseLabel(text);
  const stepKey = stepKeyForPhase(phase);

  if (stepKey && updateBootStep(stepKey, { status: "active", detail: text })) {
    setBootFooter(`Running ${text.replace(/\.$/, "")}`);
  } else {
    clearFullscreen();
    console.log(`  ${dockTop(phase, width)}`);
  }

  const write = () => {
    if (stepKey && bootUi) {
      updateBootStep(stepKey, {
        status: "active",
        detail: text,
      });
      return;
    }

    const frame = color(ui.cyan, frames[i++ % frames.length]);
    const phaseName = color(ui.magenta, phase.padEnd(12, " "));
    const shimmer = color(ui.dim, renderShimmer(i));
    const elapsed = color(ui.dim, formatElapsed(startedAt));
    const content = `${frame} ${phaseName} ${shimmer} ${color(ui.bold, text)} ${elapsed}`;
    process.stdout.write(`\x1b[2K\r  ${dockLine(content, width)}`);
  };

  const id = setInterval(() => {
    write();
  }, 80);

  const clear = () => {
    if (!active) return false;
    active = false;
    clearInterval(id);
    activeSpinner = null;
    return true;
  };

  const spinner = {
    update(msg) {
      text = msg;
      write();
    },
    succeed(msg) {
      if (!clear()) return;
      if (stepKey && updateBootStep(stepKey, {
        status: "ok",
        detail: msg,
        logs: [msg],
      })) {
        setBootFooter(`${msg} ${formatElapsed(startedAt)}`);
        return;
      }
      const content = `${color(ui.green, "OK ")} ${color(ui.bold, msg)} ${color(ui.dim, formatElapsed(startedAt))}`;
      process.stdout.write(
        `\x1b[2K\r  ${dockLine(content, width)}\n  ${dockBottom(width)}\n`,
      );
    },
    fail(msg) {
      if (!clear()) return;
      if (stepKey && updateBootStep(stepKey, {
        status: "error",
        detail: msg,
        logs: [msg],
      })) {
        leaveFullscreen();
        return;
      }
      const content = `${color(ui.red, "ERR")} ${color(ui.bold, msg)}`;
      process.stdout.write(`\x1b[2K\r  ${dockLine(content, width)}\n  ${dockBottom(width)}\n`);
      leaveFullscreen();
    },
    stop(msg) {
      if (!clear()) return;
      if (stepKey && msg && updateBootStep(stepKey, { status: "active", detail: msg })) {
        return;
      }
      if (msg) {
        const content = `${color(ui.dim, "...")} ${msg}`;
        process.stdout.write(`\x1b[2K\r  ${dockLine(content, width)}\n  ${dockBottom(width)}\n`);
      } else {
        process.stdout.write(`\x1b[2K\r  ${dockBottom(width)}\n`);
      }
    },
  };

  write();
  activeSpinner = spinner;
  return spinner;
}

function stepKeyForPhase(phase) {
  if (phase === "runtime") return "runtime";
  if (phase === "data plane") return "data";
  if (phase === "web") return "web";
  if (phase === "agents") return "agents";
  if (phase === "verify") return "verify";
  return null;
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

function phaseLabel(text) {
  if (/mongo|redis/i.test(text)) return "data plane";
  if (/runtime|packaged/i.test(text)) return "runtime";
  if (/web/i.test(text)) return "web";
  if (/worker|agent/i.test(text)) return "agents";
  if (/health/i.test(text)) return "verify";
  if (/stop|shutting/i.test(text)) return "shutdown";
  if (/reset/i.test(text)) return "reset";
  return "task";
}

function renderShimmer(tick) {
  const width = 18;
  const active = tick % width;
  let out = "";
  for (let n = 0; n < width; n++) {
    out += n === active ? "━" : "─";
  }
  return out;
}

function formatElapsed(startedAt) {
  return formatDuration(startedAt, Date.now());
}

function formatDuration(startedAt, finishedAt) {
  const seconds = Math.max(0.1, (finishedAt - startedAt) / 1000);
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function printReadyPanel({
  publicUrl,
  dataPath,
  logsPath,
  updateUrl,
  opensBrowser = true,
}) {
  if (setBootReady({ publicUrl, dataPath, logsPath, updateUrl, opensBrowser })) {
    return;
  }

  clearFullscreen();
  const inner = terminalWidth() - 4;
  printPanel(
    [
      centerLine(color(ui.green, color(ui.bold, "Second is running locally")), inner),
      centerLine(color(ui.dim, "Your agent-native workspace is ready."), inner),
      "",
      `${label("Local")} ${color(ui.cyan, publicUrl)}`,
      `${label("Data")} ${dataPath}`,
      `${label("Logs")} ${logsPath}`,
      `${label("Update")} ${updateUrl}`,
      "",
      color(
        ui.dim,
        opensBrowser
          ? "Press Ctrl+C to stop. The browser opens automatically in a few seconds."
          : "Press Ctrl+C to stop. The desktop app will open this workspace.",
      ),
    ],
    { title: color(ui.green, "ready") },
  );
}

function writeOpeningCountdown(publicUrl, seconds) {
  if (setBootFooter(`Opening ${publicUrl} in ${seconds}s...`)) {
    return;
  }

  const shimmer = color(ui.dim, renderShimmer(seconds));
  const width = terminalWidth();
  const content = `${color(ui.cyan, "◒")} ${color(ui.bold, "Opening browser")} ${shimmer} ${publicUrl} in ${seconds}s`;
  process.stdout.write(
    `\x1b[2K\r  ${dockLine(content, width)}`,
  );
}

function writeOpenedBrowser(publicUrl) {
  if (setBootFooter(`Opened ${publicUrl}. Press Ctrl+C to stop Second.`)) {
    return;
  }

  const width = terminalWidth();
  const content = `${color(ui.green, "OK ")} Opened ${color(ui.cyan, publicUrl)}`;
  process.stdout.write(
    `\x1b[2K\r  ${dockLine(content, width)}\n\n`,
  );
}

function printNotice(title, detail) {
  const inner = terminalWidth() - 4;
  printPanel(
    [
      centerLine(color(ui.bold, title), inner),
      "",
      color(ui.dim, detail),
    ],
    { title: "Second" },
  );
}

function openBrowser(url) {
  try {
    const cmd =
      process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : ["xdg-open", url];
    spawn(cmd[0], cmd.slice(1), { stdio: "ignore", detached: true }).unref();
  } catch {
    // not critical
  }
}

function shortPath(p) {
  const home = homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

function warnAboutRemovedContainerFlags() {
  if (flag("--image") || process.env.SECOND_WEB_IMAGE) {
    console.warn(
      "Warning: --image / SECOND_WEB_IMAGE is ignored. The local CLI now runs the packaged native web server instead of a container image.",
    );
  }
}

function printStartupBanner() {
  if (process.env.SECOND_CLI_QUIET === "1") return;

  const launchMode =
    process.env.SECOND_LAUNCHED_BY_CLI === "1"
      ? "npx launcher handoff"
      : "packaged runtime";
  initBootUi({ launchMode });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setInterruptHandler(fn) {
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.removeAllListeners(sig);
    process.on(sig, fn);
  }
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
  --port <number>       Web port (default: ${DEFAULT_PORT})
  --no-open             Do not open an external browser after startup
  --disable-telemetry   Disable product analytics
  --no-analytics        Alias for --disable-telemetry
  -h, --help            Show this help

Environment:
  SECOND_MONGOD_PATH       Optional override for a mongod binary
  SECOND_REDIS_SERVER_PATH Optional override for a redis-server binary
  SECOND_WEB_SERVER_PATH    Path to a Next standalone server.js override
  SECOND_NO_AUTH_SESSION_SECRET
                            Override the local no-auth session secret
  INTERNAL_API_TOKEN        Override the local web/worker token
`);
}
