"use client";

import { useCallback, useEffect, useState } from "react";
import { DownloadCloud, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LocalReleaseStatus = {
  enabled: boolean;
  reachable: boolean;
  packageName?: string;
  currentVersion?: string;
  latestVersion?: string | null;
  runtime?: string;
  updateAvailable: boolean;
  updating: boolean;
  error?: { code: string; message: string };
};

type LocalReleaseUpdateResponse = {
  enabled: boolean;
  accepted: boolean;
  updating: boolean;
  error?: { code: string; message: string };
};

const LOCAL_RELEASE_POLL_MS = 5 * 60 * 1000;
const LOCAL_RELEASE_RELOAD_DELAY_MS = 3_000;
const LOCAL_RELEASE_RELOAD_TIMEOUT_MS = 120_000;
const LOCAL_RELEASE_RELOAD_POLL_MS = 2_000;

export function LocalReleaseUpdateCallout() {
  const [status, setStatus] = useState<LocalReleaseStatus | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = updating || status?.updating === true;
  const visible =
    status?.enabled === true &&
    (status.updateAvailable || busy || Boolean(error));
  const versionLabel =
    busy
      ? "Usually takes 10-30s"
      : status?.updateAvailable && status.latestVersion
        ? `${formatVersionLabel(status.currentVersion)} -> ${formatVersionLabel(
            status.latestVersion,
          )}`
        : "Local runtime";

  const fetchStatus = useCallback(async () => {
    const response = await fetch("/api/local-release/status", {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as LocalReleaseStatus;
  }, []);

  const applyStatus = useCallback((nextStatus: LocalReleaseStatus) => {
    setStatus(nextStatus);
    if (nextStatus.updating) {
      setUpdating(true);
    } else if (!nextStatus.updateAvailable) {
      setUpdating(false);
    }
    if (nextStatus.reachable) {
      setError(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const refresh = async () => {
      try {
        const nextStatus = await fetchStatus();
        if (cancelled || !nextStatus) return;
        applyStatus(nextStatus);
        if (nextStatus.enabled && intervalId === null) {
          intervalId = window.setInterval(refresh, LOCAL_RELEASE_POLL_MS);
        }
      } catch {
        // Release checks are best-effort and must never block the app.
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    void refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [applyStatus, fetchStatus]);

  const waitForRestart = useCallback((targetVersion?: string | null) => {
    const startedAt = Date.now();

    const poll = async () => {
      try {
        const nextStatus = await fetchStatus();
        if (nextStatus) {
          applyStatus(nextStatus);
          const targetReached = targetVersion
            ? nextStatus.currentVersion === targetVersion
            : !nextStatus.updating;
          if (!nextStatus.updating && targetReached) {
            window.location.reload();
            return;
          }
        }
      } catch {
        // The local app normally disappears briefly during supervisor restart.
      }

      if (Date.now() - startedAt > LOCAL_RELEASE_RELOAD_TIMEOUT_MS) {
        setUpdating(false);
        setError(
          "Still updating. If this does not recover, restart from the terminal.",
        );
        return;
      }

      window.setTimeout(poll, LOCAL_RELEASE_RELOAD_POLL_MS);
    };

    window.setTimeout(poll, LOCAL_RELEASE_RELOAD_DELAY_MS);
  }, [applyStatus, fetchStatus]);

  const installUpdate = useCallback(async () => {
    if (busy) return;

    const targetVersion = status?.latestVersion;
    setUpdating(true);
    setError(null);
    setStatus((current) =>
      current ? { ...current, updating: true } : current,
    );

    try {
      const response = await fetch("/api/local-release/update", {
        method: "POST",
      });
      const data = (await response.json()) as LocalReleaseUpdateResponse;

      if (!response.ok || !data.accepted) {
        throw new Error(data.error?.message ?? "Could not start the update.");
      }

      waitForRestart(targetVersion);
    } catch (updateError) {
      const message =
        updateError instanceof Error
          ? updateError.message
          : "Could not start the update.";
      setUpdating(false);
      try {
        const nextStatus = await fetchStatus();
        if (nextStatus) applyStatus(nextStatus);
      } catch {
        // best effort
      }
      setError(message);
    }
  }, [applyStatus, busy, fetchStatus, status?.latestVersion, waitForRestart]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] w-[min(360px,calc(100vw-32px))]">
      <div
        className={cn(
          "pointer-events-auto rounded-lg border border-border/80 bg-background/95 p-3 text-foreground shadow-xl shadow-black/10 backdrop-blur",
          "dark:border-white/10 dark:bg-zinc-950/95 dark:shadow-black/40",
        )}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <DownloadCloud className="size-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {busy ? "Updating Second" : "Second update available"}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {versionLabel}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 gap-1.5"
            disabled={busy}
            onClick={installUpdate}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {busy ? "Updating" : "Update"}
          </Button>
        </div>
        {error ? (
          <p className="mt-2 text-xs leading-snug text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function formatVersionLabel(value: string | null | undefined): string {
  if (!value) return "current";
  return value.startsWith("v") ? value : `v${value}`;
}
