import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const startupPath = resolve(__dirname, "..", "src", "renderer", "startup.html");

if (!existsSync(startupPath)) {
  console.error(`Could not find startup screen at ${startupPath}`);
  process.exit(1);
}

const url = pathToFileURL(startupPath);
url.searchParams.set("preview", "1");

for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.replace(/^--/, "").split("=");
  if (!key || !value) continue;
  if (key === "state" || key === "platform") {
    url.searchParams.set(key, value);
  }
}

const href = url.href;
console.log(href);

const opener =
  process.platform === "darwin"
    ? { command: "open", args: [href] }
    : process.platform === "win32"
      ? { command: "cmd", args: ["/c", "start", "", href] }
      : { command: "xdg-open", args: [href] };

const child = spawn(opener.command, opener.args, {
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
