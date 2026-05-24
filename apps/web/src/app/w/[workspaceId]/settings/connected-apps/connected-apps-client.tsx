"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlugZapIcon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ReturnToAppCallout } from "@/components/return-to-app-callout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspaceRealtimeEvent } from "@/components/workspace-realtime-provider";
import {
  abortForNavigation,
  subscribeNavigationIntent,
} from "@/lib/navigation-intent";
import { integrationRouteSegment } from "@/lib/integration-routes";
import type { IntegrationsSettingsReadModel } from "@/lib/workspace-settings/read-models";

type IntegrationGrant = IntegrationsSettingsReadModel["integrations"][number];

function fav(domain: string) {
  return `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
}

function safeWorkspaceAppReturnTo(
  value: string | null,
  workspaceId: string,
): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value, "https://second.local");
    if (parsed.origin !== "https://second.local") return null;
    const target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return target.startsWith(`/w/${workspaceId}/apps/`) ? target : null;
  } catch {
    return null;
  }
}

function returnToForGrant(
  returnTo: string | null,
  workspaceId: string,
  grant: IntegrationGrant,
): string | null {
  if (!returnTo) return null;
  const appPath = `/w/${workspaceId}/apps/${grant.appId}`;
  return returnTo === appPath ||
    returnTo.startsWith(`${appPath}/`) ||
    returnTo.startsWith(`${appPath}?`) ||
    returnTo.startsWith(`${appPath}#`)
    ? returnTo
    : null;
}

function connectedBadge() {
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

function disconnectedBadge(label = "Disconnected") {
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <TriangleAlertIcon className="size-2.5" />
      {label}
    </Badge>
  );
}

function oauthErrorMessage(code: string): string {
  switch (code) {
    case "invalid_client":
      return "Google rejected the OAuth client credentials. Recheck the Client ID, Client Secret, and that the OAuth client type is Web application, then save the provider again.";
    case "missing_refresh_token":
      return "The provider did not return a refresh token. Reconnect after confirming the OAuth app allows offline access.";
    case "oauth_config_mismatch":
      return "The workspace OAuth provider no longer matches this app's approved OAuth metadata. Reconfigure the provider from Integrations.";
    case "oauth_config_missing":
      return "The OAuth provider or integration was not found. Reopen the integration setup and try again.";
    case "oauth_identity_missing":
      return "Second could not resolve the user who started this OAuth flow. Start the connection again from Connected Apps.";
    case "access_denied":
      return "The OAuth connection was cancelled before access was granted.";
    default:
      return `OAuth connection failed: ${code}`;
  }
}

export default function ConnectedAppsClient({
  workspaceId,
  initialData,
}: {
  workspaceId: string;
  initialData: IntegrationsSettingsReadModel | null;
}) {
  const searchParams = useSearchParams();
  const selectedIntegrationId = searchParams.get("integration");
  const oauthStatus = searchParams.get("oauth");
  const oauthError = searchParams.get("oauth_error");
  const callbackProviderConfigId = searchParams.get("providerConfigId");
  const returnTo = safeWorkspaceAppReturnTo(
    searchParams.get("returnTo"),
    workspaceId,
  );
  const handledOAuthCallbackRef = useRef<string | null>(null);
  const [grants, setGrants] = useState<IntegrationGrant[]>(
    initialData?.integrations ?? [],
  );
  const [canManage, setCanManage] = useState(initialData?.canManage ?? false);
  const [loading, setLoading] = useState(!initialData);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchIntegrations = useCallback(async (options?: {
    signal?: AbortSignal;
  }) => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/integrations`, {
        signal: options?.signal,
      });
      if (options?.signal?.aborted) return;
      if (!res.ok) return;
      const data = (await res.json()) as IntegrationsSettingsReadModel;
      if (options?.signal?.aborted) return;
      setCanManage(data.canManage);
      setGrants(data.integrations);
    } catch {
      // best effort
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
    void fetchIntegrations({ signal: controller.signal });
    return () => {
      unsubscribeNavigation();
      abortForNavigation(controller, "Connected Apps settings unmounted.");
    };
  }, [fetchIntegrations, initialData]);

  useEffect(() => {
    const callbackKey = [
      selectedIntegrationId ?? "",
      callbackProviderConfigId ?? "",
      oauthStatus ?? "",
      oauthError ?? "",
    ].join(":");
    if (!oauthStatus && !oauthError) return;
    if (handledOAuthCallbackRef.current === callbackKey) return;
    handledOAuthCallbackRef.current = callbackKey;

    if (oauthError) {
      const message = oauthErrorMessage(oauthError);
      setError(message);
      toast.error(message);
      return;
    }

    if (oauthStatus === "missing_scopes") {
      const message =
        "The account connected, but it did not grant every scope this app requires. Reconnect and approve all requested access.";
      setError(message);
      toast.error(message);
      return;
    }

    if (oauthStatus === "connected") {
      setError(null);
      toast.success("Connected account");
    }
  }, [callbackProviderConfigId, oauthError, oauthStatus, selectedIntegrationId]);

  useWorkspaceRealtimeEvent(useCallback((event) => {
    if (event.workspaceId !== workspaceId || event.scope !== "integrations") {
      return;
    }
    void fetchIntegrations();
  }, [fetchIntegrations, workspaceId]));

  const oauthGrants = useMemo(() => {
    return grants
      .filter((grant) => grant.authType === "oauth2")
      .sort((a, b) => {
        if (selectedIntegrationId) {
          if (a.id === selectedIntegrationId) return -1;
          if (b.id === selectedIntegrationId) return 1;
        }
        const aConnected = Boolean(a.oauth?.currentUserConnected);
        const bConnected = Boolean(b.oauth?.currentUserConnected);
        if (aConnected !== bConnected) return aConnected ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  }, [grants, selectedIntegrationId]);
  const selectedGrant = useMemo(() => {
    if (!selectedIntegrationId) return null;
    return grants.find((grant) => grant.id === selectedIntegrationId) ?? null;
  }, [grants, selectedIntegrationId]);
  const readyReturnGrant = returnTo && selectedGrant?.oauth?.currentUserConnected
    ? selectedGrant
    : null;

  const startOAuthConnect = (grant: IntegrationGrant) => {
    if (!grant.oauth?.providerConfigId) {
      setError("OAuth provider config is not available.");
      return;
    }
    const scopedReturnTo = returnToForGrant(returnTo, workspaceId, grant);
    const connectedAppsReturnTo =
      `/w/${workspaceId}/settings/connected-apps?integration=${encodeURIComponent(grant.id)}` +
      (scopedReturnTo ? `&returnTo=${encodeURIComponent(scopedReturnTo)}` : "");
    window.location.href =
      `/api/workspaces/${workspaceId}/oauth/${grant.oauth.providerConfigId}/start` +
      `?integrationId=${encodeURIComponent(grant.id)}` +
      `&returnTo=${encodeURIComponent(connectedAppsReturnTo)}`;
  };

  const revokeOAuthAccount = async (grant: IntegrationGrant) => {
    const accountId = grant.oauth?.currentUserConnectedAccount?.id;
    if (!accountId) return;
    setBusyAccountId(accountId);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/connected-accounts/${accountId}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Unable to revoke connected account.");
      await fetchIntegrations();
      toast.success("Connected account revoked");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to revoke account.");
    } finally {
      setBusyAccountId(null);
    }
  };

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
                Connected Apps
              </h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Connect or revoke your own OAuth accounts. Workspace providers
                stay configured separately in Integrations.
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="gap-1.5 text-xs">
              <Link href={`/w/${workspaceId}/settings/integrations`}>
                Workspace integrations
                <ExternalLinkIcon data-icon="inline-end" />
              </Link>
            </Button>
          </div>

          {error ? (
            <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
          {readyReturnGrant && returnTo ? (
            <ReturnToAppCallout
              title={`${readyReturnGrant.name} is connected`}
              description={`Continue in ${readyReturnGrant.appName}.`}
              href={returnTo}
              placement="inline"
            />
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8">
        <div className="mx-auto max-w-5xl pb-10">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : oauthGrants.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-border/70 py-16 text-center">
              <PlugZapIcon className="size-7 text-muted-foreground/50" />
              <h2 className="mt-3 text-sm font-medium">No OAuth apps yet</h2>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                OAuth apps appear here after an approved app declares a provider
                such as Google Calendar, Gmail, Zoom, or Microsoft Graph.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {oauthGrants.map((grant) => (
                <ConnectedAppCard
                  key={grant.id}
                  grant={grant}
                  workspaceId={workspaceId}
                  canManage={canManage}
                  busyAccountId={busyAccountId}
                  returnTo={returnTo}
                  routeSegment={integrationRouteSegment(grant, grants)}
                  onConnect={() => startOAuthConnect(grant)}
                  onRevoke={() => revokeOAuthAccount(grant)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectedAppCard({
  grant,
  workspaceId,
  canManage,
  busyAccountId,
  returnTo,
  routeSegment,
  onConnect,
  onRevoke,
}: {
  grant: IntegrationGrant;
  workspaceId: string;
  canManage: boolean;
  busyAccountId: string | null;
  returnTo: string | null;
  routeSegment: string;
  onConnect: () => void;
  onRevoke: () => void;
}) {
  const oauth = grant.oauth;
  const account = oauth?.currentUserConnectedAccount;
  const providerConfigured = Boolean(
    oauth?.providerConfigured && oauth.providerConfigMatchesGrant,
  );
  const connected = Boolean(oauth?.currentUserConnected);
  const reconnectRequired = Boolean(account && !connected);
  const accountLabel = account?.accountEmail || account?.accountName || "account";
  const busy = Boolean(account?.id && busyAccountId === account.id);
  const scopedReturnTo = returnToForGrant(returnTo, workspaceId, grant);
  const configureProviderHref =
    `/w/${workspaceId}/settings/integrations/${encodeURIComponent(
      routeSegment,
    )}?app=${encodeURIComponent(grant.appId)}` +
    (scopedReturnTo ? `&returnTo=${encodeURIComponent(scopedReturnTo)}` : "");

  return (
    <div className="flex min-h-56 flex-col rounded-lg border border-border/70 bg-background p-4 transition-colors">
      <div className="flex items-start justify-between gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={grant.faviconUrl || fav(grant.domain)}
          alt=""
          className="size-11 rounded-xl border border-border bg-white p-2 shadow-sm"
        />
        {connected
          ? connectedBadge()
          : disconnectedBadge(reconnectRequired ? "Reconnect needed" : "Disconnected")}
      </div>

      <div className="mt-4 min-w-0">
        <h2 className="truncate text-sm font-medium">{grant.name}</h2>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {grant.appName}
        </p>
      </div>

      <div className="mt-4 flex min-h-12 flex-1 flex-col gap-2 text-xs text-muted-foreground">
        {connected ? (
          <p>
            Connected as{" "}
            <span className="text-foreground/80">{accountLabel}</span>
          </p>
        ) : account ? (
          <p>
            Last connected as{" "}
            <span className="text-foreground/80">{accountLabel}</span>
          </p>
        ) : (
          <p>No account connected.</p>
        )}

        {!providerConfigured ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
            Workspace OAuth provider setup is required first.
          </p>
        ) : null}

        {/* Hidden for now; runtime still enforces scopes before tool execution.
        {oauth?.missingScopes?.length ? (
          <div className="flex flex-wrap gap-1">
            {oauth.missingScopes.map((scope) => (
              <span
                key={scope}
                className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 dark:text-amber-300"
              >
                missing {scope}
              </span>
            ))}
          </div>
        ) : null} */}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {connected ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onRevoke}
          >
            {busy ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <Trash2Icon data-icon="inline-start" />
            )}
            Revoke
          </Button>
        ) : null}

        {!providerConfigured && canManage ? (
          <Button asChild variant="outline" size="sm">
            <Link href={configureProviderHref}>
              Configure provider
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={!providerConfigured}
            onClick={onConnect}
          >
            {reconnectRequired ? (
              <RotateCcwIcon data-icon="inline-start" />
            ) : null}
            {account ? "Reconnect" : "Connect"}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        )}
      </div>
    </div>
  );
}
