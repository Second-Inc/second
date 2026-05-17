import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const warmups = new Map<string, Promise<boolean>>();

/** Auto-clean resolved entries after 5 minutes if done_building never consumed them. */
const SELF_CLEANUP_MS = 5 * 60 * 1000;

/**
 * Start a background `npm install` for a freshly-scaffolded workspace so that
 * dependencies are ready by the time the agent calls `done_building`.
 *
 * The worker may run with NODE_ENV=production, where npm omits devDependencies
 * by default. Generated Vite apps need dev tooling to build, so keep the
 * include explicit here.
 *
 * Keyed by workingDirectory — duplicate calls for the same directory are no-ops.
 */
export function startDependencyWarmup(workingDirectory: string): void {
  if (warmups.has(workingDirectory)) return;
  if (existsSync(join(workingDirectory, "node_modules"))) return;
  if (!existsSync(join(workingDirectory, "package.json"))) return;

  console.log(`[dep-warmup] Starting background npm install in ${workingDirectory}`);

  const promise = new Promise<boolean>((resolve) => {
    execFile(
      "npm",
      ["install", "--include=dev", "--no-audit", "--no-fund", "--prefer-offline"],
      { cwd: workingDirectory, encoding: "utf-8", timeout: 120_000 },
      (error) => {
        if (error) {
          console.error(`[dep-warmup] Failed in ${workingDirectory}:`, error.message);
          // Remove potentially partial node_modules so done_building does a
          // clean install via shouldInstallDependencies instead of seeing a
          // half-installed tree and skipping.
          try {
            rmSync(join(workingDirectory, "node_modules"), { recursive: true, force: true });
          } catch { /* best-effort */ }
          resolve(false);
        } else {
          console.log(`[dep-warmup] Completed in ${workingDirectory}`);
          resolve(true);
        }
      },
    );
  });

  // Self-clean after settling so the map doesn't grow unbounded when
  // done_building is never called (e.g. user abandons the session).
  void promise.finally(() => {
    setTimeout(() => {
      if (warmups.get(workingDirectory) === promise) {
        warmups.delete(workingDirectory);
      }
    }, SELF_CLEANUP_MS);
  });

  warmups.set(workingDirectory, promise);
}

/**
 * Wait for a pending warmup to finish (if any). Returns `true` if a warmup
 * completed successfully, `false` if it failed or none was pending.
 */
export async function awaitDependencyWarmup(workingDirectory: string): Promise<boolean> {
  const promise = warmups.get(workingDirectory);
  if (!promise) return false;
  const result = await promise;
  warmups.delete(workingDirectory);
  return result;
}
