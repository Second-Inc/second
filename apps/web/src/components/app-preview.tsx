"use client";

import { useMemo, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import {
  DEFAULT_WORKSPACE_APP_RUNTIME_SETTINGS,
  type WorkspaceAppRuntimeSettings,
} from "@/lib/workspace-app-runtime-settings";

type AppPreviewProps = {
  files: Record<string, string> | null;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
  runtimeSettings?: WorkspaceAppRuntimeSettings;
};

/**
 * Legacy fallback renderer for older ArrowJS snapshots.
 */
function buildLegacyPreviewHtml(
  mainTs: string,
  mainCss: string,
): string {
  // Escape closing script tags inside user code
  const safeCode = mainTs.replace(/<\/script>/gi, "<\\/script>");
  const safeCss = mainCss.replace(/<\/style>/gi, "<\\/style>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<script src="https://cdn.tailwindcss.com"></script>
<script type="importmap">
{"imports":{"@arrow-js/core":"https://esm.sh/@arrow-js/core"}}
</script>
<style>${safeCss}</style>
</head>
<body class="min-h-screen">
<div id="app"></div>
<script>
window.onerror = function(msg, src, line) {
  document.getElementById("app").innerHTML =
    '<pre style="color:#ef4444;padding:1rem;font-size:13px;white-space:pre-wrap">'
    + msg + (line ? ' (line ' + line + ')' : '') + '</pre>';
};
</script>
<script type="module">
${safeCode}
</script>
</body>
</html>`;
}

function isLocalAssetReference(value: string): boolean {
  const trimmed = value.trim();
  return !/^(https?:|data:|blob:|mailto:|tel:|javascript:|#)/i.test(trimmed);
}

function mimeTypeFor(path: string): string {
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".map")) return "application/json";
  if (path.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

function buildArtifactPreviewHtml(files: Record<string, string>): string | null {
  if (typeof DOMParser === "undefined" || typeof btoa === "undefined") {
    return null;
  }

  const indexHtml = files["dist/index.html"];
  if (!indexHtml) return null;

  const distFiles = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith("dist/")) continue;
    distFiles.set(path.slice("dist/".length), content);
  }

  const dataUrlCache = new Map<string, string>();
  const inProgress = new Set<string>();

  function resolvePath(fromFile: string, reference: string): string | null {
    if (!isLocalAssetReference(reference)) return null;
    const cleanReference = reference.split("#")[0]?.split("?")[0]?.trim();
    if (!cleanReference) return null;
    let resolved = "";
    try {
      resolved = new URL(cleanReference, `https://artifact.local/${fromFile}`)
        .pathname
        .replace(/^\/+/, "");
    } catch {
      return null;
    }

    return resolved || null;
  }

  function rewriteJsImports(code: string, fromFile: string): string {
    const rewrite = (specifier: string): string => {
      const resolved = resolvePath(fromFile, specifier);
      if (!resolved) return specifier;
      const dataUrl = getDataUrl(resolved);
      return dataUrl ?? specifier;
    };

    let result = code;
    const patterns = [
      /(\bimport\s+[^'"]*?\bfrom\s*["'])([^"']+)(["'])/g,
      /(\bexport\s+[^'"]*?\bfrom\s*["'])([^"']+)(["'])/g,
      /(\bimport\s*["'])([^"']+)(["'])/g,
      /(\bimport\s*\(\s*["'])([^"']+)(["']\s*\))/g,
    ];

    for (const pattern of patterns) {
      result = result.replace(
        pattern,
        (_match, prefix: string, specifier: string, suffix: string) =>
          `${prefix}${rewrite(specifier)}${suffix}`,
      );
    }

    return result;
  }

  function rewriteCssUrls(css: string, fromFile: string): string {
    return css.replace(
      /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
      (match, quote: string, rawUrl: string) => {
        const resolved = resolvePath(fromFile, rawUrl);
        if (!resolved) return match;
        const dataUrl = getDataUrl(resolved);
        if (!dataUrl) return match;
        const q = quote || "\"";
        return `url(${q}${dataUrl}${q})`;
      },
    );
  }

  function getDataUrl(path: string): string | null {
    const normalized = path.replace(/^\/+/, "");
    if (dataUrlCache.has(normalized)) {
      return dataUrlCache.get(normalized)!;
    }

    const content = distFiles.get(normalized);
    if (content == null) return null;
    if (inProgress.has(normalized)) return null;

    inProgress.add(normalized);

    let rewrittenContent = content;
    if (normalized.endsWith(".js") || normalized.endsWith(".mjs")) {
      rewrittenContent = rewriteJsImports(content, normalized);
    } else if (normalized.endsWith(".css")) {
      rewrittenContent = rewriteCssUrls(content, normalized);
    }

    const dataUrl = `data:${mimeTypeFor(normalized)};base64,${toBase64(rewrittenContent)}`;
    dataUrlCache.set(normalized, dataUrl);
    inProgress.delete(normalized);
    return dataUrl;
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(indexHtml, "text/html");

  // Inline built module scripts from dist.
  for (const script of Array.from(document.querySelectorAll("script[src]"))) {
    const src = script.getAttribute("src");
    if (!src) continue;
    const resolved = resolvePath("index.html", src);
    if (!resolved) continue;
    const dataUrl = getDataUrl(resolved);
    if (!dataUrl) continue;

    const replacement = document.createElement("script");
    const typeAttr = (script.getAttribute("type") ?? "").toLowerCase();
    if (!typeAttr || typeAttr === "module") {
      replacement.type = "module";
      replacement.textContent = `import ${JSON.stringify(dataUrl)};`;
    } else {
      replacement.textContent = distFiles.get(resolved) ?? "";
    }
    script.replaceWith(replacement);
  }

  // Inline built CSS and drop modulepreload entries.
  for (const link of Array.from(document.querySelectorAll("link[href]"))) {
    const href = link.getAttribute("href");
    if (!href) continue;

    const rel = (link.getAttribute("rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const resolved = resolvePath("index.html", href);
    if (!resolved) continue;

    if (rel.includes("modulepreload")) {
      link.remove();
      continue;
    }

    if (rel.includes("stylesheet")) {
      const cssContent = distFiles.get(resolved);
      if (!cssContent) continue;

      const style = document.createElement("style");
      style.textContent = rewriteCssUrls(cssContent, resolved);
      link.replaceWith(style);
    }
  }

  // Rewrite remaining local asset references (images, manifests, etc.) to data URLs.
  for (const element of Array.from(document.querySelectorAll("[src], [href]"))) {
    const tagName = element.tagName.toLowerCase();
    if (tagName === "script") continue;

    for (const attr of ["src", "href"] as const) {
      const raw = element.getAttribute(attr);
      if (!raw) continue;
      const resolved = resolvePath("index.html", raw);
      if (!resolved) continue;
      const dataUrl = getDataUrl(resolved);
      if (!dataUrl) continue;
      element.setAttribute(attr, dataUrl);
    }
  }

  // Runtime error fallback in preview iframe.
  if (document.body) {
    const errorScript = document.createElement("script");
    errorScript.textContent = `
window.addEventListener("error", function(event) {
  var root = document.getElementById("root") || document.body;
  root.innerHTML = '<pre style="color:#ef4444;padding:1rem;font-size:13px;white-space:pre-wrap">' +
    (event && event.message ? event.message : "Runtime error") + '</pre>';
});
`;
    document.body.prepend(errorScript);
  }

  return `<!DOCTYPE html>\n${document.documentElement.outerHTML}`;
}

function sandboxForSettings(settings: WorkspaceAppRuntimeSettings): string {
  // Keep allow-same-origin out of the sandbox so generated apps never regain
  // parent-origin privileges.
  const tokens = ["allow-modals", "allow-forms"];

  if (settings.allowIframeScripts) {
    tokens.unshift("allow-scripts");
  }

  if (settings.allowIframeExternalLinks) {
    tokens.push("allow-popups", "allow-popups-to-escape-sandbox");
  }

  return tokens.join(" ");
}

function permissionsPolicyForSettings(
  settings: WorkspaceAppRuntimeSettings,
): string | undefined {
  const permissions = [];

  if (settings.allowIframeClipboard) {
    permissions.push("clipboard-write");
  }

  return permissions.length > 0 ? permissions.join("; ") : undefined;
}

export function AppPreview({
  files,
  iframeRef,
  runtimeSettings = DEFAULT_WORKSPACE_APP_RUNTIME_SETTINGS,
}: AppPreviewProps) {
  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const iframeSrcDoc = useMemo(() => {
    if (!isHydrated || !files) return null;

    // Artifact-first mode: compiled Vite output from dist/
    const artifactPreview = buildArtifactPreviewHtml(files);
    if (artifactPreview) return artifactPreview;

    // Legacy fallback for old ArrowJS snapshots.
    const code = files["main.js"] ?? files["main.ts"] ?? null;
    if (!code) return null;
    const mainCss = files["main.css"] ?? "";
    return buildLegacyPreviewHtml(code, mainCss);
  }, [files, isHydrated]);

  if (!iframeSrcDoc) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">Waiting for build...</span>
        </div>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={iframeSrcDoc}
      sandbox={sandboxForSettings(runtimeSettings)}
      allow={permissionsPolicyForSettings(runtimeSettings)}
      className="h-full w-full border-0 bg-background"
      title="App preview"
    />
  );
}
