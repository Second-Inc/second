"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  BotIcon,
  ChevronDownIcon,
  DatabaseIcon,
  GlobeIcon,
  KeyRoundIcon,
  Loader2,
  ShieldCheckIcon,
  WrenchIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  formatToolActionName,
  formatToolDisplayName,
} from "@/components/ai-elements/custom-tool-card";
import { integrationIconUrl } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
    auth?: {
      providerKey?: string;
      scopes?: string[];
    } | null;
  } | null;
  endpoint?: { method?: string; url?: string } | null;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function builtInLabel(name: string): string {
  if (name === "WebSearch") return "Web Search";
  if (name === "WebFetch") return "Web Fetch";
  return formatToolDisplayName(name);
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
// Panels
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

function ToolDetail({
  tool,
  workspaceId,
  onToggle,
}: {
  tool: AgentToolData;
  workspaceId: string;
  onToggle: () => void;
}) {
  const isCustom = tool.type === "custom";
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
        </div>
        <Switch checked={tool.enabled} onCheckedChange={onToggle} />
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
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-2.5 text-[11px] text-muted-foreground">
          <div className="flex min-w-0 items-center gap-1.5">
            <KeyRoundIcon className="size-3 shrink-0" />
            <span className="truncate">
              Requires{" "}
              <span className="text-foreground/80">{tool.integration.name}</span>{" "}
              integration
            </span>
          </div>
          <Link
            href={`/w/${workspaceId}/settings/integrations`}
            className="shrink-0 font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
          >
            Configure
          </Link>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resource tabs
// ---------------------------------------------------------------------------

function ResourceTabs({
  tools,
  dataCollections,
  workspaceId,
  onToggleTool,
}: {
  tools: AgentToolData[];
  dataCollections: string[];
  workspaceId: string;
  onToggleTool: (toolIndex: number) => void;
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
      return tool ? (
        <ToolDetail
          tool={tool}
          workspaceId={workspaceId}
          onToggle={() => onToggleTool(idx)}
        />
      ) : null;
    }
    if (active.startsWith("db:")) {
      const col = active.slice(3);
      return <DataDetail collection={col} />;
    }
    return null;
  })();

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
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
// System prompt
// ---------------------------------------------------------------------------

function SystemPromptBlock({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  const shouldClamp = !open && prompt.length > 180;

  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
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
        {prompt}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Agent Node
// ---------------------------------------------------------------------------

function AgentNode({
  agent,
  agentIndex,
  onToggleTool,
  workspaceId,
}: {
  agent: AgentData;
  agentIndex: number;
  onToggleTool: (agentIndex: number, toolIndex: number) => void;
  workspaceId: string;
}) {
  const tools = agent.tools ?? [];
  const dataCollections = agent.dataCollections ?? [];
  const hasResources = tools.length > 0 || dataCollections.length > 0;

  return (
    <div className="px-5 py-5 sm:px-6">
      <div className="flex items-start gap-3">
        <AgentAvatar seed={agent.id || agent.name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium">{agent.name}</span>
            <span className="font-mono text-[11px] text-muted-foreground/80">
              {agent.id}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {agent.description}
          </p>
        </div>
      </div>

      <div className="relative mt-3.5 flex gap-3">
        <div className="relative size-9 shrink-0">
          <div className="absolute left-[calc(50%-0.5px)] top-0 bottom-0 w-px bg-border/70" />
        </div>
        <div className="min-w-0 flex-1 space-y-3.5">
          {hasResources ? (
            <ResourceTabs
              tools={tools}
              dataCollections={dataCollections}
              workspaceId={workspaceId}
              onToggleTool={(toolIndex) => onToggleTool(agentIndex, toolIndex)}
            />
          ) : null}
          <SystemPromptBlock prompt={agent.systemPrompt} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentsPage() {
  const params = useParams<{ workspaceId: string; appId: string }>();
  const { workspaceId, appId } = params;
  const router = useRouter();

  const [agents, setAgents] = useState<AgentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/apps/${appId}/agents`,
      );
      if (res.ok) {
        const data = (await res.json()) as { agents: AgentData[] };
        setAgents(data.agents ?? []);
      }
    } catch {
      // best effort
    } finally {
      setLoading(false);
    }
  }, [workspaceId, appId]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const toggleTool = async (agentIndex: number, toolIndex: number) => {
    const updated = agents.map((agent, ai) => {
      if (ai !== agentIndex) return agent;
      return {
        ...agent,
        tools: agent.tools.map((tool, ti) => {
          if (ti !== toolIndex) return tool;
          return { ...tool, enabled: !tool.enabled };
        }),
      };
    });
    setAgents(updated);

    setSaving(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/apps/${appId}/agents`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents: updated }),
      });
      if (!response.ok) {
        fetchAgents();
        return;
      }

      const data = (await response.json().catch(() => null)) as
        | {
            reviewInvalidated?: boolean;
            draftCreatedFromPublished?: boolean;
          }
        | null;
      if (data?.reviewInvalidated) {
        toast.info("App changed. Review closed.", {
          description: "This app is back in draft. Send it for review again when ready.",
        });
        router.refresh();
      } else if (data?.draftCreatedFromPublished) {
        toast.info("Editing draft.", {
          description: "The published app is unchanged. Publish or request review when this draft is ready.",
        });
        router.refresh();
      }
    } catch {
      fetchAgents();
    } finally {
      setSaving(false);
    }
  };

  const toolCount = agents.reduce(
    (total, agent) => total + (agent.tools?.length ?? 0),
    0,
  );

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
        <div data-second-desktop-drag-region className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            onClick={() => router.back()}
            aria-label="Back"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">Agents</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              View and manage the agents defined for this app.
            </p>
          </div>
          {saving ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : agents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <BotIcon className="mx-auto mb-3 size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No agents defined for this app yet.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5 sm:px-6">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Configuration
              </span>
              <div className="ml-auto text-[11px] text-muted-foreground">
                {agents.length} agent{agents.length === 1 ? "" : "s"}
                {toolCount > 0 ? (
                  <>
                    <span className="mx-1.5 text-muted-foreground/50">·</span>
                    {toolCount} tool{toolCount === 1 ? "" : "s"}
                  </>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col divide-y divide-border">
              {agents.map((agent, agentIndex) => (
                <AgentNode
                  key={agent.id}
                  agent={agent}
                  agentIndex={agentIndex}
                  onToggleTool={toggleTool}
                  workspaceId={workspaceId}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
