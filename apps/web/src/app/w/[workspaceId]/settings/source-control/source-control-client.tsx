"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckIcon,
  GithubIcon,
  GitBranchIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useWorkspaceRealtimeEvent } from "@/components/workspace-realtime-provider";
import type { SourceControlSettingsReadModel } from "@/lib/workspace-settings/read-models";
import {
  abortForNavigation,
  subscribeNavigationIntent,
} from "@/lib/navigation-intent";
import { cn } from "@/lib/utils";

type SourceControlClientProps = {
  workspaceId: string;
  initialData: SourceControlSettingsReadModel | null;
};

function statusBadge(status: string) {
  if (status === "valid") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-transparent bg-[#eaf8ef] text-[11px] text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
      >
        <CheckIcon className="size-3" />
        Connected
      </Badge>
    );
  }
  if (status === "invalid" || status === "revoked") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-transparent bg-amber-50 text-[11px] text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"
      >
        <TriangleAlertIcon className="size-3" />
        Reconnect
      </Badge>
    );
  }
  return <Badge variant="outline">Not connected</Badge>;
}

function disabledProviderRow(input: {
  name: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/20 p-4 opacity-70">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
        <GitBranchIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">{input.name}</h2>
          <Badge variant="outline">{input.label}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Provider support can be added through the source-control provider interface.
        </p>
      </div>
    </div>
  );
}

export default function SourceControlClient({
  workspaceId,
  initialData,
}: SourceControlClientProps) {
  const [data, setData] = useState<SourceControlSettingsReadModel | null>(
    initialData,
  );
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetOwner, setTargetOwner] = useState("");
  const [token, setToken] = useState("");
  const [repoNamePrefix, setRepoNamePrefix] = useState("");
  const [defaultVisibility, setDefaultVisibility] =
    useState<"private" | "public">("private");
  const [storeSourceInGitHub, setStoreSourceInGitHub] = useState(false);

  const fetchSettings = useCallback(async (options?: { signal?: AbortSignal }) => {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/source-control`,
        {
          cache: "no-store",
          signal: options?.signal,
        },
      );
      if (options?.signal?.aborted) return;
      if (!response.ok) {
        setError("Could not load source control settings.");
        return;
      }
      const next = (await response.json()) as SourceControlSettingsReadModel;
      if (options?.signal?.aborted) return;
      setData(next);
      setTargetOwner(next.connection?.targetOwner ?? "");
      setRepoNamePrefix(next.connection?.repoNamePrefix ?? "");
      setDefaultVisibility(next.connection?.defaultVisibility ?? "private");
      setStoreSourceInGitHub(
        next.connection?.sourceStorageMode === "source_control",
      );
      setError(null);
    } catch {
      if (!options?.signal?.aborted) {
        setError("Could not load source control settings.");
      }
    } finally {
      if (!options?.signal?.aborted) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    const unsubscribeNavigation = subscribeNavigationIntent(() => {
      abortForNavigation(controller);
    });
    void fetchSettings({ signal: controller.signal });
    return () => {
      unsubscribeNavigation();
      abortForNavigation(controller, "Source control settings unmounted.");
    };
  }, [fetchSettings, initialData]);

  useWorkspaceRealtimeEvent(useCallback((event) => {
    if (
      event.workspaceId !== workspaceId ||
      event.scope !== "workspace-settings"
    ) {
      return;
    }
    void fetchSettings();
  }, [fetchSettings, workspaceId]));

  const save = useCallback(async () => {
    if (!data?.canManage || saving) return;
    if (!targetOwner.trim()) {
      setError("Enter the GitHub user or organization that will own app repos.");
      return;
    }
    if (!data.connection && !token.trim()) {
      setError("Paste a GitHub personal access token.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/source-control/github`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetOwner,
            token: token.trim() || undefined,
            defaultVisibility,
            repoNamePrefix: repoNamePrefix.trim() || null,
            sourceStorageMode:
              data.runtime.mode === "cloud" && storeSourceInGitHub
                ? "source_control"
                : "mongo",
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!response.ok) {
        const message = body?.message ?? "Could not connect GitHub.";
        setError(message);
        toast.error(message);
        return;
      }
      setToken("");
      toast.success("GitHub source control connected.");
      await fetchSettings();
    } catch {
      setError("Could not connect GitHub.");
      toast.error("Could not connect GitHub.");
    } finally {
      setSaving(false);
    }
  }, [
    data?.canManage,
    data?.connection,
    data?.runtime.mode,
    defaultVisibility,
    fetchSettings,
    repoNamePrefix,
    saving,
    storeSourceInGitHub,
    targetOwner,
    token,
    workspaceId,
  ]);

  const disconnect = useCallback(async () => {
    if (!data?.canManage || disconnecting) return;
    setDisconnecting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/source-control/github`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError("Could not disconnect GitHub.");
        toast.error("Could not disconnect GitHub.");
        return;
      }
      setToken("");
      toast.success("GitHub source control disconnected.");
      await fetchSettings();
    } catch {
      setError("Could not disconnect GitHub.");
      toast.error("Could not disconnect GitHub.");
    } finally {
      setDisconnecting(false);
    }
  }, [data?.canManage, disconnecting, fetchSettings, workspaceId]);

  const canManage = data?.canManage ?? false;
  const connection = data?.connection ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-8 pt-8 pb-5">
        <div className="mx-auto max-w-5xl">
          <div
            data-second-desktop-drag-region
            className="flex items-start justify-between gap-4"
          >
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Source Control
              </h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Connect GitHub so Second can store app source in repositories and, for local installs, share selected apps through Available Apps.
              </p>
            </div>
            {!canManage ? (
              <Badge variant="outline">Admin or owner required</Badge>
            ) : connection?.status === "valid" ? (
              statusBadge("valid")
            ) : (
              <Badge variant="outline">Not configured</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 pb-10">
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-5 py-3">
              <GithubIcon className="size-4 text-muted-foreground" />
              <div className="min-w-0">
                <h2 className="text-sm font-medium tracking-tight">
                  GitHub
                </h2>
                <p className="text-[12px] text-muted-foreground">
                  Repositories are private by default and marked with a root second-app.json manifest.
                </p>
              </div>
              {loading || saving ? (
                <Loader2Icon className="ml-auto size-4 animate-spin text-muted-foreground" />
              ) : (
                <div className="ml-auto">{statusBadge(connection?.status ?? "not_configured")}</div>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid gap-0 divide-y divide-border">
                <div className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_1fr]">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium">Owner</span>
                    <Input
                      value={targetOwner}
                      onChange={(event) => setTargetOwner(event.target.value)}
                      placeholder="acme"
                      disabled={!canManage || saving}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      GitHub user or organization that owns Second app repositories.
                    </span>
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium">Personal access token</span>
                    <Input
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder={connection ? "Leave blank to keep current token" : "github_pat_..."}
                      type="password"
                      disabled={!canManage || saving}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Stored in {data?.runtime.secretStorage ?? "secret storage"}.
                    </span>
                  </label>
                </div>

                <div className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_1fr]">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium">Repo name prefix</span>
                    <Input
                      value={repoNamePrefix}
                      onChange={(event) => setRepoNamePrefix(event.target.value)}
                      placeholder="second"
                      disabled={!canManage || saving}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Optional prefix for new app repositories.
                    </span>
                  </label>
                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium">Default visibility</span>
                    <div className="flex gap-2">
                      {(["private", "public"] as const).map((visibility) => (
                        <Button
                          key={visibility}
                          type="button"
                          variant={
                            defaultVisibility === visibility
                              ? "secondary"
                              : "outline"
                          }
                          className="h-8"
                          disabled={!canManage || saving}
                          onClick={() => setDefaultVisibility(visibility)}
                        >
                          {visibility === "private" ? (
                            <LockIcon data-icon="inline-start" />
                          ) : (
                            <GitBranchIcon data-icon="inline-start" />
                          )}
                          {visibility}
                        </Button>
                      ))}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      Private is the recommended default for internal apps.
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 px-5 py-4">
                  <Button
                    type="button"
                    disabled={!canManage || saving}
                    onClick={save}
                  >
                    {saving ? (
                      <Loader2Icon data-icon="inline-start" className="animate-spin" />
                    ) : (
                      <KeyRoundIcon data-icon="inline-start" />
                    )}
                    {connection ? "Save GitHub connection" : "Connect GitHub"}
                  </Button>
                  {connection ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canManage || disconnecting}
                      onClick={disconnect}
                    >
                      {disconnecting ? (
                        <Loader2Icon data-icon="inline-start" className="animate-spin" />
                      ) : null}
                      Disconnect
                    </Button>
                  ) : null}
                  {connection?.connectedAccountLogin ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      @{connection.connectedAccountLogin} - {connection.targetOwner}
                    </span>
                  ) : null}
                </div>

                <div className="px-5 py-4">
                  <div className="flex items-center gap-4 rounded-lg border border-border bg-background px-4 py-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground">
                      <GitBranchIcon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-medium">
                          Store app source in GitHub
                        </h2>
                        {data?.runtime.mode === "cloud" ? (
                          <Badge
                            variant={
                              storeSourceInGitHub ? "secondary" : "outline"
                            }
                          >
                            {storeSourceInGitHub ? "On" : "Off"}
                          </Badge>
                        ) : (
                          <Badge variant="outline">On-prem setting</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                        When enabled for on-prem or managed deployments,
                        successful builds write app source to GitHub. Mongo keeps
                        metadata, run history, and a fast preview cache.
                      </p>
                      {data?.runtime.mode === "local" ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Local installs use the app top-bar publish control
                          for explicit per-app GitHub storage and distribution.
                        </p>
                      ) : null}
                    </div>
                    <Switch
                      checked={
                        data?.runtime.mode === "cloud" && storeSourceInGitHub
                      }
                      disabled={
                        !canManage ||
                        saving ||
                        data?.runtime.mode !== "cloud"
                      }
                      onCheckedChange={setStoreSourceInGitHub}
                      className={cn(
                        "[--toggle-on:oklch(0.62_0.18_148)] [--toggle-ring:oklch(0.62_0.18_148_/_0.24)] dark:[--toggle-on:oklch(0.72_0.19_148)] dark:[--toggle-ring:oklch(0.72_0.19_148_/_0.24)]",
                        "[&>span]:bg-white",
                        data?.runtime.mode === "cloud" &&
                          storeSourceInGitHub &&
                          "bg-[var(--toggle-on)] hover:bg-[var(--toggle-on)] focus-visible:ring-[var(--toggle-ring)]",
                      )}
                      aria-label="Store app source in GitHub"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {data?.runtime.mode === "cloud" ? (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
              GitHub OAuth app connection is coming soon for managed and
              on-prem deployments. PAT setup is supported first.
            </div>
          ) : null}

          {error ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <p className="flex-1 text-xs text-muted-foreground">{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => fetchSettings()}
              >
                <RefreshCwIcon data-icon="inline-start" />
                Retry
              </Button>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <KeyRoundIcon className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-medium">Token permissions</h2>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Prefer a fine-grained PAT with Metadata read, Contents read/write,
                and Administration write for repo creation and topics.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <LockIcon className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-medium">Secret handling</h2>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                PAT values are stored server-side and never returned to the browser,
                worker, audit metadata, or realtime events.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <GitBranchIcon className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-medium">Source storage</h2>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                GitHub can store authoritative app source. Available Apps is a
                separate discovery layer for apps intentionally shared with
                local installs.
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            {disabledProviderRow({ name: "GitLab", label: "Coming later" })}
            {disabledProviderRow({ name: "Bitbucket", label: "Coming later" })}
          </div>

          <p
            className={cn(
              "max-w-3xl text-[12px] leading-relaxed text-muted-foreground",
              !canManage && "text-muted-foreground/70",
            )}
          >
            Organization approval may be required for fine-grained PATs. Classic
            PAT fallback is repo for private repositories, or public_repo only
            when the organization deliberately uses public app repositories.
          </p>
        </div>
      </div>
    </div>
  );
}
