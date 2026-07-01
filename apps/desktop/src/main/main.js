import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import { spawn } from "node:child_process";
import {
  createSecondLocalSupervisor,
  currentRuntimeId,
  resolveSupervisorEntrypoint,
} from "@second-inc/local-supervisor";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ManagedWslSecondRuntime } from "./windows-wsl-runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3030;
const RESUME_AFTER_RESTART_ARG = "--second-resume-after-restart";
const DESKTOP_LOG_FILE = join(homedir(), ".second", "logs", "desktop.log");
const DESKTOP_SECRET_PATTERNS = [
  /SECOND_LOCAL_CLI_TOKEN=[^\s]+/gi,
  /SECOND_NO_AUTH_SESSION_SECRET=[^\s]+/gi,
  /INTERNAL_API_TOKEN=[^\s]+/gi,
  /mongodb:\/\/[^\s"']+/gi,
  /redis:\/\/[^\s"']+/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

let mainWindow = null;
let runtime = null;
let quitAfterRuntimeStop = false;
let quitInProgress = false;
let startPromise = null;
let lastStatusEvent = null;

app.setName("Second");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (quitInProgress) return;
  showMainWindow();
});

app.whenReady().then(async () => {
  clearWindowsRestartResumeRegistration();
  writeDesktopLog("app ready", {
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
  });
  runtime = createRuntime();
  wireRuntime(runtime);
  registerIpc();
  createMainWindow();
  installMenu();
  startPromise = startRuntime();
});

app.on("activate", () => {
  if (quitInProgress) return;
  showMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitAfterRuntimeStop || !runtime) return;
  event.preventDefault();
  if (quitInProgress) return;

  quitInProgress = true;
  if (process.platform === "darwin") {
    app.dock?.hide();
  }
  mainWindow?.destroy();
  writeDesktopLog("quit requested; stopping runtime");
  runtime
    .stop()
    .then(() => {
      writeDesktopLog("runtime stopped for quit");
    })
    .catch((err) => {
      writeDesktopLog("runtime stop failed during quit", {
        message: err.message,
        code: err.code,
        stack: err.stack,
      });
      sendStatus({
        status: "error",
        step: "shutdown",
        message: err.message,
      });
    })
    .finally(() => {
      quitAfterRuntimeStop = true;
      app.quit();
    });
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    title: "Second",
    show: false,
    ...(process.platform === "darwin"
      ? {
          backgroundColor: "#111113",
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 18, y: 18 },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    if (process.platform !== "darwin" || quitAfterRuntimeStop || quitInProgress) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  loadInitialWindowContent(mainWindow);
}

function showMainWindow() {
  if (quitInProgress) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}

function loadInitialWindowContent(targetWindow) {
  const status = runtime?.status();
  if (status?.ready && status.publicUrl) {
    targetWindow.loadURL(status.publicUrl).catch((err) => {
      writeDesktopLog("failed to load ready workspace", {
        message: err.message,
        publicUrl: status.publicUrl,
      });
      return targetWindow.loadFile(join(__dirname, "..", "renderer", "startup.html"));
    });
    return;
  }

  targetWindow.loadFile(join(__dirname, "..", "renderer", "startup.html"));
}

function createRuntime() {
  const port = Number(process.env.SECOND_DESKTOP_PORT ?? DEFAULT_PORT);
  if (process.platform === "win32") {
    return new ManagedWslSecondRuntime({
      port,
      userDataPath: app.getPath("userData"),
      rootfsPath:
        process.env.SECOND_DESKTOP_WSL_ROOTFS ??
        join(process.resourcesPath, "wsl", "second-wsl-rootfs.tar"),
    });
  }

  const runtimeId = currentRuntimeId();
  const entrypoint = resolveSupervisorEntrypoint({
    runtimeId,
    resourcesPath: process.resourcesPath,
    repoRoot: resolve(__dirname, "..", "..", "..", ".."),
  });
  const nodePath = resolvePackagedNodePath();

  writeDesktopLog("resolved local runtime", {
    port,
    runtimeId,
    entrypoint,
    nodePath,
  });

  return createSecondLocalSupervisor({
    port,
    reuseExistingRuntime: false,
    entrypoint,
    nodePath,
    nodeEnv: {
      ELECTRON_RUN_AS_NODE: "1",
    },
    env: {
      SECOND_DESKTOP: "1",
      SECOND_LOCAL_NO_OPEN: "1",
      SECOND_ALLOW_CODEX_LOCAL_AUTH: "1",
      SECOND_ALLOW_OPENCODE_LOCAL_AUTH: "1",
    },
  });
}

function resolvePackagedNodePath() {
  if (process.env.SECOND_DESKTOP_NODE_PATH) {
    return process.env.SECOND_DESKTOP_NODE_PATH;
  }

  if (process.platform === "darwin" && app.isPackaged) {
    const helperName = `${app.getName()} Helper`;
    const helperPath = resolve(
      dirname(process.execPath),
      "..",
      "Frameworks",
      `${helperName}.app`,
      "Contents",
      "MacOS",
      helperName,
    );
    if (existsSync(helperPath)) return helperPath;
  }

  return process.execPath;
}

function wireRuntime(target) {
  target.on("progress", (event) => sendStatus(event));
  target.on("log", (event) => {
    writeDesktopLog(`runtime ${event.stream}`, event.line);
    if (process.env.SECOND_DESKTOP_DEBUG === "1") {
      console.log(`[${event.stream}] ${event.line}`);
    }
  });
}

async function startRuntime() {
  try {
    writeDesktopLog("runtime start requested");
    sendStatus({
      status: "starting",
      step: "runtime",
      message: "Starting Second",
    });
    const ready = await runtime.start();
    writeDesktopLog("runtime ready", ready);
    sendStatus({
      status: "ready",
      step: "ready",
      message: "Opening Second",
      publicUrl: ready.publicUrl,
    });
    await mainWindow?.loadURL(ready.publicUrl);
  } catch (err) {
    writeDesktopLog("runtime start failed", {
      message: err.message,
      code: err.code,
      stack: err.stack,
    });
    sendStatus(statusEventForRuntimeError(err));
    await mainWindow?.loadFile(join(__dirname, "..", "renderer", "startup.html"));
  }
}

function statusEventForRuntimeError(err) {
  if (err?.code === "SECOND_REBOOT_REQUIRED") {
    return {
      status: "restart-required",
      step: "wsl",
      message: err.message,
      code: err.code,
    };
  }

  return {
    status: "error",
    step: "runtime",
    message: err.message,
    code: err.code,
  };
}

function registerIpc() {
  ipcMain.handle("second:status", () => runtime?.status() ?? null);
  ipcMain.handle("second:lastStatus", () => lastStatusEvent);
  ipcMain.handle("second:logs", () => runtime?.logs() ?? null);
  ipcMain.handle("second:diagnostics", () => runtime?.diagnostics() ?? null);
  ipcMain.handle("second:restart", async () => {
    const ready = await runtime.restart();
    if (ready?.publicUrl) await mainWindow?.loadURL(ready.publicUrl);
    return runtime.status();
  });
  ipcMain.handle("second:reset", async () => {
    await resetRuntimeWithPrompt();
    return runtime.status();
  });
  ipcMain.handle("second:openLogs", async () => {
    const logs = runtime.logs();
    if (!logs?.logsDir) return null;
    return shell.openPath(logs.logsDir);
  });
  ipcMain.handle("second:copyDiagnostics", async () => {
    clipboard.writeText(JSON.stringify(runtime.diagnostics(), null, 2));
    return true;
  });
  ipcMain.handle("second:restartComputer", async () => {
    if (process.platform !== "win32") return false;
    scheduleLaunchAfterWindowsRestart();
    sendStatus({
      status: "restart-required",
      step: "wsl",
      message: "Restarting Windows. Second will open again after sign-in.",
      code: "SECOND_REBOOT_REQUIRED",
    });
    const child = spawn(
      "shutdown.exe",
      [
        "/r",
        "/t",
        "5",
        "/c",
        "Second will open again after restart to finish setup.",
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    child.once("error", (err) => {
      writeDesktopLog("failed to restart Windows", {
        message: err.message,
        code: err.code,
      });
      sendStatus({
        status: "restart-required",
        step: "wsl",
        message: "Windows did not accept the restart request. Restart this PC manually, then open Second again.",
        code: "SECOND_REBOOT_REQUIRED",
      });
    });
    child.unref();
    return true;
  });
}

function scheduleLaunchAfterWindowsRestart() {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: [RESUME_AFTER_RESTART_ARG],
    });
  } catch (err) {
    writeDesktopLog("failed to schedule restart resume", {
      message: err.message,
      code: err.code,
    });
  }
}

function clearWindowsRestartResumeRegistration() {
  if (
    process.platform !== "win32" ||
    !process.argv.includes(RESUME_AFTER_RESTART_ARG)
  ) {
    return;
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: false,
      path: process.execPath,
      args: [RESUME_AFTER_RESTART_ARG],
    });
  } catch (err) {
    writeDesktopLog("failed to clear restart resume", {
      message: err.message,
      code: err.code,
    });
  }
}

function writeDesktopLog(message, details) {
  try {
    mkdirSync(dirname(DESKTOP_LOG_FILE), { recursive: true });
    const suffix =
      details === undefined
        ? ""
        : ` ${redactDesktopLogValue(
            typeof details === "string" ? details : JSON.stringify(details),
          )}`;
    appendFileSync(
      DESKTOP_LOG_FILE,
      `[${new Date().toISOString()}] ${message}${suffix}\n`,
      "utf8",
    );
  } catch {
    // Logging must never block the app from starting.
  }
}

function redactDesktopLogValue(value) {
  let output = String(value ?? "");
  for (const pattern of DESKTOP_SECRET_PATTERNS) {
    output = output.replace(pattern, "[redacted]");
  }
  return output;
}

function installMenu() {
  const template = [
    {
      label: "Second",
      submenu: [
        {
          label: "Restart Second",
          click: () => {
            startPromise = runtime.restart().then((ready) => {
              if (ready?.publicUrl) return mainWindow?.loadURL(ready.publicUrl);
              return null;
            });
          },
        },
        {
          label: "Stop Second",
          click: () => runtime.stop(),
        },
        {
          label: "Reset Local Data",
          click: () => resetRuntimeWithPrompt(),
        },
        { type: "separator" },
        {
          label: "Open Logs",
          click: async () => {
            const logs = runtime.logs();
            if (logs?.logsDir) await shell.openPath(logs.logsDir);
          },
        },
        {
          label: "Copy Diagnostics",
          click: () => {
            clipboard.writeText(JSON.stringify(runtime.diagnostics(), null, 2));
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [{ role: "close" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sendStatus(event) {
  lastStatusEvent = {
    ...event,
    at: event.at ?? new Date().toISOString(),
  };
  writeDesktopLog("status", lastStatusEvent);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("second:status-event", lastStatusEvent);
}

async function resetRuntimeWithPrompt() {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Reset", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Reset Second",
    message: "Reset local Second data?",
    detail:
      "This stops Second and removes local workspaces, apps, logs, and generated local secrets.",
  });
  if (result.response !== 0) return;
  await runtime.reset();
  startPromise = startRuntime();
}

export function currentStartPromiseForTests() {
  return startPromise;
}
