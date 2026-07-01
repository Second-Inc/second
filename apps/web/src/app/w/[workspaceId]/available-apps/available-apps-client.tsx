"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  CheckIcon,
  DownloadIcon,
  GitBranchIcon,
  Loader2Icon,
  PackageOpenIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  abortForNavigation,
  subscribeNavigationIntent,
} from "@/lib/navigation-intent";
import { useWorkspaceRealtimeEvent } from "@/components/workspace-realtime-provider";
import type { AvailableSourceControlApp } from "@/lib/source-control/catalog";
import { cn } from "@/lib/utils";

type AvailableAppsClientProps = {
  workspaceId: string;
};

type CatalogResponse =
  | {
      connected: true;
      apps: AvailableSourceControlApp[];
    }
  | {
      connected: false;
      apps: [];
    };

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function statusBadge(item: AvailableSourceControlApp) {
  if (item.installStatus === "installed") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-transparent bg-[#eaf8ef] text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
      >
        <CheckIcon className="size-3" />
        Installed
      </Badge>
    );
  }

  if (item.installStatus === "update_available") {
    return <Badge variant="secondary">Update available</Badge>;
  }

  return <Badge variant="outline">Available</Badge>;
}

function actionLabel(item: AvailableSourceControlApp) {
  if (item.installStatus === "update_available") return "Update";
  if (item.installStatus === "installed") return "Open";
  return "Install";
}

function GitHubLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/source-control-github.svg"
      alt=""
      width={18}
      height={18}
      className={cn("shrink-0", className)}
    />
  );
}

function AvailableAppSkeletonRows() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "flex items-start gap-4 px-4 py-3",
            index > 0 && "border-t border-border",
          )}
        >
          <Skeleton className="size-9 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="mt-2 h-3 w-full max-w-md" />
            <div className="mt-2 flex flex-wrap gap-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-8 w-20 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  );
}

export function AvailableAppsClient({ workspaceId }: AvailableAppsClientProps) {
  const router = useRouter();
  const [apps, setApps] = useState<AvailableSourceControlApp[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const realtimeRefreshTimerRef = useRef<number | null>(null);

  const fetchCatalog = useCallback(async (options?: {
    signal?: AbortSignal;
    quiet?: boolean;
  }) => {
    if (!options?.quiet) setRefreshing(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/available-apps`,
        { cache: "no-store", signal: options?.signal },
      );
      if (options?.signal?.aborted) return;
      if (!response.ok) {
        setError("Could not load available apps.");
        return;
      }
      const data = (await response.json()) as CatalogResponse;
      if (options?.signal?.aborted) return;
      setConnected(data.connected);
      setApps(data.apps);
      setError(null);
    } catch {
      if (!options?.signal?.aborted) {
        setError("Could not load available apps.");
      }
    } finally {
      if (!options?.signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    const unsubscribeNavigation = subscribeNavigationIntent(() => {
      abortForNavigation(controller);
    });
    void fetchCatalog({ signal: controller.signal, quiet: true });
    return () => {
      unsubscribeNavigation();
      abortForNavigation(controller, "Available apps unmounted.");
    };
  }, [fetchCatalog]);

  useEffect(() => {
    return () => {
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
    };
  }, []);

  useWorkspaceRealtimeEvent(useCallback((event) => {
    if (
      event.workspaceId !== workspaceId ||
      event.scope !== "apps" ||
      ![
        "app.created",
        "app.updated",
        "app.deleted",
        "app.published",
      ].includes(event.type)
    ) {
      return;
    }

    if (realtimeRefreshTimerRef.current !== null) {
      window.clearTimeout(realtimeRefreshTimerRef.current);
    }
    realtimeRefreshTimerRef.current = window.setTimeout(() => {
      realtimeRefreshTimerRef.current = null;
      void fetchCatalog({ quiet: true });
    }, 150);
  }, [fetchCatalog, workspaceId]));

  const filteredApps = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return apps;
    return apps.filter((item) =>
      [
        item.title,
        item.description ?? "",
        item.owner,
        item.repo,
        item.builtBy ?? "",
        item.latestTag ?? "",
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [apps, search]);

  const handleAction = useCallback(async (item: AvailableSourceControlApp) => {
    if (item.installStatus === "installed" && item.installedAppId) {
      router.push(`/w/${workspaceId}/apps/${item.installedAppId}`);
      return;
    }

    const key = `${item.owner}/${item.repo}`;
    setBusyKey(key);
    setError(null);

    try {
      const payload = {
        provider: item.provider,
        owner: item.owner,
        repo: item.repo,
        tag: item.latestTag,
        defaultBranch: item.defaultBranch,
        version: item.version,
        commitSha: item.commitSha,
      };
      const endpoint =
        item.installStatus === "update_available" && item.installedAppId
          ? `/api/workspaces/${workspaceId}/available-apps/${encodeURIComponent(
              item.installedAppId,
            )}/update`
          : `/api/workspaces/${workspaceId}/available-apps/install`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as {
        appId?: string;
        error?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        if (
          response.status === 409 &&
          data?.error === "source_control_app_already_installed" &&
          data.appId
        ) {
          await fetchCatalog({ quiet: true });
          router.push(`/w/${workspaceId}/apps/${data.appId}`);
          return;
        }
        throw new Error(
          data?.message ?? data?.error ?? "Could not import app from GitHub.",
        );
      }

      toast.success(
        item.installStatus === "update_available"
          ? "App updated from GitHub."
          : "App installed from GitHub.",
      );
      await fetchCatalog({ quiet: true });
      if (data?.appId) {
        router.push(`/w/${workspaceId}/apps/${data.appId}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not import app from GitHub.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  }, [fetchCatalog, router, workspaceId]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-8 pt-8 pb-5">
        <div className="mx-auto max-w-5xl">
          <div
            data-second-desktop-drag-region
            className="flex flex-wrap items-start justify-between gap-4"
          >
            <div>
              <div className="flex items-center gap-2">
                <PackageOpenIcon className="size-4 text-muted-foreground" />
                <h1 className="text-lg font-semibold tracking-tight">
                  Available Apps
                </h1>
              </div>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                Apps published to your connected GitHub owner. Installing creates
                a local copy; it does not turn on source-control publishing for
                that app.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={() => void fetchCatalog()}
            >
              {refreshing ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-3.5" />
              )}
              Refresh
            </Button>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search apps, repos, authors..."
                className="h-9 pl-9 text-sm"
              />
            </div>
            <Badge variant={connected ? "secondary" : "outline"}>
              {connected ? `${apps.length} found` : "GitHub not connected"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        <div className="mx-auto max-w-5xl">
          {error ? (
            <div className="mb-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {!connected && !loading ? (
            <div className="rounded-lg border border-border bg-card px-5 py-6">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                  <GitHubLogo className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-medium">Connect GitHub</h2>
                  <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                    Available Apps uses your workspace source-control connection
                    to read repos with a Second app manifest.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    router.push(`/w/${workspaceId}/settings/source-control`)
                  }
                >
                  Settings
                  <ArrowRightIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : null}

          {connected && !loading && filteredApps.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
              <PackageOpenIcon className="mx-auto size-8 text-muted-foreground/50" />
              <h2 className="mt-3 text-sm font-medium">
                {apps.length === 0 ? "No GitHub apps found" : "No matching apps"}
              </h2>
              <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                {apps.length === 0
                  ? "Publish an app to source control, then refresh this page."
                  : "Try a different search."}
              </p>
            </div>
          ) : null}

          {loading ? (
            <AvailableAppSkeletonRows />
          ) : null}

          {connected && filteredApps.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {filteredApps.map((item, index) => {
                const key = `${item.owner}/${item.repo}`;
                const busy = busyKey === key;
                return (
                  <div
                    key={key}
                    className={cn(
                      "flex items-start gap-4 px-4 py-3",
                      index > 0 && "border-t border-border",
                    )}
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                      <GitHubLogo className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-medium">
                          {item.title}
                        </h2>
                        {statusBadge(item)}
                      </div>
                      <p className="mt-1 line-clamp-1 text-[13px] text-muted-foreground">
                        {item.description ?? "No description"}
                      </p>
                      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                          <GitHubLogo className="size-3 opacity-70" />
                          <span className="truncate">
                            {item.owner}/{item.repo}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <GitBranchIcon className="size-3" />
                          {item.latestTag ?? item.defaultBranch}
                        </span>
                        {item.version ? <span>v{item.version}</span> : null}
                        <span>Updated {formatDate(item.updatedAt)}</span>
                        {item.builtBy ? <span>By {item.builtBy}</span> : null}
                      </div>
                    </div>
                    <Button
                      variant={
                        item.installStatus === "update_available"
                          ? "default"
                          : "outline"
                      }
                      size="sm"
                      className="mt-0.5"
                      disabled={busy}
                      onClick={() => void handleAction(item)}
                    >
                      {busy ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : item.installStatus === "installed" ? (
                        <ArrowRightIcon className="size-3.5" />
                      ) : item.installStatus === "update_available" ? (
                        <RefreshCwIcon className="size-3.5" />
                      ) : (
                        <DownloadIcon className="size-3.5" />
                      )}
                      {actionLabel(item)}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
