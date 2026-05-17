"use client";

import { memo, useMemo } from "react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  PlugZapIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { AppLoader } from "@/components/app-loader";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PermissionGroup = {
  name: string;
  permissions: string[];
};

type AppIntegrationKey = {
  appId?: string;
  name: string;
  domain: string;
  keySlug?: string;
  authType?: "static_secret" | "oauth2";
  configured: boolean;
  oauth?: {
    providerKey?: string;
    scopes?: string[];
    providerConfigured?: boolean;
  } | null;
  configuredPermissionGroups?: PermissionGroup[];
  configuredSecrets?: string[];
  requestedPermissionGroups?: PermissionGroup[];
  requestedSecrets?: Array<{ name: string; required?: boolean }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonText(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  const record = asRecord(value);
  const content = record?.content;
  if (Array.isArray(content)) {
    const textPart = content.find((item) => {
      const part = asRecord(item);
      return part?.type === "text" && typeof part.text === "string";
    });
    const text = asRecord(textPart)?.text;
    if (typeof text === "string") return parseJsonText(text);
  }

  return value;
}

function normalizeIntegrations(output: unknown): AppIntegrationKey[] {
  const parsed = parseJsonText(output);
  const record = asRecord(parsed);
  const integrations = record?.integrations;
  if (!Array.isArray(integrations)) return [];

  return integrations.flatMap((item): AppIntegrationKey[] => {
    const integration = asRecord(item);
    if (!integration) return [];
    const name = typeof integration.name === "string" ? integration.name : "";
    const domain = typeof integration.domain === "string" ? integration.domain : "";
    if (!name && !domain) return [];

    return [{
      appId: typeof integration.appId === "string" ? integration.appId : undefined,
      name: name || domain,
      domain,
      keySlug: typeof integration.keySlug === "string" ? integration.keySlug : "default",
      authType: integration.authType === "oauth2" ? "oauth2" : "static_secret",
      configured: integration.configured === true,
      oauth: (() => {
        const oauth = asRecord(integration.oauth);
        if (!oauth) return null;
        return {
          providerKey: typeof oauth.providerKey === "string" ? oauth.providerKey : undefined,
          scopes: Array.isArray(oauth.scopes)
            ? oauth.scopes.filter((scope): scope is string => typeof scope === "string")
            : [],
          providerConfigured: oauth.providerConfigured === true,
        };
      })(),
      configuredPermissionGroups: Array.isArray(integration.configuredPermissionGroups)
        ? integration.configuredPermissionGroups.flatMap((group): PermissionGroup[] => {
            const record = asRecord(group);
            const name = typeof record?.name === "string" ? record.name : "";
            if (!name) return [];
            return [{
              name,
              permissions: Array.isArray(record?.permissions)
                ? record.permissions.filter((permission): permission is string => typeof permission === "string")
                : [],
            }];
          })
        : [],
      configuredSecrets: Array.isArray(integration.configuredSecrets)
        ? integration.configuredSecrets.filter((secret): secret is string => typeof secret === "string")
        : [],
      requestedPermissionGroups: Array.isArray(integration.requestedPermissionGroups)
        ? integration.requestedPermissionGroups.flatMap((group): PermissionGroup[] => {
            const record = asRecord(group);
            const name = typeof record?.name === "string" ? record.name : "";
            if (!name) return [];
            return [{
              name,
              permissions: Array.isArray(record?.permissions)
                ? record.permissions.filter((permission): permission is string => typeof permission === "string")
                : [],
            }];
          })
        : [],
      requestedSecrets: Array.isArray(integration.requestedSecrets)
        ? integration.requestedSecrets.flatMap((secret): Array<{ name: string; required?: boolean }> => {
            const record = asRecord(secret);
            const name = typeof record?.name === "string" ? record.name : "";
            if (!name) return [];
            return [{
              name,
              required: typeof record?.required === "boolean" ? record.required : true,
            }];
          })
        : [],
    }];
  });
}

function permissionKey(groupName: string, permission: string): string {
  return `${groupName.trim().toLowerCase()}::${permission.trim().toLowerCase()}`;
}

function missingRequirementCount(integration: AppIntegrationKey): number {
  if (integration.authType === "oauth2") {
    if (!integration.oauth?.providerConfigured) {
      return Math.max(1, integration.oauth?.scopes?.length ?? 0);
    }
    return 0;
  }

  if (!integration.configured) {
    const permissionCount = (integration.requestedPermissionGroups ?? []).reduce(
      (count, group) => count + (group.permissions?.length ?? 0),
      0,
    );
    const secretCount = (integration.requestedSecrets ?? []).filter(
      (secret) => secret.required !== false,
    ).length;
    return permissionCount + secretCount;
  }

  const configuredPermissions = new Set<string>();
  for (const group of integration.configuredPermissionGroups ?? []) {
    for (const permission of group.permissions ?? []) {
      configuredPermissions.add(permissionKey(group.name, permission));
    }
  }

  let missing = 0;
  for (const group of integration.requestedPermissionGroups ?? []) {
    for (const permission of group.permissions ?? []) {
      if (!configuredPermissions.has(permissionKey(group.name, permission))) {
        missing += 1;
      }
    }
  }

  const configuredSecrets = new Set(
    (integration.configuredSecrets ?? []).map((secret) => secret.toLowerCase()),
  );
  for (const secret of integration.requestedSecrets ?? []) {
    if (secret.required === false) continue;
    if (!configuredSecrets.has(secret.name.toLowerCase())) missing += 1;
  }

  return missing;
}

function statusLabel(integration: AppIntegrationKey): {
  label: string;
  tone: "connected" | "needed";
} {
  if (integration.authType === "oauth2") {
    if (integration.oauth?.providerConfigured) {
      return { label: "Provider saved", tone: "connected" };
    }
    return { label: "OAuth setup needed", tone: "needed" };
  }

  const missing = missingRequirementCount(integration);
  if (integration.configured && missing === 0) {
    return { label: "Connected", tone: "connected" };
  }
  return { label: missing > 0 ? `${missing} missing` : "Setup needed", tone: "needed" };
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function integrationNameFromDomain(domain: string): string | null {
  const normalized = domain.trim().toLowerCase().replace(/^https?:\/\//, "");
  const hostname = normalized.replace(/^www\./, "").split("/")[0];
  const parts = hostname.split(".").filter(Boolean);
  const candidate = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return candidate ? titleCase(candidate) : null;
}

function workspaceCheckTarget(
  input: Record<string, unknown> | undefined,
  integrations: AppIntegrationKey[],
  domainFilter: string | null,
): string | null {
  const explicitNameCandidates = [
    input?.name,
    input?.integration,
    input?.integrationName,
    input?.integration_name,
  ];

  for (const candidate of explicitNameCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (integrations.length === 1) return integrations[0].name;
  if (domainFilter) return integrationNameFromDomain(domainFilter);
  return null;
}

export const AppIntegrationKeysToolCard = memo(
  function AppIntegrationKeysToolCard({
    input,
    output,
    isRunning,
    isDone,
  }: {
    input: Record<string, unknown> | undefined;
    output: unknown;
    isRunning: boolean;
    isDone: boolean;
  }) {
    const integrations = useMemo(
      () => (isDone ? normalizeIntegrations(output) : []),
      [isDone, output],
    );
    const domainFilter = typeof input?.domain === "string" ? input.domain : null;
    const target = workspaceCheckTarget(input, integrations, domainFilter);
    const checkLabel = target
      ? `${isRunning ? "Checking" : "Checked"} this app's ${target} key`
      : `${isRunning ? "Checking" : "Checked"} this app's integration keys`;
    const missingCount = integrations.reduce(
      (count, integration) => count + missingRequirementCount(integration),
      0,
    );

    if (isRunning) {
      return (
        <div className="not-prose flex items-center gap-2 text-sm text-muted-foreground">
          <AppLoader size="xs" />
          <span>{checkLabel}</span>
          {domainFilter ? (
            <Badge variant="outline" className="font-mono">
              {domainFilter}
            </Badge>
          ) : null}
        </div>
      );
    }

    return (
      <div className="not-prose flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <PlugZapIcon className="size-4" />
        <span className="text-foreground/85">{checkLabel}</span>
        {domainFilter ? (
          <Badge variant="outline" className="font-mono">
            {domainFilter}
          </Badge>
        ) : null}
        {integrations.length > 0 ? (
          integrations.slice(0, 4).map((integration) => {
            const status = statusLabel(integration);
            return (
              <span
                key={`${integration.domain}-${integration.name}-${integration.keySlug ?? "default"}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                  status.tone === "connected"
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
                )}
              >
                {status.tone === "connected" ? (
                  <CheckCircle2Icon className="size-3" />
                ) : (
                  <AlertCircleIcon className="size-3" />
                )}
                <span>{integration.name}</span>
                {integration.authType === "oauth2" ? (
                  <span className="rounded bg-current/10 px-1 font-mono text-[10px]">
                    OAuth
                  </span>
                ) : null}
                <span className="text-current/65">{status.label}</span>
              </span>
            );
          })
        ) : null}
        {integrations.length > 4 ? (
          <Badge variant="secondary">+{integrations.length - 4}</Badge>
        ) : null}
        {missingCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheckIcon className="size-3" />
            <KeyRoundIcon className="size-3" />
          </span>
        ) : null}
      </div>
    );
  },
);
