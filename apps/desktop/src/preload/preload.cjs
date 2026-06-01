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
  restartComputer() {
    return ipcRenderer.invoke("second:restartComputer");
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
    const root = document.documentElement;
    if (!root) return;
    if (root.dataset.secondDesktop !== "true") {
      root.dataset.secondDesktop = "true";
    }
    if (root.dataset.secondDesktopPlatform !== process.platform) {
      root.dataset.secondDesktopPlatform = process.platform;
    }
  };

  const start = () => {
    const root = document.documentElement;
    if (!root) return;
    apply();
    // Re-apply if a client framework (e.g. React hydration) strips the marker.
    new MutationObserver(apply).observe(root, {
      attributes: true,
      attributeFilter: ["data-second-desktop", "data-second-desktop-platform"],
    });
  };

  // The preload runs while the document may still be parsing, so
  // document.documentElement can be null. Touching it then throws and aborts
  // the entire preload, which silently disables every -webkit-app-region rule
  // (the desktop marker attributes never get set). Wait until the DOM exists.
  if (document.documentElement) {
    start();
  } else {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  }
}
