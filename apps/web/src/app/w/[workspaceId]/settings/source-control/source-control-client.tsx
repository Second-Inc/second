"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  CloudIcon,
  Loader2Icon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Alert,
  AlertAction,
  AlertDescription,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type ProviderOption = SourceControlSettingsReadModel["providers"][number];
type ProviderKey = ProviderOption["provider"];

const FALLBACK_PROVIDERS: ProviderOption[] = [
  {
    provider: "github",
    name: "GitHub",
    enabled: true,
    status: "not_configured",
  },
  {
    provider: "gitlab",
    name: "GitLab",
    enabled: false,
    status: "enterprise_only",
  },
  {
    provider: "bitbucket_cloud",
    name: "Bitbucket Cloud",
    enabled: false,
    status: "enterprise_only",
  },
  {
    provider: "bitbucket_server",
    name: "Bitbucket Server",
    enabled: false,
    status: "enterprise_only",
  },
];

const PROVIDER_DESCRIPTIONS: Record<ProviderKey, string> = {
  github: "Connect an owner and token to store Second app repositories.",
  gitlab: "Enterprise deployments can use GitLab as the repository provider.",
  bitbucket_cloud:
    "Enterprise deployments can use Atlassian-hosted Bitbucket workspaces.",
  bitbucket_server:
    "Enterprise deployments can use self-hosted Bitbucket Server instances.",
};

function statusBadge(status: string) {
  if (status === "valid") {
    return (
      <Badge variant="secondary">
        <CheckIcon data-icon="inline-start" />
        Connected
      </Badge>
    );
  }
  if (status === "invalid" || status === "revoked") {
    return (
      <Badge variant="destructive">
        <TriangleAlertIcon data-icon="inline-start" />
        Reconnect
      </Badge>
    );
  }
  return <Badge variant="outline">Not connected</Badge>;
}

function actionLabel(status: string): string {
  if (status === "valid") return "Manage";
  if (status === "invalid" || status === "revoked") return "Reconnect";
  return "Connect";
}

function ProviderLogo({ provider, large = false }: {
  provider: ProviderKey;
  large?: boolean;
}) {
  const src = provider === "github"
    ? "/icons/source-control-github.svg"
    : provider === "gitlab"
      ? "/icons/source-control-gitlab.svg"
      : "/icons/source-control-bitbucket.svg";

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={cn("shrink-0", large ? "size-9" : "size-8")}
    />
  );
}

function ProviderCard({
  provider,
  href,
}: {
  provider: ProviderOption;
  href: string | null;
}) {
  const available = Boolean(provider.enabled && href);
  const content = (
    <>
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-white",
          !available && "opacity-50",
        )}
      >
        <ProviderLogo provider={provider.provider} />
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-1 self-stretch flex-col gap-2",
          !available && "opacity-50",
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {provider.name}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {PROVIDER_DESCRIPTIONS[provider.provider]}
            </span>
          </span>
        </span>
        <span className="mt-auto flex w-full items-center gap-2 pt-4">
          {available ? (
            <span className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border border-transparent bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors group-hover:bg-primary/80">
              {actionLabel(provider.status)}
              <ArrowRightIcon className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </span>
          ) : null}
        </span>
      </span>
      {!available ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-border bg-muted/80 px-4 py-2 text-center text-xs font-medium text-muted-foreground">
          Available in enterprise
        </span>
      ) : null}
    </>
  );

  const className = cn(
    "group relative flex min-h-[132px] items-start gap-3 overflow-hidden rounded-lg border border-border bg-card p-4 text-left transition-colors",
    available ? "hover:bg-muted/30" : "cursor-not-allowed pb-12",
  );

  if (available && href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <div aria-disabled="true" className={className}>
      {content}
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
  const [savingStorage, setSavingStorage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeSourceInSourceControl, setStoreSourceInSourceControl] = useState(
    initialData?.connection?.sourceStorageMode === "source_control",
  );

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
      setStoreSourceInSourceControl(
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

  const canManage = data?.canManage ?? false;
  const connection = data?.connection ?? null;
  const providers = useMemo(
    () => data?.providers ?? FALLBACK_PROVIDERS,
    [data?.providers],
  );
  const storagePolicyAvailable = data?.runtime.mode === "cloud";
  const storagePolicyEnabled =
    canManage && storagePolicyAvailable && Boolean(connection);
  const storageDisabledReason = !storagePolicyAvailable
    ? "Not available in local"
    : !connection
      ? "Connect provider first"
      : !canManage
        ? "Admin or owner required"
        : null;

  const updateStoragePolicy = useCallback(async (enabled: boolean) => {
    if (!connection || !storagePolicyEnabled || savingStorage) return;
    setSavingStorage(true);
    setError(null);
    setStoreSourceInSourceControl(enabled);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/source-control/github`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetOwner: connection.targetOwner,
            defaultVisibility: connection.defaultVisibility ?? "private",
            repoNamePrefix: connection.repoNamePrefix ?? null,
            sourceStorageMode: enabled ? "source_control" : "mongo",
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!response.ok) {
        const message = body?.message ?? "Could not update source storage.";
        setStoreSourceInSourceControl(!enabled);
        setError(message);
        toast.error(message);
        return;
      }
      toast.success("Source storage policy updated.");
      await fetchSettings();
    } catch {
      setStoreSourceInSourceControl(!enabled);
      setError("Could not update source storage.");
      toast.error("Could not update source storage.");
    } finally {
      setSavingStorage(false);
    }
  }, [
    connection,
    fetchSettings,
    savingStorage,
    storagePolicyEnabled,
    workspaceId,
  ]);

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
                Connect a repository provider so Second can store app source in
                source control and share selected apps through Available Apps.
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {providers.map((provider) => (
              <ProviderCard
                key={provider.provider}
                provider={provider}
                href={
                  provider.provider === "github"
                    ? `/w/${workspaceId}/settings/source-control/github`
                    : null
                }
              />
            ))}
          </div>

          <div
            className={cn(
              "flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3",
              !storagePolicyEnabled && "bg-muted/20",
            )}
          >
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground",
                !storagePolicyEnabled && "opacity-50",
              )}
            >
              <CloudIcon className="size-4" />
            </div>
            <div
              className={cn(
                "min-w-0 flex-1",
                !storagePolicyEnabled && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-medium">
                  Always store app source in remote source control
                </h2>
                {storageDisabledReason ? (
                  <Badge variant="outline">{storageDisabledReason}</Badge>
                ) : (
                  <Badge
                    variant={storeSourceInSourceControl ? "secondary" : "outline"}
                  >
                    {storeSourceInSourceControl ? "On" : "Off"}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                When enabled for on-prem or managed deployments, successful
                builds write app source to the configured provider. Mongo keeps
                metadata, run history, and fast preview cache data.
              </p>
            </div>
            {savingStorage || loading ? (
              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <Switch
                checked={
                  storagePolicyEnabled && storeSourceInSourceControl
                }
                disabled={!storagePolicyEnabled || savingStorage}
                onCheckedChange={updateStoragePolicy}
                className="disabled:opacity-100"
                aria-label="Always store app source in remote source control"
              />
            )}
          </div>

          {/* Token permissions, Secret handling, and Source storage cards are intentionally hidden. */}

          {error ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
              <AlertAction>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fetchSettings()}
                >
                  <RefreshCwIcon data-icon="inline-start" />
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          ) : null}

          <p
            className={cn(
              "max-w-3xl text-[12px] leading-relaxed text-muted-foreground",
              !canManage && "text-muted-foreground/70",
            )}
          >
            Organization approval may be required for provider tokens. Prefer
            private repositories, rotate expiring credentials, and keep source
            storage separate from Available Apps discovery.
          </p>
        </div>
      </div>
    </div>
  );
}
