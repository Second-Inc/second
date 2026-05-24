import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import {
  createSecondLocalSupervisor,
  currentRuntimeId,
  resolveSupervisorEntrypoint,
} from "@second-inc/local-supervisor";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ManagedWslSecondRuntime } from "./windows-wsl-runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3030;

let mainWindow = null;
let runtime = null;
let quitAfterRuntimeStop = false;
let startPromise = null;
let lastStatusEvent = null;

app.setName("Second");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  runtime = createRuntime();
  wireRuntime(runtime);
  registerIpc();
  createMainWindow();
  installMenu();
  startPromise = startRuntime();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on("before-quit", (event) => {
  if (quitAfterRuntimeStop || !runtime) return;
  event.preventDefault();
  quitAfterRuntimeStop = true;
  runtime
    .stop()
    .catch((err) => {
      sendStatus({
        status: "error",
        step: "shutdown",
        message: err.message,
      });
    })
    .finally(() => app.quit());
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
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

  mainWindow.loadFile(join(__dirname, "..", "renderer", "startup.html"));
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

  return createSecondLocalSupervisor({
    port,
    entrypoint,
    nodePath: resolvePackagedNodePath(),
    nodeEnv: {
      ELECTRON_RUN_AS_NODE: "1",
    },
    env: {
      SECOND_DESKTOP: "1",
      SECOND_LOCAL_NO_OPEN: "1",
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
    if (process.env.SECOND_DESKTOP_DEBUG === "1") {
      console.log(`[${event.stream}] ${event.line}`);
    }
  });
}

async function startRuntime() {
  try {
    sendStatus({
      status: "starting",
      step: "runtime",
      message: "Starting Second",
    });
    const ready = await runtime.start();
    sendStatus({
      status: "ready",
      step: "ready",
      message: "Opening Second",
      publicUrl: ready.publicUrl,
    });
    await mainWindow?.loadURL(ready.publicUrl);
  } catch (err) {
    sendStatus({
      status: "error",
      step: "runtime",
      message: err.message,
      code: err.code,
    });
    await mainWindow?.loadFile(join(__dirname, "..", "renderer", "startup.html"));
  }
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
