const { contextBridge, ipcRenderer } = require("electron");

const allowedStatusFields = new Set([
  "status",
  "step",
  "message",
  "publicUrl",
  "code",
  "at",
]);

contextBridge.exposeInMainWorld("secondDesktop", {
  onStatus(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => {
      callback(filterStatusPayload(payload));
    };
    ipcRenderer.on("second:status-event", listener);
    return () => ipcRenderer.removeListener("second:status-event", listener);
  },
  status() {
    return ipcRenderer.invoke("second:status");
  },
  lastStatus() {
    return ipcRenderer.invoke("second:lastStatus");
  },
  logs() {
    return ipcRenderer.invoke("second:logs");
  },
  diagnostics() {
    return ipcRenderer.invoke("second:diagnostics");
  },
  restart() {
    return ipcRenderer.invoke("second:restart");
  },
  reset() {
    return ipcRenderer.invoke("second:reset");
  },
  openLogs() {
    return ipcRenderer.invoke("second:openLogs");
  },
  copyDiagnostics() {
    return ipcRenderer.invoke("second:copyDiagnostics");
  },
});

markDesktopShell();

function filterStatusPayload(payload) {
  const safe = {};
  if (!payload || typeof payload !== "object") return safe;
  for (const [key, value] of Object.entries(payload)) {
    if (allowedStatusFields.has(key)) safe[key] = value;
  }
  return safe;
}

function markDesktopShell() {
  const apply = () => {
    document.documentElement.dataset.secondDesktop = "true";
    document.documentElement.dataset.secondDesktopPlatform = process.platform;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
    return;
  }

  apply();
}
