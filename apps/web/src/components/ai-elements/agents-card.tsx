"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DatabaseIcon,
  GlobeIcon,
  KeyRoundIcon,
  PencilIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatToolActionName,
  formatToolDisplayName,
} from "@/components/ai-elements/custom-tool-card";
import { integrationIconUrl } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";

type AgentToolData = {
  type: "builtin" | "custom";
  name: string;
  displayName?: string;
  description?: string;
  enabled: boolean;
  recommended: boolean;
  integration?: {
    name: string;
    domain: string;
    keySlug?: string;
    setupSearchQuery?: string;
    auth?: {
      type: "static_secret" | "oauth2";
      providerKey?: string;
      identity?: "triggering_user";
      authorizationUrl?: string;
      tokenUrl?: string;
      scopes?: string[];
      tokenAuthMethod?: "client_secret_post" | "client_secret_basic" | "none";
      authorizationParams?: Record<string, string>;
      tokenParams?: Record<string, string>;
      accessTokenPlacement?: { type: "bearer_authorization_header" };
    };
  } | null;
  endpoint?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    queryParams?: Record<string, string>;
    body?: unknown;
  } | null;
  responseSchema?: { type: string; description?: string } | null;
  mockData?: unknown;
};

type AgentData = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  dataCollections?: string[];
  tools: AgentToolData[];
};

export type AgentsCardData = {
  agents: AgentData[];
};

type AgentsCardProps = {
  data: AgentsCardData;
  isStreaming: boolean;
  actionsEnabled: boolean;
  mockApprovalAcknowledged?: boolean;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
};

type AgentValidationIssue = {
  agentName: string;
  toolName: string;
  message: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function builtInLabel(name: string): string {
  if (name === "WebSearch") return "Web Search";
  if (name === "WebFetch") return "Web Fetch";
  return formatToolDisplayName(name);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function hostFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function collectTemplateNames(value: unknown, names: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) {
      if (match[1]) names.add(match[1]);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectTemplateNames(item, names);
    return;
  }

  const record = asRecord(value);
  if (record) {
    for (const item of Object.values(record)) collectTemplateNames(item, names);
  }
}

function isSecretLikePlaceholder(name: string): boolean {
  if (isSecretPlaceholderName(name)) return false;
  return /(^|[_.-])(api[_-]?key|key|secret|token|password|bearer|auth)([_.-]|$)/i.test(
    name,
  );
}

function isSecretPlaceholderName(name: string): boolean {
  return name.startsWith("secrets.") && name.length > "secrets.".length;
}

function isTokenPlaceholderName(name: string): boolean {
  return /(^|[_.-])(oauth|access[_-]?token|refresh[_-]?token|bearer|token|secret)([_.-]|$)/i.test(
    name,
  );
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function endpointUsesNamedSecret(endpoint: AgentToolData["endpoint"]): boolean {
  if (!endpoint) return false;
  const names = new Set<string>();
  collectTemplateNames(endpoint, names);
  return [...names].some(isSecretPlaceholderName);
}

function secretLikeEndpointPlaceholders(
  endpoint: AgentToolData["endpoint"],
): string[] {
  if (!endpoint) return [];
  const names = new Set<string>();
  collectTemplateNames(endpoint, names);
  return [...names].filter(isSecretLikePlaceholder);
}

function endpointDeclaresAuthorizationHeader(endpoint: AgentToolData["endpoint"]): boolean {
  return Object.keys(endpoint?.headers ?? {}).some(
    (name) => name.toLowerCase() === "authorization",
  );
}

function isPublicUnauthenticatedTool(tool: AgentToolData): boolean {
  return (
    tool.type === "custom" &&
    !tool.integration?.auth &&
    !endpointUsesNamedSecret(tool.endpoint) &&
    secretLikeEndpointPlaceholders(tool.endpoint).length === 0 &&
    !endpointDeclaresAuthorizationHeader(tool.endpoint)
  );
}

function normalizeTool(value: unknown): AgentToolData | null {
  const record = asRecord(value);
  if (!record) return null;

  const type = record.type === "builtin" ? "builtin" : "custom";
  const name = asString(record.name).trim();
  if (!name) return null;

  const integration = asRecord(record.integration);
  const endpoint = asRecord(record.endpoint);
  const auth = asRecord(integration?.auth);

  return {
    type,
    name,
    displayName: asString(record.displayName).trim() || undefined,
    description: asString(record.description).trim() || undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    recommended:
      typeof record.recommended === "boolean" ? record.recommended : false,
    integration: integration
      ? {
          name: asString(integration.name).trim(),
          domain: asString(integration.domain).trim(),
          keySlug: asString(integration.keySlug).trim() || "default",
          setupSearchQuery:
            asString(integration.setupSearchQuery).trim() || undefined,
          auth: auth?.type === "oauth2"
            ? {
                type: "oauth2",
                providerKey: asString(auth.providerKey).trim(),
                identity:
                  auth.identity === "triggering_user"
                    ? "triggering_user"
                    : undefined,
                authorizationUrl: asString(auth.authorizationUrl).trim(),
                tokenUrl: asString(auth.tokenUrl).trim(),
                scopes: Array.isArray(auth.scopes)
                  ? auth.scopes.filter(
                      (scope): scope is string => typeof scope === "string",
                    )
                  : [],
                tokenAuthMethod:
                  auth.tokenAuthMethod === "client_secret_basic" ||
                  auth.tokenAuthMethod === "none"
                    ? auth.tokenAuthMethod
                    : "client_secret_post",
                authorizationParams: asRecord(auth.authorizationParams) as
                  | Record<string, string>
                  | undefined,
                tokenParams: asRecord(auth.tokenParams) as
                  | Record<string, string>
                  | undefined,
                accessTokenPlacement: { type: "bearer_authorization_header" },
              }
            : auth?.type === "static_secret"
              ? { type: "static_secret" }
              : undefined,
        }
      : null,
    endpoint: endpoint
      ? {
          method: asString(endpoint.method),
          url: asString(endpoint.url),
          headers:
            asRecord(endpoint.headers) as Record<string, string> | undefined,
          queryParams:
            asRecord(endpoint.queryParams) as Record<string, string> | undefined,
          body: endpoint.body,
        }
      : null,
    responseSchema: asRecord(record.responseSchema) as
      | { type: string; description?: string }
      | null,
    mockData: record.mockData,
  };
}

function validateAgents(agents: AgentData[]): AgentValidationIssue[] {
  const issues: AgentValidationIssue[] = [];

  for (const agent of agents) {
    const agentName = agent.name || agent.id || "Agent";
    for (const tool of agent.tools ?? []) {
      if (tool.type !== "custom") continue;

      const toolName = toolDisplayName(tool);
      if (!tool.integration?.name || !tool.integration.domain) {
        issues.push({
          agentName,
          toolName,
          message: "Custom tools must declare their integration name and domain.",
        });
      }

      if (!tool.endpoint) {
        issues.push({
          agentName,
          toolName,
          message: "Custom tools must include an endpoint with method and URL.",
        });
        continue;
      }

      if (!tool.endpoint.method.trim()) {
        issues.push({
          agentName,
          toolName,
          message: "Custom tool endpoint is missing the HTTP method.",
        });
      }

      if (!tool.endpoint.url.trim()) {
        issues.push({
          agentName,
          toolName,
          message: "Custom tool endpoint is missing the request URL.",
        });
      }

      const secretPlaceholders = secretLikeEndpointPlaceholders(tool.endpoint);
      if (tool.integration?.auth?.type === "oauth2") {
        const auth = tool.integration.auth;
        if (!auth.providerKey) {
          issues.push({ agentName, toolName, message: "OAuth tools require integration.auth.providerKey." });
        }
        if (auth.identity !== "triggering_user") {
          issues.push({ agentName, toolName, message: "OAuth tools must use the triggering_user identity." });
        }
        if (!isHttpsUrl(auth.authorizationUrl)) {
          issues.push({ agentName, toolName, message: "OAuth tools require an HTTPS authorization URL." });
        }
        if (!isHttpsUrl(auth.tokenUrl)) {
          issues.push({ agentName, toolName, message: "OAuth tools require an HTTPS token URL." });
        }
        if (!auth.scopes?.length) {
          issues.push({ agentName, toolName, message: "OAuth tools require at least one exact scope." });
        }
        const names = new Set<string>();
        collectTemplateNames(tool.endpoint, names);
        const rejected = [...names].filter(
          (name) => isSecretPlaceholderName(name) || isTokenPlaceholderName(name),
        );
        if (rejected.length > 0) {
          issues.push({
            agentName,
            toolName,
            message: `OAuth tools must not include token or secret placeholders (${rejected.map((name) => `{{${name}}}`).join(", ")}).`,
          });
        }
        if (
          Object.keys(tool.endpoint.headers ?? {}).some(
            (name) => name.toLowerCase() === "authorization",
          )
        ) {
          issues.push({
            agentName,
            toolName,
            message: "OAuth tools must not declare an Authorization header.",
          });
        }
      } else {
        if (secretPlaceholders.length > 0) {
          issues.push({
            agentName,
            toolName,
            message: `Use {{secrets.SECRET_NAME}} for saved integration secrets, not ${secretPlaceholders.map((name) => `{{${name}}}`).join(", ")}.`,
          });
        }

        if (
          !endpointUsesNamedSecret(tool.endpoint) &&
          endpointDeclaresAuthorizationHeader(tool.endpoint)
        ) {
          issues.push({
            agentName,
            toolName,
            message: "Unauthenticated public tools must not declare an Authorization header. Use {{secrets.SECRET_NAME}} for static credentials or OAuth auth metadata.",
          });
        }
      }
    }
  }

  return issues;
}

function normalizeAgent(value: unknown): AgentData | null {
  const record = asRecord(value);
  if (!record) return null;

  const id = asString(record.id).trim();
  const name = asString(record.name, id || "Agent").trim();
  if (!id && !name) return null;

  return {
    id,
    name,
    description: asString(record.description).trim(),
    systemPrompt: asString(record.systemPrompt),
    dataCollections: Array.isArray(record.dataCollections)
      ? record.dataCollections.filter((item): item is string => typeof item === "string")
      : [],
    tools: Array.isArray(record.tools)
      ? record.tools.flatMap((tool) => {
          const normalized = normalizeTool(tool);
          return normalized ? [normalized] : [];
        })
      : [],
  };
}

function toolDisplayName(tool: AgentToolData): string {
  return tool.type === "builtin"
    ? builtInLabel(tool.name)
    : tool.displayName?.trim() ||
        formatToolActionName(tool.name, tool.integration?.name);
}

function toolCategory(tool: AgentToolData): string {
  return tool.type === "builtin" ? "Built-in" : tool.integration?.name ?? "Custom";
}

function ToolIcon({ tool }: { tool: AgentToolData }) {
  if (tool.type === "custom" && tool.integration?.domain) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={integrationIconUrl({
          name: tool.integration.name,
          domain: tool.integration.domain,
          endpointUrl: tool.endpoint?.url,
          auth: tool.integration.auth,
        })}
        alt=""
        width={14}
        height={14}
        className="size-3.5 shrink-0 rounded-sm"
      />
    );
  }
  return <GlobeIcon className="size-3 shrink-0 text-muted-foreground" />;
}

// ---------------------------------------------------------------------------
// Agent avatar — deterministic gradient circle keyed on agent id/name
// ---------------------------------------------------------------------------

const AGENT_GRADIENTS = [
  "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
  "linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)",
  "linear-gradient(to right, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(to top, #30cfd0 0%, #330867 100%)",
  "linear-gradient(to top, #fddb92 0%, #d1fdff 100%)",
  "linear-gradient(to right, #eea2a2 0%, #bbc1bf 19%, #57c6e1 42%, #b49fda 79%, #7ac5d8 100%)",
  "linear-gradient(to top, #fff1eb 0%, #ace0f9 100%)",
  "linear-gradient(to right, #f78ca0 0%, #f9748f 19%, #fd868c 60%, #fe9a8b 100%)",
  "linear-gradient(to top, #accbee 0%, #e7f0fd 100%)",
  "linear-gradient(to right, #74ebd5 0%, #9face6 100%)",
];

function pickAgentGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return AGENT_GRADIENTS[Math.abs(hash) % AGENT_GRADIENTS.length];
}

function AgentAvatar({ seed }: { seed: string }) {
  return (
    <div
      className="size-9 shrink-0 rounded-full ring-1 ring-border/40"
      style={{ backgroundImage: pickAgentGradient(seed) }}
    />
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

type TabItem = {
  key: string;
  icon?: React.ReactNode;
  label: string;
  mono?: boolean;
  dimmed?: boolean;
};

function TabButton({
  tab,
  active,
  onClick,
}: {
  tab: TabItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-xs transition-colors",
        active
          ? "border-foreground/45 text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground/85",
        tab.dimmed && "opacity-60",
      )}
    >
      {tab.icon}
      <span
        className={cn(
          "truncate max-w-[140px]",
          tab.mono ? "font-mono text-[11px]" : "font-medium",
        )}
      >
        {tab.label}
      </span>
    </button>
  );
}

/** "Folder tab" style — active merges into the content below by matching
 *  its background and shifting down 1px to cover the row divider. */
function GroupTabButton({
  tab,
  active,
  onClick,
}: {
  tab: TabItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-3 text-xs font-medium transition-colors",
        active
          ? "-mb-px bg-card text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {tab.icon}
      <span className="truncate max-w-[140px]">{tab.label}</span>
    </button>
  );
}


// ---------------------------------------------------------------------------
// Tool / Data detail panels (rendered inside the active tab)
// ---------------------------------------------------------------------------

function MethodPill({ method }: { method: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
      {method.toUpperCase()}
    </span>
  );
}

function DataDetail({ collection }: { collection: string }) {
  return (
    <div className="text-xs">
      <div className="flex items-center gap-2">
        <DatabaseIcon className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-[13px] text-foreground">
          {collection}
        </span>
        <Badge variant="outline" className="ml-auto">
          Collection
        </Badge>
      </div>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        The agent reads from and writes to{" "}
        <span className="font-mono text-foreground/80">{collection}</span> at
        runtime.
      </p>
    </div>
  );
}

function ToolDetail({ tool }: { tool: AgentToolData }) {
  const isCustom = tool.type === "custom";
  const isPublicTool = isPublicUnauthenticatedTool(tool);
  const domain = tool.integration?.domain;
  const description =
    tool.description ||
    (tool.type === "builtin"
      ? `Using the built-in agent ${toolDisplayName(tool)} tool.`
      : null);

  return (
    <div className="text-xs">
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
          {isCustom && domain ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={integrationIconUrl({
                name: tool.integration?.name,
                domain,
                endpointUrl: tool.endpoint?.url,
                auth: tool.integration?.auth,
              })}
              alt=""
              width={16}
              height={16}
              className="size-4 rounded-sm"
            />
          ) : (
            <GlobeIcon className="size-3.5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] font-medium">
            <span className="text-muted-foreground">{toolCategory(tool)}</span>
            <span className="text-foreground">{toolDisplayName(tool)}</span>
          </div>
          {!tool.enabled ? (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Disabled
            </div>
          ) : null}
        </div>
      </div>

      {isCustom && tool.endpoint?.url ? (
        <div className="mt-3 flex items-center gap-1.5 overflow-hidden rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5 text-[11px] font-mono">
          {tool.endpoint.method ? (
            <MethodPill method={tool.endpoint.method} />
          ) : null}
          <span className="truncate text-muted-foreground">
            {tool.endpoint.url}
          </span>
        </div>
      ) : null}

      {description ? (
        <p className="mt-3 leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}

      {isCustom && tool.integration?.name ? (
        <div className="mt-3 border-t border-border/70 pt-2.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            {isPublicTool ? (
              <GlobeIcon className="size-3" />
            ) : (
              <KeyRoundIcon className="size-3" />
            )}
            {isPublicTool ? (
              <span>
                Uses public{" "}
                <span className="text-foreground/80">{tool.integration.name}</span>{" "}
                API
              </span>
            ) : (
              <span>
                Requires{" "}
                <span className="text-foreground/80">{tool.integration.name}</span>{" "}
                integration
              </span>
            )}
            {isPublicTool ? (
              <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[10px]">
                Public
              </Badge>
            ) : tool.integration.auth?.type === "oauth2" ? (
              <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[10px]">
                OAuth
              </Badge>
            ) : null}
          </div>
          {tool.integration.auth?.type === "oauth2" ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
                  {tool.integration.auth.providerKey}
                </span>
                <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
                  triggering_user
                </span>
                {hostFromUrl(tool.integration.auth.tokenUrl) ? (
                  <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
                    token: {hostFromUrl(tool.integration.auth.tokenUrl)}
                  </span>
                ) : null}
              </div>
              {tool.integration.auth.scopes?.length ? (
                <div className="flex flex-wrap gap-1">
                  {tool.integration.auth.scopes.map((scope) => (
                    <span
                      key={scope}
                      className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resource tabs — tools first, then data collections
// ---------------------------------------------------------------------------

function ResourceTabs({
  tools,
  dataCollections,
}: {
  tools: AgentToolData[];
  dataCollections: string[];
}) {
  const hasTools = tools.length > 0;
  const hasData = dataCollections.length > 0;
  const hasBoth = hasTools && hasData;

  const initial = hasTools ? `tool:0` : hasData ? `db:${dataCollections[0]}` : "";
  const [active, setActive] = useState<string>(initial);
  if (!hasTools && !hasData) return null;

  const activeGroup: "tools" | "data" = active.startsWith("db:")
    ? "data"
    : "tools";

  const activePanel = (() => {
    if (active.startsWith("tool:")) {
      const idx = Number(active.slice(5));
      const tool = tools[idx];
      return tool ? <ToolDetail tool={tool} /> : null;
    }
    if (active.startsWith("db:")) {
      const col = active.slice(3);
      return <DataDetail collection={col} />;
    }
    return null;
  })();

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Row 1 — Group tabs (only if both groups exist) */}
      {hasBoth ? (
        <div className="flex items-stretch border-b border-border bg-muted/40">
          <GroupTabButton
            tab={{
              key: "group:tools",
              icon: <WrenchIcon className="size-3" />,
              label: "Tools",
            }}
            active={activeGroup === "tools"}
            onClick={() => setActive(`tool:0`)}
          />
          <div className="my-2.5 w-px bg-border" aria-hidden />
          <GroupTabButton
            tab={{
              key: "group:data",
              icon: <DatabaseIcon className="size-3" />,
              label: "Data",
            }}
            active={activeGroup === "data"}
            onClick={() => setActive(`db:${dataCollections[0]}`)}
          />
        </div>
      ) : null}

      {/* Row 2 — Items in the active group */}
      <div className="flex items-stretch overflow-x-auto border-b border-border">
        {activeGroup === "tools"
          ? tools.map((tool, i) => {
              const key = `tool:${i}`;
              return (
                <TabButton
                  key={key}
                  tab={{
                    key,
                    icon: <ToolIcon tool={tool} />,
                    label: toolDisplayName(tool),
                    dimmed: !tool.enabled,
                  }}
                  active={active === key}
                  onClick={() => setActive(key)}
                />
              );
            })
          : dataCollections.map((col) => {
              const key = `db:${col}`;
              return (
                <TabButton
                  key={key}
                  tab={{ key, label: col, mono: true }}
                  active={active === key}
                  onClick={() => setActive(key)}
                />
              );
            })}
      </div>

      <div className="p-3">{activePanel}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System prompt — line-clamped preview with fade-out + click-to-expand
// ---------------------------------------------------------------------------

function SystemPromptBlock({ prompt }: { prompt?: string }) {
  const [open, setOpen] = useState(false);
  const safePrompt = prompt ?? "";
  const shouldClamp = !open && safePrompt.length > 180;
  const toggleOpen = () => setOpen((value) => !value);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={toggleOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleOpen();
      }}
      className="block w-full overflow-hidden rounded-lg border border-border bg-card text-left"
    >
      {/* Top bar — single "tab" that merges with the content below */}
      <div className="flex items-stretch border-b border-border bg-muted/40">
        <div className="relative inline-flex shrink-0 items-center gap-1.5 -mb-px bg-card px-3.5 py-3 text-xs font-medium">
          <ShieldCheckIcon className="size-3" />
          System Prompt
        </div>
        <div className="ml-auto flex items-center pr-3 text-muted-foreground">
          <ChevronDownIcon
            className={cn(
              "size-3 transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </div>

      {/* Content */}
      <div
        className={cn(
          "whitespace-pre-wrap px-3 py-3 text-xs leading-relaxed text-foreground/75",
          shouldClamp && "max-h-20 overflow-hidden",
        )}
        style={
          shouldClamp
            ? {
                maskImage:
                  "linear-gradient(to bottom, black 55%, transparent 100%)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, black 55%, transparent 100%)",
              }
            : undefined
        }
      >
        {safePrompt || "System prompt is still streaming."}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Node
// ---------------------------------------------------------------------------

function AgentNode({ agent }: { agent: AgentData }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const tools = agent.tools ?? [];
  const dataCollections = agent.dataCollections ?? [];
  const displayName = agent.name || agent.id || "Agent";
  const hasTools = tools.length > 0;
  const hasData = dataCollections.length > 0;
  const hasPrompt = Boolean(agent.systemPrompt);

  return (
    <div
      className="w-[calc(100%-3rem)] shrink-0 snap-start rounded-2xl bg-[var(--composer-bg)] flex flex-col"
      style={{ boxShadow: "var(--composer-shadow)" }}
    >
      {/* Header — avatar left-aligned with name + description */}
      <div className="flex items-start gap-3.5 px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
        <div
          className="size-11 shrink-0 rounded-full ring-1 ring-border/20"
          style={{ backgroundImage: pickAgentGradient(agent.id || displayName) }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{displayName}</div>
          {agent.description ? (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {agent.description}
            </p>
          ) : null}
        </div>
      </div>

      {/* Tools — tabbed view */}
      {hasTools && (
        <div className="border-t border-border/30 px-5 py-4 sm:px-6">
          <div className="text-[11px] font-medium text-muted-foreground/50 mb-2">
            Tools
          </div>
          <ResourceTabs tools={tools} dataCollections={[]} />
        </div>
      )}

      {/* Data collections */}
      {hasData && (
        <div className="border-t border-border/30 px-5 py-4 sm:px-6">
          <div className="text-[11px] font-medium text-muted-foreground/50 mb-2">
            Data
          </div>
          <ResourceTabs tools={[]} dataCollections={dataCollections} />
        </div>
      )}

      {/* System prompt — always visible, truncated with expand */}
      {hasPrompt && (
        <div className="border-t border-border/30 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => setPromptOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/50 mb-2 transition-colors hover:text-muted-foreground"
          >
            System Prompt
            <ChevronDownIcon
              className={cn(
                "size-3 transition-transform duration-200",
                promptOpen && "rotate-180",
              )}
            />
          </button>
          <div
            className={cn(
              "relative text-[12.5px] leading-relaxed text-muted-foreground overflow-hidden transition-all duration-200",
              promptOpen ? "max-h-[500px]" : "max-h-[3.5em]",
            )}
          >
            {agent.systemPrompt}
            {!promptOpen && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-b from-transparent to-[var(--composer-bg)]" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level card
// ---------------------------------------------------------------------------

export function AgentsCard({
  data,
  isStreaming,
  actionsEnabled,
  mockApprovalAcknowledged = false,
  onApprove,
  onRequestChanges,
}: AgentsCardProps) {
  const [editMode, setEditMode] = useState(false);
  const [feedback, setFeedback] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const agents = Array.isArray(data?.agents)
    ? data.agents.flatMap((agent) => {
        const normalized = normalizeAgent(agent);
        return normalized ? [normalized] : [];
      })
    : [];
  const hasAgents = agents.length > 0;
  const singleAgent = agents.length === 1;
  const toolCount = agents.reduce(
    (total, agent) => total + (agent.tools?.length ?? 0),
    0,
  );
  const validationIssues = validateAgents(agents);
  const hasValidationIssues = validationIssues.length > 0;

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  const scroll = useCallback((direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = el.querySelector(":scope > div")?.clientWidth ?? 350;
    el.scrollBy({ left: direction === "left" ? -cardWidth - 16 : cardWidth + 16, behavior: "smooth" });
  }, []);

  // Initialize scroll state after mount/update
  const scrollRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      if (node) {
        updateScrollState();
        node.addEventListener("scroll", updateScrollState, { passive: true });
      }
    },
    [updateScrollState],
  );

  return (
    <div className="not-prose space-y-4">
      {/* Header — floating section */}
      <div
        className="rounded-2xl bg-[var(--composer-bg)] px-5 pt-6 pb-4 sm:px-6 sm:pt-7 sm:pb-5"
        style={{ boxShadow: "var(--composer-shadow)" }}
      >
        <div>
          <div className="text-[11px] font-medium text-muted-foreground/50 mb-2.5">
            Agents
          </div>
          <span className="text-[15px] font-semibold tracking-[-0.01em]">
            {hasAgents
              ? `${agents.length} agent${agents.length === 1 ? "" : "s"} with ${toolCount} tool${toolCount === 1 ? "" : "s"}`
              : "Agent configuration"}
          </span>
          {hasValidationIssues ? (
            <Badge variant="destructive" className="gap-1 ml-2 align-middle">
              <AlertTriangleIcon className="size-2.5" />
              Needs Fix
            </Badge>
          ) : null}

          {/* Actions */}
          {!editMode ? (
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Button
              className="rounded-full h-8 px-3.5 text-[13px]"
              disabled={!actionsEnabled || hasValidationIssues}
              onClick={onApprove}
            >
              Approve
            </Button>
            <Button
              variant="outline"
              className="rounded-full h-8 !pl-3 pr-3.5 text-[13px]"
              disabled={!actionsEnabled}
              onClick={() => setEditMode(true)}
            >
              <PencilIcon data-icon="inline-start" />
              Request Changes
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What would you like to change about the agent configuration?"
              rows={3}
              className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                className="rounded-full h-8 px-3.5 text-[13px]"
                disabled={!feedback.trim()}
                onClick={() => {
                  onRequestChanges(feedback.trim());
                  setEditMode(false);
                  setFeedback("");
                }}
              >
                Send Feedback
              </Button>
              <Button
                variant="ghost"
                className="rounded-full h-8 px-3.5 text-[13px]"
                onClick={() => {
                  setEditMode(false);
                  setFeedback("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Agent carousel */}
      {hasAgents ? (
        <div className="relative">
          <div
            ref={scrollRefCallback}
            className={cn(
              "flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory py-1 scrollbar-none",
              singleAgent && "justify-center snap-none",
            )}
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {agents.map((agent, index) => (
              <AgentNode key={`${agent.id}-${index}`} agent={agent} />
            ))}
          </div>

          {/* Left arrow */}
          {!singleAgent && (
            <button
              type="button"
              onClick={() => scroll("left")}
              className={cn(
                "absolute left-1 top-1/2 -translate-y-1/2 flex size-8 items-center justify-center rounded-full bg-background shadow-md ring-1 ring-border/50 text-foreground/70 transition-all hover:bg-muted",
                canScrollLeft ? "opacity-100" : "opacity-0 pointer-events-none",
              )}
            >
              <ChevronLeftIcon className="size-4" />
            </button>
          )}

          {/* Right arrow */}
          {!singleAgent && (
            <button
              type="button"
              onClick={() => scroll("right")}
              className={cn(
                "absolute right-1 top-1/2 -translate-y-1/2 flex size-8 items-center justify-center rounded-full bg-background shadow-md ring-1 ring-border/50 text-foreground/70 transition-all hover:bg-muted",
                canScrollRight ? "opacity-100" : "opacity-0 pointer-events-none",
              )}
            >
              <ChevronRightIcon className="size-4" />
            </button>
          )}
        </div>
      ) : isStreaming ? (
        <Skeleton className="h-28 rounded-2xl" />
      ) : (
        <div className="text-sm text-muted-foreground">
          No agents found in the presented configuration.
        </div>
      )}

      {/* Validation issues */}
      {hasValidationIssues ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangleIcon className="size-3.5" />
            Agent configuration needs changes before approval
          </div>
          <div className="mt-2 flex flex-col gap-1.5 text-[11px] leading-relaxed">
            {validationIssues.map((issue, index) => (
              <div key={`${issue.agentName}-${issue.toolName}-${index}`}>
                <span className="font-medium">{issue.toolName}</span>
                <span className="text-destructive/75">
                  {" "}
                  in {issue.agentName}: {issue.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Mock approval notice */}
      {mockApprovalAcknowledged ? (
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>Approved for mock-data development</AlertTitle>
          <AlertDescription>
            Continue building with these agents, but use mock data for
            integrations until this app is reviewed by an admin or owner.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
