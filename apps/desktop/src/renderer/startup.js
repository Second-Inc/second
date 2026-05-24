const orderedSteps = /Windows/i.test(navigator.userAgent)
  ? ["runtime", "wsl", "data", "web", "agents", "ready"]
  : ["runtime", "data", "web", "agents", "ready"];
const headline = document.getElementById("headline");
const message = document.getElementById("message");
const restartButton = document.getElementById("restart");
const logsButton = document.getElementById("logs");
const diagnosticsButton = document.getElementById("diagnostics");

let currentStep = "runtime";

for (const item of document.querySelectorAll("[data-step]")) {
  const step = item.getAttribute("data-step");
  if (!orderedSteps.includes(step)) item.remove();
}

window.secondDesktop?.onStatus((event) => {
  if (!event || !event.step) return;
  currentStep = event.step;
  updateSteps(event);
  updateCopy(event);
});

restartButton?.addEventListener("click", async () => {
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
  if (!status?.running) return;
  updateCopy({
    status: "starting",
    step: "runtime",
    message: `Second is running at ${status.publicUrl}`,
  });
});

window.secondDesktop?.lastStatus().then((event) => {
  if (!event) return;
  currentStep = event.step || currentStep;
  updateSteps(event);
  updateCopy(event);
});

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
  headline.textContent = isError ? "Second needs attention" : headlineFor(event.step);
  message.textContent = event.message || "Starting Second";
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

function setBusy(text) {
  updateCopy({
    status: "starting",
    step: currentStep,
    message: text,
  });
}
