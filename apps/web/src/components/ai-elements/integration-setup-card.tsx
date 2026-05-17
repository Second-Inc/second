"use client";

import { useMemo, useState } from "react";
import {
  ExternalLinkIcon,
  KeyRoundIcon,
  PlugZapIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InlineMarkdownLinks } from "@/components/inline-markdown-links";
import { integrationIconUrl } from "@/lib/integration-icons";

export type IntegrationSetupSecret = {
  name: string;
  label?: string;
  description: string;
  required?: boolean;
};

export type IntegrationSetupPermissionGroup = {
  name: string;
  description?: string;
  permissions: string[];
};

export type IntegrationSetupStep = {
  title: string;
  description: string;
  url?: string;
};

export type IntegrationSetupLink = {
  label: string;
  url: string;
};

export type IntegrationSetupItem = {
  name: string;
  domain: string;
  iconUrl?: string;
  faviconUrl?: string;
  keySlug?: string;
  keyName?: string;
  capabilityLabel?: string;
  why: string;
  permissionGroups: IntegrationSetupPermissionGroup[];
  secrets: IntegrationSetupSecret[];
  auth?: {
    type: "oauth2";
    providerKey: string;
    identity: "triggering_user";
    authorizationUrl: string;
    tokenUrl: string;
    scopes: string[];
    tokenAuthMethod?: string;
  };
  setupInstructions: {
    overview: string;
    steps: IntegrationSetupStep[];
    links?: IntegrationSetupLink[];
  };
};

export type IntegrationSetupData = {
  integrations: IntegrationSetupItem[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizePermissionGroups(value: unknown): IntegrationSetupPermissionGroup[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): IntegrationSetupPermissionGroup[] => {
    const record = asRecord(item);
    if (!record) return [];
    const name = asString(record.name).trim();
    if (!name) return [];
    return [{
      name,
      description: asString(record.description).trim() || undefined,
      permissions: Array.isArray(record.permissions)
        ? record.permissions.filter((permission): permission is string => typeof permission === "string")
        : [],
    }];
  });
}

function normalizeSecrets(value: unknown): IntegrationSetupSecret[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): IntegrationSetupSecret[] => {
    if (typeof item === "string") {
      const name = item.trim();
      return name
        ? [{
            name,
            description: `Paste the ${name} value for this integration.`,
            required: true,
          }]
        : [];
    }

    const record = asRecord(item);
    if (!record) return [];
    const name = asString(record.name).trim();
    if (!name) return [];
    return [{
      name,
      label: asString(record.label).trim() || undefined,
      description:
        asString(record.description).trim() ||
        `Paste the ${name} value for this integration.`,
      required:
        typeof record.required === "boolean" ? record.required : true,
    }];
  });
}

function normalizeSteps(value: unknown): IntegrationSetupStep[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const title = asString(record.title).trim();
    const description = asString(record.description).trim();
    if (!title || !description) return [];
    return [{
      title,
      description,
      url: asString(record.url).trim() || undefined,
    }];
  });
}

function normalizeLinks(value: unknown): IntegrationSetupLink[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const label = asString(record.label).trim();
    const url = asString(record.url).trim();
    return label && url ? [{ label, url }] : [];
  });
}

function normalizeIntegrations(value: unknown): IntegrationSetupItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const domain = asString(record.domain).trim();
    const name = asString(record.name, domain || "Integration").trim();
    if (!name) return [];

    const setupRecord = asRecord(record.setupInstructions);
    const authRecord = asRecord(record.auth);
    return [{
      name,
      domain,
      iconUrl: asString(record.iconUrl).trim() || undefined,
      faviconUrl: asString(record.faviconUrl).trim() || undefined,
      keySlug: asString(record.keySlug).trim() || "default",
      keyName: asString(record.keyName).trim() || undefined,
      capabilityLabel: asString(record.capabilityLabel).trim() || undefined,
      why: asString(record.why).trim(),
      permissionGroups: normalizePermissionGroups(record.permissionGroups),
      secrets: normalizeSecrets(
        record.secrets ?? record.secretRequirements ?? record.requiredSecrets,
      ),
      auth: authRecord?.type === "oauth2"
        ? {
            type: "oauth2",
            providerKey: asString(authRecord.providerKey).trim(),
            identity: "triggering_user",
            authorizationUrl: asString(authRecord.authorizationUrl).trim(),
            tokenUrl: asString(authRecord.tokenUrl).trim(),
            scopes: Array.isArray(authRecord.scopes)
              ? authRecord.scopes.filter(
                  (scope): scope is string => typeof scope === "string",
                )
              : [],
            tokenAuthMethod:
              asString(authRecord.tokenAuthMethod).trim() || undefined,
          }
        : undefined,
      setupInstructions: {
        overview:
          asString(setupRecord?.overview).trim() ||
          asString(record.overview).trim() ||
          asString(record.why).trim(),
        steps: normalizeSteps(setupRecord?.steps ?? record.steps),
        links: normalizeLinks(setupRecord?.links ?? record.links),
      },
    }];
  });
}

function instructionLabel(integrations: IntegrationSetupItem[]): string {
  if (integrations.length === 1) {
    return `Instructions on how to set up ${integrations[0].name} while I build your app`;
  }

  return `Instructions on how to set up ${integrations.length} integrations while I build your app`;
}

function requirementCount(integration: IntegrationSetupItem): number {
  const permissions = integration.permissionGroups.reduce(
    (count, group) => count + group.permissions.length,
    0,
  );
  return permissions + integration.secrets.length + (integration.auth ? 1 : 0);
}

function hostFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

export function IntegrationSetupCard({
  data,
  isStreaming,
}: {
  data: IntegrationSetupData;
  isStreaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const integrations = useMemo(
    () => normalizeIntegrations(data?.integrations),
    [data],
  );
  const selected = integrations[selectedIndex] ?? integrations[0];
  const label = useMemo(() => instructionLabel(integrations), [integrations]);

  if (integrations.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="not-prose flex w-full items-center gap-3 rounded-xl border border-border bg-[var(--composer-bg)] px-3.5 py-3 text-left transition-colors hover:bg-muted/30"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/70">
          <PlugZapIcon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {label}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            {integrations.slice(0, 3).map((integration) => (
              <span
                key={`${integration.domain}-${integration.name}`}
                className="inline-flex min-w-0 items-center gap-1"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={integrationIconUrl(integration)}
                  alt=""
                  width={12}
                  height={12}
                  className="size-3 rounded-sm"
                />
                <span className="truncate">{integration.name}</span>
              </span>
            ))}
          </div>
        </div>
        <Badge variant="secondary">
          {isStreaming ? "Preparing" : "Setup"}
        </Badge>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[82vh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Integration setup</DialogTitle>
            <DialogDescription>
              Follow these steps in the provider, then connect this app&apos;s
              integration key.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-col gap-4 overflow-auto pr-1">
            {integrations.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {integrations.map((integration, index) => (
                  <button
                    key={`${integration.domain}-${integration.name}`}
                    type="button"
                    onClick={() => setSelectedIndex(index)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                      index === selectedIndex
                        ? "border-foreground/40 bg-muted text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={integrationIconUrl(integration)}
                      alt=""
                      width={14}
                      height={14}
                      className="size-3.5 rounded-sm"
                    />
                    {integration.name}
                  </button>
                ))}
              </div>
            ) : null}

            {selected ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={integrationIconUrl(selected)}
                    alt=""
                    width={24}
                    height={24}
                    className="size-6 rounded-sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {selected.name}
                      </span>
                      <Badge variant="outline">
                        {requirementCount(selected)} requirements
                      </Badge>
                    </div>
                    {selected.setupInstructions.overview || selected.why ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        <InlineMarkdownLinks
                          text={selected.setupInstructions.overview || selected.why}
                        />
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <ShieldCheckIcon className="size-3.5 text-muted-foreground" />
                      Permissions
                    </div>
                    {selected.permissionGroups.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {selected.permissionGroups.map((group) => (
                          <div key={group.name} className="flex flex-col gap-1.5">
                            <div className="text-xs font-medium">
                              {group.name}
                            </div>
                            {group.description ? (
                              <p className="text-xs leading-relaxed text-muted-foreground">
                                {group.description}
                              </p>
                            ) : null}
                            <div className="flex flex-wrap gap-1.5">
                              {group.permissions.map((permission) => (
                                <Badge
                                  key={permission}
                                  variant="secondary"
                                  className="font-mono"
                                >
                                  {permission}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No provider permissions listed.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <KeyRoundIcon className="size-3.5 text-muted-foreground" />
                      {selected.auth?.type === "oauth2" ? "OAuth" : "Secrets"}
                    </div>
                    {selected.auth?.type === "oauth2" ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline">triggering_user</Badge>
                          <Badge variant="secondary" className="font-mono">
                            {selected.auth.providerKey}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Admin configures a customer-owned OAuth client, then
                          each user connects their own account.
                        </div>
                        <div className="flex flex-col gap-1 font-mono text-[10px] text-muted-foreground">
                          <span>auth: {hostFromUrl(selected.auth.authorizationUrl)}</span>
                          <span>token: {hostFromUrl(selected.auth.tokenUrl)}</span>
                        </div>
                        {selected.auth.scopes.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {selected.auth.scopes.map((scope) => (
                              <Badge
                                key={scope}
                                variant="secondary"
                                className="font-mono"
                              >
                                {scope}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : selected.secrets.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {selected.secrets.map((secret) => (
                          <div key={secret.name} className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-xs">
                                {secret.name}
                              </span>
                              {secret.required === false ? (
                                <Badge variant="outline">Optional</Badge>
                              ) : null}
                            </div>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {secret.description}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No secrets listed.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <div className="text-xs font-medium">Steps</div>
                  <div className="flex flex-col gap-3">
                    {selected.setupInstructions.steps.length > 0 ? (
                      selected.setupInstructions.steps.map((step, index) => (
                        <div key={`${step.title}-${index}`} className="flex gap-3">
                          <div className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] text-muted-foreground">
                            {index + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium">{step.title}</div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              <InlineMarkdownLinks text={step.description} />
                            </p>
                            {step.url ? (
                              <Button
                                asChild
                                variant="link"
                                size="sm"
                                className="mt-1 h-auto px-0"
                              >
                                <a
                                  href={step.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open link
                                  <ExternalLinkIcon data-icon="inline-end" />
                                </a>
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Setup steps are still streaming.
                      </p>
                    )}
                  </div>
                </div>

                {selected.setupInstructions.links?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {selected.setupInstructions.links.map((link) => (
                      <Button
                        key={link.url}
                        asChild
                        variant="outline"
                        size="sm"
                      >
                        <a href={link.url} target="_blank" rel="noreferrer">
                          {link.label}
                          <ExternalLinkIcon data-icon="inline-end" />
                        </a>
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
