const params = new URLSearchParams(window.location.search);
const previewMode = params.has("preview");
const previewPlatform = params.get("platform");
const orderedSteps = (previewPlatform === "windows" || (!previewPlatform && /Windows/i.test(navigator.userAgent)))
  ? ["runtime", "wsl", "data", "web", "agents", "ready"]
  : ["runtime", "data", "web", "agents", "ready"];
const headline = document.getElementById("headline");
const statusTitle = document.getElementById("status-title");
const statusLine = document.getElementById("status-line");
const message = document.getElementById("message");
const progress = document.getElementById("progress");
const percent = document.getElementById("percent");
const developerDetails = document.getElementById("developer-details");
const restartButton = document.getElementById("restart");
const logsButton = document.getElementById("logs");
const diagnosticsButton = document.getElementById("diagnostics");

let currentStep = "runtime";
let currentProgress = 8;
let hasRuntimeError = false;

for (const item of document.querySelectorAll("[data-step]")) {
  const step = item.getAttribute("data-step");
  if (!orderedSteps.includes(step)) item.remove();
}

restartButton?.addEventListener("click", async () => {
  hasRuntimeError = false;
  setBusy("Restarting Second");
  if (previewMode) {
    applyPreviewState("runtime");
    return;
  }
  await window.secondDesktop?.restart();
});

logsButton?.addEventListener("click", async () => {
  if (previewMode) return;
  await window.secondDesktop?.openLogs();
});

diagnosticsButton?.addEventListener("click", async () => {
  if (previewMode) {
    diagnosticsButton.textContent = "Copied";
    setTimeout(() => {
      diagnosticsButton.textContent = "Copy diagnostics";
    }, 1200);
    return;
  }
  await window.secondDesktop?.copyDiagnostics();
  diagnosticsButton.textContent = "Copied";
  setTimeout(() => {
    diagnosticsButton.textContent = "Copy diagnostics";
  }, 1200);
});

if (previewMode) {
  startPreviewMode();
} else {
  window.secondDesktop?.onStatus((event) => {
    applyStatusEvent(event);
  });

  window.secondDesktop?.status().then((status) => {
    if (hasRuntimeError || !status?.running || !status?.ready) return;
    updateCopy({
      status: "ready",
      step: "ready",
      message: `Second is running at ${status.publicUrl}`,
    });
  });

  window.secondDesktop?.lastStatus().then((event) => {
    applyStatusEvent(event);
  });
}

function applyStatusEvent(event) {
  if (!event || !event.step) return;
  if (hasRuntimeError && event.status !== "error" && event.status !== "ready") {
    return;
  }
  hasRuntimeError = event.status === "error";
  currentStep = displayStepFor(event.step);
  updateSteps(event);
  updateCopy(event);
}

function updateSteps(event) {
  const displayStep = displayStepFor(event.step);
  const activeIndex = Math.max(0, orderedSteps.indexOf(displayStep));
  for (const item of document.querySelectorAll("[data-step]")) {
    const step = item.getAttribute("data-step");
    const index = orderedSteps.indexOf(step);
    item.classList.toggle("done", index < activeIndex || event.status === "ready");
    item.classList.toggle("active", step === displayStep && event.status !== "error");
    item.classList.toggle("error", step === displayStep && event.status === "error");
  }
}

function updateCopy(event) {
  const isError = event.status === "error";
  const nextProgress = progressFor(event);
  currentProgress = Math.max(currentProgress, nextProgress);

  headline.textContent = isError ? "Second needs attention" : "Loading Second";
  statusTitle.textContent = isError
    ? "Second needs attention"
    : headlineFor(displayStepFor(event.step));
  statusLine.textContent = isError
    ? (event.message || "Something went wrong")
    : stepTitleFor(displayStepFor(event.step));
  message.textContent = event.message || "Starting Second";
  progress.value = currentProgress;
  percent.textContent = `${currentProgress}%`;
  developerDetails.open = developerDetails.open || isError;
  document.body.classList.toggle("has-error", isError);
  message.classList.toggle("error", isError);
}

function headlineFor(step) {
  if (step === "wsl") return "Preparing Windows runtime";
  if (step === "data") return "Starting local data services";
  if (step === "web") return "Starting Second";
  if (step === "agents") return "Starting local agents";
  if (step === "ready") return "Opening workspace";
  return "Starting local workspace";
}

function progressFor(event) {
  if (event.status === "ready") return 100;
  if (event.status === "error") return currentProgress;
  const displayStep = displayStepFor(event.step);

  const progressByStep = orderedSteps.includes("wsl")
    ? {
        runtime: 8,
        wsl: 24,
        data: 42,
        web: 64,
        agents: 84,
        ready: 100,
      }
    : {
        runtime: 8,
        data: 38,
        web: 64,
        agents: 84,
        ready: 100,
      };

  return progressByStep[displayStep] ?? currentProgress;
}

function stepTitleFor(step) {
  const el = document.querySelector(`[data-step="${step}"] p`);
  return el?.textContent || "Loading";
}

function displayStepFor(step) {
  if (step === "health") return "web";
  return step;
}

function setBusy(text) {
  updateCopy({
    status: "starting",
    step: currentStep,
    message: text,
  });
}

function startPreviewMode() {
  document.body.dataset.preview = "true";
  createPreviewControls();
  applyPreviewState(params.get("state") || "runtime");
}

function createPreviewControls() {
  const controls = document.createElement("aside");
  controls.className = "preview-controls";
  controls.setAttribute("aria-label", "Startup preview states");

  const title = document.createElement("p");
  title.textContent = "Preview";
  controls.append(title);

  for (const state of ["runtime", "data", "web", "agents", "error", "ready"]) {
    if (state === "data" && orderedSteps.includes("wsl")) {
      addPreviewButton(controls, "wsl", "WSL");
    }
    addPreviewButton(controls, state, state);
  }

  document.body.append(controls);
}

function addPreviewButton(container, state, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.previewState = state;
  button.textContent = label;
  button.addEventListener("click", () => applyPreviewState(state));
  container.append(button);
}

function applyPreviewState(state) {
  const event = previewEventFor(state);
  if (!event) return;
  hasRuntimeError = false;
  currentProgress = event.status === "error" ? progressFor({ step: event.step }) : 8;
  applyStatusEvent(event);
  for (const button of document.querySelectorAll("[data-preview-state]")) {
    button.classList.toggle(
      "active",
      button.getAttribute("data-preview-state") === state,
    );
  }
}

function previewEventFor(state) {
  const events = {
    runtime: {
      status: "starting",
      step: "runtime",
      message: "Checking packaged local runtime",
    },
    wsl: {
      status: "starting",
      step: "wsl",
      message: "Preparing Windows runtime",
    },
    data: {
      status: "starting",
      step: "data",
      message: "Starting MongoDB and Redis",
    },
    web: {
      status: "starting",
      step: "web",
      message: "Waiting for Second at http://localhost:3030",
    },
    agents: {
      status: "starting",
      step: "agents",
      message: "Starting local agents",
    },
    ready: {
      status: "ready",
      step: "ready",
      message: "Opening workspace",
    },
    error: {
      status: "error",
      step: "runtime",
      message: "Second local runtime exited before opening the workspace",
    },
  };

  return events[state] || events.runtime;
}
