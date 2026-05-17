"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  LayersIcon,
  Loader2Icon,
  LockIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InlineMarkdownLinks } from "@/components/inline-markdown-links";
import { ReturnToAppCallout } from "@/components/return-to-app-callout";
import { useWorkspaceRealtimeEvent } from "@/components/workspace-realtime-provider";
import {
  abortForNavigation,
  subscribeNavigationIntent,
} from "@/lib/navigation-intent";
import {
  integrationRouteAliases,
  integrationRouteSegment,
  normalizeIntegrationDomain as normalizeDomain,
  slugifyIntegrationRouteSegment as slugifyRouteSegment,
} from "@/lib/integration-routes";
import type { IntegrationsSettingsReadModel } from "@/lib/workspace-settings/read-models";
import { cn } from "@/lib/utils";

type IntegrationGrant = IntegrationsSettingsReadModel["integrations"][number];

type ConfirmAction = {
  title: string;
  description: string;
  action: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

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

function appIdFromReturnTo(value: string | null): string | null {
  if (!value) return null;
  const pathname = value.split(/[?#]/, 1)[0] ?? "";
  const parts = pathname.split("/");
  if (parts[1] !== "w" || parts[3] !== "apps" || !parts[4]) return null;
  try {
    return decodeURIComponent(parts[4]);
  } catch {
    return parts[4];
  }
}

type IntegrationReturnContext = {
  appId: string;
  returnTo: string;
  expiresAt: number;
};

const RETURN_CONTEXT_TTL_MS = 30 * 60 * 1000;

function returnContextStorageKey(workspaceId: string): string {
  return `second:integration-return:${workspaceId}`;
}

function readReturnContext(workspaceId: string): IntegrationReturnContext | null {
  try {
    const raw = window.sessionStorage.getItem(returnContextStorageKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<IntegrationReturnContext>;
    if (
      typeof parsed.appId !== "string" ||
      typeof parsed.returnTo !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      window.sessionStorage.removeItem(returnContextStorageKey(workspaceId));
      return null;
    }
    const safeReturnTo = safeWorkspaceAppReturnTo(parsed.returnTo, workspaceId);
    if (!safeReturnTo || appIdFromReturnTo(safeReturnTo) !== parsed.appId) {
      window.sessionStorage.removeItem(returnContextStorageKey(workspaceId));
      return null;
    }
    return {
      appId: parsed.appId,
      returnTo: safeReturnTo,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function writeReturnContext(
  workspaceId: string,
  context: Pick<IntegrationReturnContext, "appId" | "returnTo">,
): IntegrationReturnContext {
  const next = {
    ...context,
    expiresAt: Date.now() + RETURN_CONTEXT_TTL_MS,
  };
  try {
    window.sessionStorage.setItem(
      returnContextStorageKey(workspaceId),
      JSON.stringify(next),
    );
  } catch {
    // Best effort. The URL query path still works if storage is unavailable.
  }
  return next;
}

function permissionKey(groupName: string, permission: string): string {
  return `${groupName.trim().toLowerCase()}::${permission.trim().toLowerCase()}`;
}

function grantNeedsSetup(grant: IntegrationGrant): boolean {
  if (grant.authType === "oauth2") {
    return !(
      grant.oauth?.providerConfigured &&
      grant.oauth.providerConfigMatchesGrant &&
      grant.oauth.currentUserConnected
    );
  }

  if (!grant.configured) return true;

  const configuredPermissions = new Set<string>();
  for (const group of grant.configuredPermissionGroups ?? []) {
    for (const permission of group.permissions ?? []) {
      configuredPermissions.add(permissionKey(group.name, permission));
    }
  }

  for (const group of grant.permissionGroups ?? []) {
    for (const permission of group.permissions ?? []) {
      if (!configuredPermissions.has(permissionKey(group.name, permission))) {
        return true;
      }
    }
  }

  const configuredSecrets = new Set(
    (grant.configuredSecrets ?? []).map((secret) => secret.toLowerCase()),
  );
  return (grant.secretRequirements ?? [])
    .filter((secret) => secret.required !== false)
    .some((secret) => !configuredSecrets.has(secret.name.toLowerCase()));
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

export default function IntegrationsClient({
  workspaceId,
  initialData,
  selectedIntegrationId = null,
}: {
  workspaceId: string;
  initialData: IntegrationsSettingsReadModel | null;
  selectedIntegrationId?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryReturnTo = safeWorkspaceAppReturnTo(
    searchParams.get("returnTo"),
    workspaceId,
  );
  const queryReturnToAppId = appIdFromReturnTo(queryReturnTo);
  const [grants, setGrants] = useState<IntegrationGrant[]>(
    initialData?.integrations ?? [],
  );
  const [canManage, setCanManage] = useState(initialData?.canManage ?? false);
  const [loading, setLoading] = useState(!initialData);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<"app" | "integration">("app");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storedReturnContext, setStoredReturnContext] =
    useState<IntegrationReturnContext | null>(null);
  const didHandleDeepLink = useRef(false);
  useEffect(() => {
    if (queryReturnTo && queryReturnToAppId) {
      setStoredReturnContext(
        writeReturnContext(workspaceId, {
          appId: queryReturnToAppId,
          returnTo: queryReturnTo,
        }),
      );
      return;
    }
    setStoredReturnContext(readReturnContext(workspaceId));
  }, [queryReturnTo, queryReturnToAppId, workspaceId]);
  const returnTo = queryReturnTo ?? storedReturnContext?.returnTo ?? null;
  const returnToAppId =
    queryReturnToAppId ?? storedReturnContext?.appId ?? appIdFromReturnTo(returnTo);
  const integrationsHref = `/w/${workspaceId}/settings/integrations`;
  const integrationDetailHref = useCallback((grant: IntegrationGrant, options?: {
    preserveReturnTo?: boolean;
  }) => {
    const shouldPreserveReturnTo = options?.preserveReturnTo !== false;
    const scopedReturnTo =
      shouldPreserveReturnTo && returnTo && returnToAppId === grant.appId
        ? returnTo
        : null;
    return (
      `/w/${workspaceId}/settings/integrations/${encodeURIComponent(
        integrationRouteSegment(grant, grants),
      )}` +
      (scopedReturnTo
        ? `?app=${encodeURIComponent(grant.appId)}&returnTo=${encodeURIComponent(scopedReturnTo)}`
        : "")
    );
  }, [grants, returnTo, returnToAppId, workspaceId]);
  const connectedAppsHref = useCallback((grantId: string) => {
    const grant = grants.find((candidate) => candidate.id === grantId);
    const scopedReturnTo =
      grant && returnTo && returnToAppId === grant.appId ? returnTo : null;
    return (
      `/w/${workspaceId}/settings/connected-apps?integration=${encodeURIComponent(grantId)}` +
      (scopedReturnTo ? `&returnTo=${encodeURIComponent(scopedReturnTo)}` : "")
    );
  }, [grants, returnTo, returnToAppId, workspaceId]);

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
      abortForNavigation(controller, "Integrations settings unmounted.");
    };
  }, [fetchIntegrations, initialData]);

  useWorkspaceRealtimeEvent(useCallback((event) => {
    if (event.workspaceId !== workspaceId || event.scope !== "integrations") {
      return;
    }
    void fetchIntegrations();
  }, [fetchIntegrations, workspaceId]));

  const shouldRouteMemberToConnectedApps = useCallback((grant: IntegrationGrant) => {
    return Boolean(
      !canManage &&
        grant.authType === "oauth2" &&
        grant.oauth?.providerConfigured &&
        grant.oauth.providerConfigMatchesGrant,
    );
  }, [canManage]);

  const openGrant = useCallback((grant: IntegrationGrant) => {
    if (shouldRouteMemberToConnectedApps(grant)) {
      router.push(connectedAppsHref(grant.id));
      return;
    }
    router.push(integrationDetailHref(grant));
  }, [
    connectedAppsHref,
    integrationDetailHref,
    router,
    shouldRouteMemberToConnectedApps,
  ]);

  useEffect(() => {
    if (selectedIntegrationId) return;
    if (didHandleDeepLink.current || grants.length === 0) return;
    const integrationParam = searchParams.get("integration");
    const appParam = searchParams.get("app");
    if (!integrationParam) return;

    const normalizedIntegration = integrationParam
      ? normalizeDomain(integrationParam)
      : "";
    const match = grants.find((grant) => {
      const appMatches = !appParam || grant.appId === appParam;
      const integrationMatches =
        !integrationParam ||
        grant.id === integrationParam ||
        normalizeDomain(grant.domain) === normalizedIntegration ||
        normalizeDomain(grant.name) === normalizedIntegration;
      return appMatches && integrationMatches && grantNeedsSetup(grant);
    }) ?? grants.find((grant) => {
      const appMatches = !appParam || grant.appId === appParam;
      const integrationMatches =
        !integrationParam ||
        grant.id === integrationParam ||
        normalizeDomain(grant.domain) === normalizedIntegration ||
        normalizeDomain(grant.name) === normalizedIntegration;
      return appMatches && integrationMatches;
    });

    if (match) {
      didHandleDeepLink.current = true;
      if (shouldRouteMemberToConnectedApps(match)) {
        router.replace(connectedAppsHref(match.id));
        return;
      }
      router.replace(integrationDetailHref(match, { preserveReturnTo: true }));
    }
  }, [
    grants,
    integrationDetailHref,
    router,
    searchParams,
    selectedIntegrationId,
    shouldRouteMemberToConnectedApps,
    connectedAppsHref,
  ]);

  const filtered = useMemo(() => {
    if (!search) return grants;
    const q = search.toLowerCase();
    return grants.filter((grant) =>
      [
        grant.appName,
        grant.name,
        grant.domain,
        grant.keyName,
        grant.keySlug,
        grant.capabilityLabel,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [grants, search]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; grants: IntegrationGrant[] }>();
    for (const grant of filtered) {
      const key = groupBy === "app" ? grant.appId : grant.domain;
      const label = groupBy === "app" ? grant.appName : grant.name;
      const group = map.get(key) ?? { label, grants: [] };
      group.grants.push(grant);
      map.set(key, group);
    }
    return Array.from(map.values()).sort((a, b) => {
      const aNeeds = a.grants.some(grantNeedsSetup);
      const bNeeds = b.grants.some(grantNeedsSetup);
      if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [filtered, groupBy]);

  const setupCount = grants.filter(grantNeedsSetup).length;
  const selectedGrant = useMemo(() => {
    if (!selectedIntegrationId) return null;
    const selectedRoute = slugifyRouteSegment(selectedIntegrationId);
    const canonicalMatch = grants.find(
      (grant) =>
        grant.id === selectedIntegrationId ||
        integrationRouteSegment(grant, grants) === selectedRoute,
    );
    if (canonicalMatch) return canonicalMatch;

    const aliasMatches = grants.filter((grant) =>
      integrationRouteAliases(grant).includes(selectedRoute),
    );
    if (aliasMatches.length === 1) return aliasMatches[0];

    const appParam = searchParams.get("app");
    if (appParam) {
      const appMatches = aliasMatches.filter((grant) => grant.appId === appParam);
      if (appMatches.length === 1) return appMatches[0];
    }

    return null;
  }, [grants, searchParams, selectedIntegrationId]);

  useEffect(() => {
    if (!selectedIntegrationId || !selectedGrant) return;
    const currentRoute = slugifyRouteSegment(selectedIntegrationId);
    const canonicalRoute = integrationRouteSegment(selectedGrant, grants);
    if (currentRoute !== canonicalRoute) {
      router.replace(
        integrationDetailHref(selectedGrant, { preserveReturnTo: true }),
      );
    }
  }, [
    grants,
    integrationDetailHref,
    router,
    selectedGrant,
    selectedIntegrationId,
  ]);
  const returnReadyGrant = useMemo(() => {
    if (!returnTo) return null;
    const integrationParam = searchParams.get("integration");
    const appParam = searchParams.get("app");
    const returnToMatchesApp = Boolean(appParam && returnToAppId === appParam);
    const normalizedIntegration = integrationParam
      ? normalizeDomain(integrationParam)
      : "";

    return grants.find((grant) => {
      const appMatches = Boolean(appParam) && grant.appId === appParam;
      const integrationMatches =
        !integrationParam ||
        grant.id === integrationParam ||
        normalizeDomain(grant.domain) === normalizedIntegration ||
        normalizeDomain(grant.name) === normalizedIntegration;
      return (
        grant.authType !== "oauth2" &&
        returnToMatchesApp &&
        appMatches &&
        integrationMatches &&
        !grantNeedsSetup(grant)
      );
    }) ?? null;
  }, [grants, returnTo, returnToAppId, searchParams]);

  const configure = async (
    grant: IntegrationGrant,
    secrets: Record<string, string>,
  ) => {
    setError(null);
    const response = await fetch(
      `/api/workspaces/${workspaceId}/integrations/${grant.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secrets }),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(body?.error ?? "Unable to save integration.");
    }
    await fetchIntegrations();
  };

  const configureOAuthProvider = async (
    grant: IntegrationGrant,
    input: { clientId: string; clientSecret?: string },
  ) => {
    if (!grant.oauth?.providerConfigId) {
      throw new Error("OAuth provider config is not available.");
    }
    const response = await fetch(
      `/api/workspaces/${workspaceId}/oauth-provider-configs/${grant.oauth.providerConfigId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(body?.error ?? "Unable to save OAuth provider.");
    }
    await fetchIntegrations();
  };

  const resetGrant = async (grant: IntegrationGrant) => {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/integrations/${grant.id}`,
      { method: "POST" },
    );
    if (!response.ok) throw new Error("Unable to reset integration.");
    await fetchIntegrations();
  };

  const deleteGrant = async (grant: IntegrationGrant) => {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/integrations/${grant.id}`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new Error("Unable to delete integration.");
    await fetchIntegrations();
  };

  const renderRow = (grant: IntegrationGrant) => {
    const needsSetup = grantNeedsSetup(grant);
    const canResetStatic = !needsSetup && grant.authType !== "oauth2";
    const canClearOAuth = Boolean(
      grant.authType === "oauth2" && grant.oauth?.providerConfigured,
    );
    const canShowResetAction = canResetStatic || canClearOAuth;

    return (
      <div
        key={grant.id}
        role="button"
        tabIndex={0}
        onClick={() => openGrant(grant)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") openGrant(grant);
        }}
        className="group flex cursor-pointer items-start gap-4 rounded-lg border border-[#E1E1E1] bg-background p-4 transition-all duration-150 hover:border-[#cfcfcf] hover:bg-muted/20 dark:border-[#2a2a2a] dark:hover:border-[#3a3a3a]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={grant.faviconUrl || fav(grant.domain)}
          alt=""
          className="size-11 shrink-0 rounded-xl border border-border bg-white p-2 shadow-sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">
              {groupBy === "app" ? grant.name : grant.appName}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground/60">
              {grant.domain}
            </span>
            {grant.authType === "oauth2" ? (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                OAuth
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {grant.capabilityLabel}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {needsSetup ? (
              <Badge
                variant="outline"
                className="gap-1 border-transparent bg-amber-50 text-[11px] text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"
              >
                <TriangleAlertIcon className="size-3" />
                {grant.authType === "oauth2"
                  ? grant.oauth?.providerConfigured
                    ? "Connect account"
                    : "Configure OAuth"
                  : "Configure credential"}
                <ArrowRightIcon className="size-3" />
              </Badge>
            ) : (
              connectedBadge()
            )}
            {grant.credentialName && !needsSetup ? (
              <span className="text-[11px] text-muted-foreground">
                {grant.credentialName}
              </span>
            ) : null}
          </div>
        </div>
        <div
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-muted-foreground/40 hover:text-muted-foreground"
                disabled={!canManage}
                aria-label={`Actions for ${grant.name}`}
              >
                <MoreHorizontalIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {canShowResetAction ? (
                <DropdownMenuItem
                  onClick={() =>
                    setConfirmAction({
                      title:
                        grant.authType === "oauth2"
                          ? "Clear OAuth setup?"
                          : "Reset configuration?",
                      description:
                        grant.authType === "oauth2"
                          ? `Clears the workspace OAuth client and revokes connected ${grant.name} accounts. Apps using this provider will need setup again.`
                          : `Clears saved secrets for ${grant.capabilityLabel}. This affects only ${grant.appName}.`,
                      action:
                        grant.authType === "oauth2" ? "Clear setup" : "Reset",
                      destructive: true,
                      onConfirm: () => resetGrant(grant),
                    })
                  }
                >
                  <RotateCcwIcon className="size-3.5" />
                  {grant.authType === "oauth2" ? "Clear OAuth setup" : "Reset"}
                </DropdownMenuItem>
              ) : null}
              {canShowResetAction ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() =>
                  setConfirmAction({
                    title: "Delete this grant?",
                    description: `Removes ${grant.appName}'s request for ${grant.capabilityLabel}. Other apps are not affected.`,
                    action: "Delete",
                    destructive: true,
                    onConfirm: () => deleteGrant(grant),
                  })
                }
              >
                <Trash2Icon className="size-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  if (selectedIntegrationId) {
    return (
      <IntegrationDetailPage
        grant={selectedGrant}
        loading={loading}
        canManage={canManage}
        integrationsHref={integrationsHref}
        connectedAppsHref={connectedAppsHref}
        returnTo={returnTo}
        returnToAppId={returnToAppId}
        error={error}
        onConnect={async (grant, secrets) => {
          await configure(grant, secrets);
          await fetchIntegrations();
        }}
        onConfigureOAuthProvider={configureOAuthProvider}
        onDelete={(grant) =>
          setConfirmAction({
            title: "Delete this grant?",
            description: `Removes ${grant.appName}'s request for ${grant.capabilityLabel}. Other apps are not affected.`,
            action: "Delete",
            destructive: true,
            onConfirm: async () => {
              await deleteGrant(grant);
              router.push(integrationsHref);
            },
          })
        }
        onReset={(grant) =>
          setConfirmAction({
            title:
              grant.authType === "oauth2"
                ? "Clear OAuth setup?"
                : "Reset configuration?",
            description:
              grant.authType === "oauth2"
                ? `Clears the workspace OAuth client and revokes connected ${grant.name} accounts. Apps using this provider will need setup again.`
                : `Clears saved secrets for ${grant.capabilityLabel}. This affects only ${grant.appName}.`,
            action: grant.authType === "oauth2" ? "Clear setup" : "Reset",
            destructive: true,
            onConfirm: () => resetGrant(grant),
          })
        }
        onError={setError}
        confirmAction={confirmAction}
        onConfirmClose={() => setConfirmAction(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-8 pt-8 pb-5">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Integrations</h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Manage app-scoped credentials for external services used by your apps.
              </p>
            </div>
            {!canManage ? (
              <Badge variant="outline">Admin or owner required</Badge>
            ) : null}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5 text-xs font-normal"
                >
                  <LayersIcon className="size-3" />
                  {groupBy === "app" ? "By app" : "By integration"}
                  <ChevronDownIcon className="size-3 text-muted-foreground/50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuItem
                  className="gap-2 text-xs"
                  onClick={() => setGroupBy("app")}
                >
                  {groupBy === "app" ? <CheckIcon className="size-3" /> : <span className="size-3" />}
                  By app
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 text-xs"
                  onClick={() => setGroupBy("integration")}
                >
                  {groupBy === "integration" ? <CheckIcon className="size-3" /> : <span className="size-3" />}
                  By integration
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 w-64 rounded-lg bg-muted/50 pl-9 pr-3 text-sm"
              />
            </div>

            {setupCount > 0 ? (
              <span className="ml-auto flex h-9 items-center text-xs text-muted-foreground/60">
                {setupCount} {setupCount === 1 ? "credential needs" : "credentials need"} setup
              </span>
            ) : grants.length > 0 ? (
              <span className="ml-auto flex h-9 items-center text-xs text-muted-foreground/60">
                All app keys connected
              </span>
            ) : null}
          </div>

          {error ? (
            <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
          {returnReadyGrant && returnTo ? (
            <ReturnToAppCallout
              title={`${returnReadyGrant.name} is connected`}
              description={`Continue in ${returnReadyGrant.appName}.`}
              href={returnTo}
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
          ) : groups.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {grants.length === 0
                ? "No integration keys yet. They appear here when an app presents integration setup."
                : "No integrations match your search."}
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map((group) => (
                <section key={group.label}>
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    {groupBy === "integration" && group.grants[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={group.grants[0].faviconUrl || fav(group.grants[0].domain)}
                        alt=""
                        className="size-5 rounded-sm"
                      />
                    ) : null}
                    {group.label}
                    <span className="text-xs font-normal text-muted-foreground">
                      {group.grants.length} {group.grants.length === 1 ? "key" : "keys"}
                    </span>
                  </h2>
                  <div className="flex flex-col gap-3">
                    {group.grants.map(renderRow)}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        config={confirmAction}
        onClose={() => setConfirmAction(null)}
        onError={setError}
      />
    </div>
  );
}

function IntegrationDetailPage({
  grant,
  loading,
  canManage,
  integrationsHref,
  connectedAppsHref,
  returnTo,
  returnToAppId,
  error,
  onConnect,
  onConfigureOAuthProvider,
  onDelete,
  onReset,
  onError,
  confirmAction,
  onConfirmClose,
}: {
  grant: IntegrationGrant | null;
  loading: boolean;
  canManage: boolean;
  integrationsHref: string;
  connectedAppsHref: (grantId: string) => string;
  returnTo: string | null;
  returnToAppId: string | null;
  error: string | null;
  onConnect: (
    grant: IntegrationGrant,
    secrets: Record<string, string>,
  ) => Promise<void>;
  onConfigureOAuthProvider: (
    grant: IntegrationGrant,
    input: { clientId: string; clientSecret?: string },
  ) => Promise<void>;
  onDelete: (grant: IntegrationGrant) => void;
  onReset: (grant: IntegrationGrant) => void;
  onError: (message: string | null) => void;
  confirmAction: ConfirmAction | null;
  onConfirmClose: () => void;
}) {
  if (loading) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!grant) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="px-8 pt-8">
          <div className="mx-auto max-w-3xl">
            <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
              <Link href={integrationsHref}>
                <ChevronLeftIcon data-icon="inline-start" />
                Integrations
              </Link>
            </Button>
            <div className="mt-20 text-center">
              <h1 className="text-lg font-semibold">Integration not found</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                This app-scoped integration may have been deleted.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const showReturnCallout = Boolean(
    returnTo && returnToAppId === grant.appId && !grantNeedsSetup(grant),
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div
          className="mx-auto max-w-3xl pb-12 opacity-0 animate-fade-in-up"
          style={{ animationDuration: "0.25s" }}
        >
          <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
            <Link href={integrationsHref}>
              <ChevronLeftIcon data-icon="inline-start" />
              Integrations
            </Link>
          </Button>

          <div className="mt-8 flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={grant.faviconUrl || fav(grant.domain)}
                alt=""
                className="size-16 shrink-0 rounded-xl border border-border bg-white p-3 shadow-sm"
              />
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">
                  Connect {grant.capabilityLabel} for {grant.appName}
                </h1>
                <div className="mt-2 flex min-h-6 flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="inline-flex h-6 items-center leading-none text-foreground">
                    {grant.name}
                  </span>
                  <span className="inline-flex h-6 items-center font-mono text-xs mt-[1px] leading-none">
                    {grant.domain}
                  </span>
                  {grant.authType === "oauth2" ? (
                    <Badge variant="outline" className="h-6 px-2 text-[10px]">
                      OAuth
                    </Badge>
                  ) : null}
                  {grantNeedsSetup(grant) ? (
                    <Badge
                      variant="outline"
                      className="h-6 gap-1 border-transparent bg-amber-50 px-2 text-[11px] text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"
                    >
                      <TriangleAlertIcon className="size-3" />
                      Setup needed
                    </Badge>
                  ) : (
                    connectedBadge()
                  )}
                </div>
              </div>
            </div>

            <IntegrationActions
              grant={grant}
              canManage={canManage}
              onReset={() => onReset(grant)}
              onDelete={() => onDelete(grant)}
            />
          </div>

          {showReturnCallout && returnTo ? (
            <ReturnToAppCallout
              title={`${grant.name} is connected`}
              description={`Continue in ${grant.appName}.`}
              href={returnTo}
              placement="inline"
            />
          ) : null}

          {error ? (
            <p className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <div className="mt-8">
            {grant.authType === "oauth2" ? (
              <OAuthIntegrationDetail
                grant={grant}
                canManage={canManage}
                connectedAppsHref={connectedAppsHref(grant.id)}
                onConfigureOAuthProvider={onConfigureOAuthProvider}
                onError={onError}
              />
            ) : (
              <StaticIntegrationDetail
                grant={grant}
                canManage={canManage}
                onConnect={onConnect}
                onError={onError}
              />
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        config={confirmAction}
        onClose={onConfirmClose}
        onError={onError}
      />
    </div>
  );
}

function IntegrationActions({
  grant,
  canManage,
  onReset,
  onDelete,
}: {
  grant: IntegrationGrant;
  canManage: boolean;
  onReset: () => void;
  onDelete: () => void;
}) {
  const needsSetup = grantNeedsSetup(grant);
  const canResetStatic = !needsSetup && grant.authType !== "oauth2";
  const canClearOAuth = Boolean(
    grant.authType === "oauth2" && grant.oauth?.providerConfigured,
  );
  const canShowResetAction = canResetStatic || canClearOAuth;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-muted-foreground"
          disabled={!canManage}
          aria-label={`Actions for ${grant.name}`}
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {canShowResetAction ? (
          <DropdownMenuItem onClick={onReset}>
            <RotateCcwIcon className="size-3.5" />
            {grant.authType === "oauth2" ? "Clear OAuth setup" : "Reset"}
          </DropdownMenuItem>
        ) : null}
        {canShowResetAction ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={onDelete}
        >
          <Trash2Icon className="size-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OAuthIntegrationDetail({
  grant,
  canManage,
  connectedAppsHref,
  onConfigureOAuthProvider,
  onError,
}: {
  grant: IntegrationGrant;
  canManage: boolean;
  connectedAppsHref: string;
  onConfigureOAuthProvider: (
    grant: IntegrationGrant,
    input: { clientId: string; clientSecret?: string },
  ) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthStep, setOauthStep] = useState<1 | 2 | 3>(() => {
    const providerConfigured = Boolean(
      grant.oauth?.providerConfigured && grant.oauth.providerConfigMatchesGrant,
    );
    return providerConfigured ? 3 : 1;
  });
  const [oauthStepPhase, setOauthStepPhase] =
    useState<"idle" | "out" | "in">("idle");
  const [saving, setSaving] = useState(false);
  const grantId = grant.id;

  useEffect(() => {
    const providerConfigured = Boolean(
      grant.oauth?.providerConfigured && grant.oauth.providerConfigMatchesGrant,
    );
    setOauthClientId("");
    setOauthClientSecret("");
    setSaving(false);
    setOauthStepPhase("idle");
    setOauthStep(providerConfigured ? 3 : 1);
  }, [grantId, grant.oauth?.providerConfigured, grant.oauth?.providerConfigMatchesGrant]);

  const transitionOAuthStep = useCallback((nextStep: 1 | 2 | 3) => {
    setOauthStep((currentStep) => {
      if (currentStep === nextStep) return currentStep;
      setOauthStepPhase("out");
      window.setTimeout(() => {
        setOauthStep(nextStep);
        setOauthStepPhase("in");
        window.setTimeout(() => setOauthStepPhase("idle"), 30);
      }, 130);
      return currentStep;
    });
  }, []);

  const oauth = grant.oauth;
  const providerConfigured = Boolean(
    oauth?.providerConfigured && oauth.providerConfigMatchesGrant,
  );
  const oauthClientSecretRequired = oauth?.tokenAuthMethod !== "none";
  const hasProviderInput =
    oauthClientId.trim().length > 0 || oauthClientSecret.trim().length > 0;
  const canSaveProvider =
    canManage &&
    Boolean(oauth?.providerConfigId) &&
    oauthClientId.trim().length > 0 &&
    (oauth?.providerConfigured ||
      !oauthClientSecretRequired ||
      oauthClientSecret.trim().length > 0);
  const canFinishProvider =
    providerConfigured && !hasProviderInput ? true : canSaveProvider;
  const stepMotionClass = cn(
    "transition-all duration-150 ease-out",
    oauthStepPhase === "idle"
      ? "opacity-100 blur-0"
      : "pointer-events-none opacity-0 blur-sm",
  );
  const providerName = oauth?.providerDisplayName ?? grant.name;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <LockIcon className="mt-[3.5px] size-3 shrink-0" />
        <p className="min-w-0 flex-1 leading-relaxed">
          The OAuth client is configured once for this workspace. Each user
          connects their own account.
        </p>
      </div>

      <OAuthStepIndicator currentStep={oauthStep} />

      <div className={stepMotionClass}>
        {oauthStep === 1 ? (
          <OAuthSetupStep
            setup={grant.setupInstructions}
            oauth={oauth}
            onNext={() => transitionOAuthStep(2)}
          />
        ) : null}
        {oauthStep === 2 ? (
          <OAuthProviderClientStep
            canManage={canManage}
            canFinish={canFinishProvider}
            grant={grant}
            oauth={oauth}
            oauthClientId={oauthClientId}
            oauthClientSecret={oauthClientSecret}
            saving={saving}
            onBack={() => transitionOAuthStep(1)}
            onClientIdChange={setOauthClientId}
            onClientSecretChange={setOauthClientSecret}
            onFinish={async () => {
              if (!canFinishProvider) return;
              setSaving(true);
              onError(null);
              try {
                if (!providerConfigured || hasProviderInput) {
                  await onConfigureOAuthProvider(grant, {
                    clientId: oauthClientId,
                    clientSecret: oauthClientSecret || undefined,
                  });
                  setOauthClientSecret("");
                }
                transitionOAuthStep(3);
              } catch (error) {
                onError(
                  error instanceof Error
                    ? error.message
                    : "Unable to save OAuth provider.",
                );
              } finally {
                setSaving(false);
              }
            }}
          />
        ) : null}
        {oauthStep === 3 ? (
          <OAuthAllDoneStep
            grant={grant}
            providerName={providerName}
            onBack={() => transitionOAuthStep(2)}
            onClose={() => undefined}
            onOpenConnectedApps={() => {
              window.location.href = connectedAppsHref;
            }}
            hideClose
          />
        ) : null}
      </div>
    </div>
  );
}

function StaticIntegrationDetail({
  grant,
  canManage,
  onConnect,
  onError,
}: {
  grant: IntegrationGrant;
  canManage: boolean;
  onConnect: (
    grant: IntegrationGrant,
    secrets: Record<string, string>,
  ) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const configuredSecrets = new Set(
    grant.configuredSecrets.map((secret) => secret.toLowerCase()),
  );
  const canSubmit =
    canManage &&
    grant.secretRequirements.every((secret) => {
      if (secret.required === false) return true;
      if (configuredSecrets.has(secret.name.toLowerCase())) return true;
      return Boolean(secrets[secret.name]?.length);
    });
  const setup = grant.setupInstructions;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        onError(null);
        try {
          await onConnect(grant, secrets);
          toast.success(`${grant.name} saved`);
          setSecrets({});
        } catch (error) {
          onError(error instanceof Error ? error.message : "Unable to save integration.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <LockIcon className="mt-[3.5px] size-3 shrink-0" />
        <p className="min-w-0 flex-1 leading-relaxed">
          Secrets are injected <span className="text-foreground/80">only when</span>{" "}
          approved tools in{" "}
          <span className="text-foreground/80">{grant.appName}</span> call{" "}
          <span className="inline-block max-w-full align-bottom font-mono text-foreground/80 whitespace-nowrap">
            {grant.domain}
          </span>
        </p>
      </div>

      {setup?.steps.length ? (
        <div className="flex flex-col gap-5 rounded-lg border border-border/70 p-4">
          {setup.steps.map((step, index) => (
            <div key={`${step.title}-${index}`} className="flex gap-3">
              <div className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-medium text-muted-foreground">
                {index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">{step.title}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  <InlineMarkdownLinks text={step.description} />
                </p>
                {step.url ? (
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="mt-0.5 h-auto px-0"
                  >
                    <a href={step.url} target="_blank" rel="noreferrer">
                      Open link
                      <ExternalLinkIcon data-icon="inline-end" />
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {grant.secretRequirements.length > 0 ? (
        <FieldGroup className="gap-6 rounded-lg border border-border/70 p-4">
          {grant.secretRequirements.map((secret, secretIndex) => (
            <SecretField
              key={secret.name}
              secret={secret}
              autoFocus={secretIndex === 0}
              isSaved={configuredSecrets.has(secret.name.toLowerCase())}
              value={secrets[secret.name] ?? ""}
              onChange={(value) =>
                setSecrets((current) => ({ ...current, [secret.name]: value }))
              }
            />
          ))}
        </FieldGroup>
      ) : null}

      {!canManage ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
          An admin or owner must configure this workspace integration.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" size="lg" className="px-5 text-sm" disabled={!canSubmit || saving}>
          {saving ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}

type OAuthStepNumber = 1 | 2 | 3;

function OAuthStepIndicator({ currentStep }: { currentStep: OAuthStepNumber }) {
  const steps: Array<{ step: OAuthStepNumber; label: string }> = [
    { step: 1, label: "Setup" },
    { step: 2, label: "Client" },
    { step: 3, label: "Done" },
  ];

  return (
    <div className="mt-4 flex items-center justify-center gap-3">
      {steps.map((item) => {
        const completed = currentStep > item.step;
        const current = currentStep === item.step;
        return (
          <div
            key={item.step}
            className="flex flex-col items-center gap-1.5"
            aria-current={current ? "step" : undefined}
          >
            <div
              className={cn(
                "h-2 w-16 rounded-full transition-colors duration-300",
                completed
                  ? "bg-emerald-500"
                  : current
                    ? "bg-foreground"
                    : "bg-border",
              )}
            />
            <span
              className={cn(
                "text-[11px] transition-colors",
                completed
                  ? "font-medium text-emerald-600 dark:text-emerald-400"
                  : current
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
              )}
            >
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RedirectUriCopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Redirect URI copied");
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Unable to copy redirect URI");
    }
  }, [value]);

  return (
    <Field>
      <FieldLabel className="text-xs">Redirect URI</FieldLabel>
      <div className="relative">
        <Input
          readOnly
          value={value}
          className="cursor-copy border-foreground/20 bg-muted/30 pr-11 font-mono text-xs"
          onClick={(event) => {
            event.currentTarget.select();
            void copy();
          }}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1.5 size-7 -translate-y-1/2"
          onClick={copy}
          aria-label="Copy redirect URI"
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </Button>
      </div>
    </Field>
  );
}

function OAuthSetupStep({
  setup,
  oauth,
  onNext,
}: {
  setup: IntegrationGrant["setupInstructions"];
  oauth: IntegrationGrant["oauth"];
  onNext: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="rounded-lg border border-border/70 p-4">
          <div className="mb-4">
            <div className="text-sm font-medium">Setup steps</div>
          </div>

          {setup?.steps.length ? (
            <div className="flex flex-col gap-5">
              {setup.steps.map((step, index) => (
                <div key={`${step.title}-${index}`} className="flex gap-3">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-medium text-muted-foreground">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium leading-relaxed">
                      {step.title}
                    </div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                      <InlineMarkdownLinks text={step.description} />
                    </p>
                    {step.url ? (
                      <Button
                        asChild
                        variant="link"
                        size="sm"
                        className="mt-1 h-auto px-0"
                      >
                        <a href={step.url} target="_blank" rel="noreferrer">
                          Open link
                          <ExternalLinkIcon data-icon="inline-end" />
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {oauth ? (
          <div className="mt-4 rounded-lg border border-border/70 bg-muted/20 p-4">
            <RedirectUriCopyField value={oauth.redirectUri} />
            {!oauth.providerConfigMatchesGrant ? (
              <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
                The saved provider config does not match this app&apos;s approved
                OAuth URLs. Rotate the provider config for this grant before connecting.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <DialogFooter className="mt-4 shrink-0">
        <Button type="button" size="lg" className="px-5 text-sm" onClick={onNext}>
          Next
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </DialogFooter>
    </div>
  );
}

function OAuthProviderClientStep({
  canManage,
  canFinish,
  grant,
  oauth,
  oauthClientId,
  oauthClientSecret,
  saving,
  onBack,
  onClientIdChange,
  onClientSecretChange,
  onFinish,
}: {
  canManage: boolean;
  canFinish: boolean;
  grant: IntegrationGrant;
  oauth: IntegrationGrant["oauth"];
  oauthClientId: string;
  oauthClientSecret: string;
  saving: boolean;
  onBack: () => void;
  onClientIdChange: (value: string) => void;
  onClientSecretChange: (value: string) => void;
  onFinish: () => Promise<void>;
}) {
  return (
    <form
      className="flex h-full flex-col overflow-hidden"
      onSubmit={(event) => {
        event.preventDefault();
        void onFinish();
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="rounded-lg border border-border/70 p-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Provider client</div>
              <div className="text-xs text-muted-foreground">
                Paste the OAuth client credentials from the customer or local provider console.
              </div>
            </div>
            {oauth?.providerConfigured ? (
              <Badge variant="outline">Saved</Badge>
            ) : null}
          </div>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel className="text-xs">Client ID</FieldLabel>
              <Input
                value={oauthClientId}
                onChange={(event) => onClientIdChange(event.target.value)}
                placeholder={oauth?.providerConfigured ? "Paste to rotate" : "OAuth client ID"}
                disabled={!canManage || saving}
              />
            </Field>
            <Field>
              <FieldLabel className="text-xs">Client secret</FieldLabel>
              <Input
                type="password"
                data-sentry-mask
                value={oauthClientSecret}
                onChange={(event) => onClientSecretChange(event.target.value)}
                placeholder={
                  oauth?.providerConfigured
                    ? "Leave blank to keep saved secret"
                    : "OAuth client secret"
                }
                disabled={!canManage || saving}
              />
            </Field>
          </FieldGroup>
          {!canManage ? (
            <p className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
              An admin or owner must configure the workspace OAuth client before
              users can connect {grant.name}.
            </p>
          ) : null}
        </div>
      </div>

      <DialogFooter className="mt-4 shrink-0">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="px-5 text-sm"
          disabled={saving}
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          type="submit"
          size="lg"
          className="px-5 text-sm"
          disabled={!canFinish || saving}
        >
          {saving ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
          Finish
        </Button>
      </DialogFooter>
    </form>
  );
}

function OAuthAllDoneStep({
  grant,
  providerName,
  onBack,
  onClose,
  onOpenConnectedApps,
  hideClose = false,
}: {
  grant: IntegrationGrant;
  providerName: string;
  onBack: () => void;
  onClose: () => void;
  onOpenConnectedApps: () => void;
  hideClose?: boolean;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col items-center px-6 pt-24 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={grant.faviconUrl || fav(grant.domain)}
          alt=""
          className="size-14 rounded-xl border border-border bg-white p-2 shadow-sm"
        />
        <h3 className="mt-5 text-xl font-semibold tracking-tight">All done!</h3>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          This integration is now configured for the workspace. Connect your own{" "}
          <span className="text-foreground">{providerName}</span> from Connected Apps.
        </p>
        <Button
          type="button"
          size="lg"
          className="mt-5 px-5 text-sm"
          onClick={onOpenConnectedApps}
        >
          Connect your own {grant.name}
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>

      <DialogFooter className="mt-4 shrink-0">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="px-5 text-sm"
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="px-5 text-sm"
          onClick={onClose}
          hidden={hideClose}
        >
          Close
        </Button>
      </DialogFooter>
    </div>
  );
}

function SecretField({
  secret,
  autoFocus,
  isSaved,
  value,
  onChange,
}: {
  secret: IntegrationGrant["secretRequirements"][number];
  autoFocus: boolean;
  isSaved: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <Field>
      <div className="flex flex-wrap items-center gap-1.5">
        <FieldLabel className="font-mono text-xs">{secret.name}</FieldLabel>
        {isSaved ? <Badge variant="outline">Saved</Badge> : null}
        {secret.required === false ? <Badge variant="outline">Optional</Badge> : null}
      </div>
      <FieldDescription>{secret.description}</FieldDescription>
      <div className="relative">
        <Input
          autoFocus={autoFocus}
          type={visible ? "text" : "password"}
          data-sentry-mask
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            isSaved ? "Leave blank to keep saved value" : secret.label ?? secret.name
          }
          className="pr-9"
        />
        <button
          type="button"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => setVisible((current) => !current)}
          tabIndex={-1}
          aria-label={visible ? "Hide secret" : "Show secret"}
        >
          {visible ? (
            <EyeOffIcon className="size-3.5" />
          ) : (
            <EyeIcon className="size-3.5" />
          )}
        </button>
      </div>
    </Field>
  );
}

function ConfirmDialog({
  config,
  onClose,
  onError,
}: {
  config: ConfirmAction | null;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(false);
  }, [config]);

  return (
    <Dialog open={!!config} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{config?.title}</DialogTitle>
          <DialogDescription>{config?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={config?.destructive ? "destructive" : "default"}
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              onError(null);
              try {
                await config?.onConfirm();
                onClose();
              } catch (error) {
                onError(error instanceof Error ? error.message : "Action failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
            {config?.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
