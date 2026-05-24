const orderedSteps = /Windows/i.test(navigator.userAgent)
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

window.secondDesktop?.onStatus((event) => {
  applyStatusEvent(event);
});

restartButton?.addEventListener("click", async () => {
  hasRuntimeError = false;
  setBusy("Restarting Second");
  await window.secondDesktop?.restart();
});

logsButton?.addEventListener("click", async () => {
  await window.secondDesktop?.openLogs();
});

diagnosticsButton?.addEventListener("click", async () => {
  await window.secondDesktop?.copyDiagnostics();
  diagnosticsButton.textContent = "Copied";
  setTimeout(() => {
    diagnosticsButton.textContent = "Copy diagnostics";
  }, 1200);
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

function applyStatusEvent(event) {
  if (!event || !event.step) return;
  if (hasRuntimeError && event.status !== "error" && event.status !== "ready") {
    return;
  }
  hasRuntimeError = event.status === "error";
  currentStep = event.step;
  updateSteps(event);
  updateCopy(event);
}

function updateSteps(event) {
  const activeIndex = Math.max(0, orderedSteps.indexOf(event.step));
  for (const item of document.querySelectorAll("[data-step]")) {
    const step = item.getAttribute("data-step");
    const index = orderedSteps.indexOf(step);
    item.classList.toggle("done", index < activeIndex || event.status === "ready");
    item.classList.toggle("active", step === event.step && event.status !== "error");
    item.classList.toggle("error", step === event.step && event.status === "error");
  }
}

function updateCopy(event) {
  const isError = event.status === "error";
  const nextProgress = progressFor(event);
  currentProgress = Math.max(currentProgress, nextProgress);

  headline.textContent = isError ? "Second needs attention" : "Loading Second";
  statusTitle.textContent = isError
    ? "Second needs attention"
    : headlineFor(event.step);
  statusLine.textContent = event.message || "Starting Second";
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

  return progressByStep[event.step] ?? currentProgress;
}

function setBusy(text) {
  updateCopy({
    status: "starting",
    step: currentStep,
    message: text,
  });
}
