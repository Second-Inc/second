import { createServer } from "node:http";
import { readFileSync, watch } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rendererDir = resolve(
  fileURLToPath(new URL("../src/renderer", import.meta.url)),
);
const host = "127.0.0.1";
const requestedPort = Number(process.env.PORT ?? 4179);
const clients = new Set();

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${requestedPort}`);

  if (url.pathname === "/__startup-preview/reload.js") {
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(`
const source = new EventSource("/__startup-preview/events");
source.addEventListener("reload", () => window.location.reload());
`);
    return;
  }

  if (url.pathname === "/__startup-preview/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  const filePath = resolveRendererPath(url.pathname);
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  try {
    let body = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes.get(ext) ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });

    if (ext === ".html") {
      body = Buffer.from(injectReloadScript(body.toString("utf8")));
    }

    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(requestedPort, host, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  const url = `http://${host}:${port}/startup.html?preview=1`;
  console.log(url);
  openBrowser(url);
});

watch(rendererDir, { recursive: false }, (_event, filename) => {
  if (!filename || !/\.(html|css|js)$/.test(filename)) return;
  for (const client of clients) {
    client.write("event: reload\n");
    client.write(`data: ${JSON.stringify({ file: filename })}\n\n`);
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${requestedPort} is already in use. Set PORT=4180 or another port and retry.`,
    );
    process.exit(1);
  }
  throw err;
});

function resolveRendererPath(pathname) {
  const requested =
    pathname === "/" ? "startup.html" : decodeURIComponent(pathname.slice(1));
  const normalized = normalize(requested);
  if (normalized.startsWith("..") || normalized.includes(`${sep}..${sep}`)) {
    return null;
  }

  const filePath = resolve(rendererDir, normalized);
  if (!filePath.startsWith(`${rendererDir}${sep}`)) return null;
  return filePath;
}

function injectReloadScript(html) {
  const script = '<script src="/__startup-preview/reload.js"></script>';
  if (html.includes(script)) return html;
  return html.replace("</body>", `    ${script}\n  </body>`);
}

function openBrowser(url) {
  const opener =
    process.platform === "darwin"
      ? { command: "open", args: [url] }
      : process.platform === "win32"
        ? { command: "cmd", args: ["/c", "start", "", url] }
        : { command: "xdg-open", args: [url] };

  spawn(opener.command, opener.args, { stdio: "ignore", detached: true }).unref();
}
