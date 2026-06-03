"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  Handle,
  Position,
  useNodesState,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  BotIcon,
  ChevronRightIcon,
  DatabaseIcon,
  GlobeIcon,
  KeyRoundIcon,
  Loader2,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import {
  formatToolActionName,
  formatToolDisplayName,
} from "@/components/ai-elements/custom-tool-card";
import { integrationIconUrl } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types — mirrors the shape returned by the app agents endpoint
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
// Tool + agent display helpers
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
  return tool.type === "builtin"
    ? "Built-in"
    : tool.integration?.name ?? "Custom";
}

/** Stable identity so the same tool used by several agents collapses to one node. */
function toolKey(tool: AgentToolData): string {
  return tool.type === "builtin"
    ? `builtin:${tool.name}`
    : `custom:${tool.integration?.domain ?? ""}:${tool.name}`;
}

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

function ToolGlyph({ tool, size = 14 }: { tool: AgentToolData; size?: number }) {
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
        width={size}
        height={size}
        className="shrink-0 rounded-sm"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <GlobeIcon
      className="shrink-0 text-muted-foreground"
      style={{ width: size, height: size }}
    />
  );
}

// ---------------------------------------------------------------------------
// Focus context — drives hover/select "spotlight" highlighting without
// churning the nodes array on every pointer move.
// ---------------------------------------------------------------------------

type FocusValue = {
  focusId: string | null;
  connectedIds: Set<string>;
  selectedAgentId: string | null;
};

const FocusContext = createContext<FocusValue>({
  focusId: null,
  connectedIds: new Set(),
  selectedAgentId: null,
});

function useNodeFocusState(nodeId: string) {
  const { focusId, connectedIds, selectedAgentId } = useContext(FocusContext);
  const active = focusId !== null;
  return {
    dimmed: active && !connectedIds.has(nodeId),
    focused: focusId === nodeId,
    pinned: selectedAgentId === nodeId,
  };
}

// ---------------------------------------------------------------------------
// Node data shapes
// ---------------------------------------------------------------------------

type AgentNodeData = {
  agent: AgentData;
  gradient: string;
  toolCount: number;
  dataCount: number;
};

type ToolNodeData = {
  tool: AgentToolData;
  label: string;
  category: string;
  agentCount: number;
};

type DbNodeData = {
  collection: string;
  agentCount: number;
};

type AppNode = Node<AgentNodeData | ToolNodeData | DbNodeData>;

const HANDLE_CLASS = "!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent";

// ---------------------------------------------------------------------------
// Agent node — the hero card
// ---------------------------------------------------------------------------

function AgentNode({ id, data }: NodeProps) {
  const d = data as AgentNodeData;
  const { dimmed, focused, pinned } = useNodeFocusState(id);

  return (
    <div
      className={cn(
        "group w-[290px] cursor-pointer select-none rounded-2xl bg-card p-3.5 shadow-sm ring-1 ring-foreground/10 transition-all duration-200",
        "hover:shadow-md hover:ring-foreground/20",
        (focused || pinned) && "shadow-md ring-foreground/30",
        dimmed && "opacity-30",
      )}
    >
      <Handle type="target" position={Position.Left} id="l" className={HANDLE_CLASS} />
      <Handle type="source" position={Position.Right} id="r" className={HANDLE_CLASS} />

      <div className="flex items-start gap-3">
        <div
          className="size-10 shrink-0 rounded-full ring-1 ring-border/40"
          style={{ backgroundImage: d.gradient }}
        />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="truncate text-[13.5px] font-medium leading-tight text-foreground">
            {d.agent.name}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground/70">
            {d.agent.id}
          </div>
        </div>
      </div>

      {d.agent.description ? (
        <p className="mt-2.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
          {d.agent.description}
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-1.5">
        {d.toolCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
            <WrenchIcon className="size-3" />
            {d.toolCount}
          </span>
        ) : null}
        {d.dataCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
            <DatabaseIcon className="size-3" />
            {d.dataCount}
          </span>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground/60 transition-colors group-hover:text-foreground/80">
          View
          <ChevronRightIcon className="size-3" />
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool node
// ---------------------------------------------------------------------------

function ToolNode({ id, data }: NodeProps) {
  const d = data as ToolNodeData;
  const { dimmed, focused } = useNodeFocusState(id);

  return (
    <div
      className={cn(
        "group flex w-[208px] items-center gap-2 rounded-xl bg-card px-2.5 py-2 shadow-sm ring-1 ring-foreground/10 transition-all duration-200",
        focused && "ring-foreground/30",
        dimmed && "opacity-30",
      )}
    >
      <Handle type="target" position={Position.Left} id="in" className={HANDLE_CLASS} />
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted ring-1 ring-border/50">
        <ToolGlyph tool={d.tool} size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium leading-tight text-foreground">
          {d.label}
        </div>
        <div className="truncate text-[10.5px] leading-tight text-muted-foreground">
          {d.category}
        </div>
      </div>
      {d.agentCount > 1 ? (
        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          {d.agentCount}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Database node
// ---------------------------------------------------------------------------

function DatabaseNode({ id, data }: NodeProps) {
  const d = data as DbNodeData;
  const { dimmed, focused } = useNodeFocusState(id);

  return (
    <div
      className={cn(
        "group flex w-[192px] items-center gap-2 rounded-xl bg-card px-2.5 py-2 shadow-sm ring-1 ring-foreground/10 transition-all duration-200",
        focused && "ring-emerald-500/40",
        dimmed && "opacity-30",
      )}
    >
      <Handle type="source" position={Position.Right} id="out" className={HANDLE_CLASS} />
      <Handle type="target" position={Position.Right} id="out-t" className={HANDLE_CLASS} />
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 dark:text-emerald-400">
        <DatabaseIcon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[11.5px] leading-tight text-foreground">
          {d.collection}
        </div>
        <div className="truncate text-[10.5px] leading-tight text-muted-foreground">
          {d.agentCount} agent{d.agentCount === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  agent: AgentNode,
  tool: ToolNode,
  database: DatabaseNode,
};

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

const COL_DB_X = 0;
const COL_AGENT_X = 380;
const COL_TOOL_X = 820;
const AGENT_GAP = 188;
const TOOL_GAP = 76;
const DB_GAP = 84;

type BuiltGraph = {
  nodes: AppNode[];
  edges: Edge[];
  adjacency: Map<string, Set<string>>;
  counts: { agents: number; tools: number; collections: number };
};

function buildGraph(agents: AgentData[]): BuiltGraph {
  const toolOrder: string[] = [];
  const toolMap = new Map<
    string,
    { tool: AgentToolData; agentIds: Set<string> }
  >();
  const dbOrder: string[] = [];
  const dbMap = new Map<string, Set<string>>();

  for (const agent of agents) {
    for (const tool of agent.tools ?? []) {
      const key = toolKey(tool);
      let entry = toolMap.get(key);
      if (!entry) {
        entry = { tool, agentIds: new Set() };
        toolMap.set(key, entry);
        toolOrder.push(key);
      }
      entry.agentIds.add(agent.id);
    }
    for (const collection of agent.dataCollections ?? []) {
      let entry = dbMap.get(collection);
      if (!entry) {
        entry = new Set();
        dbMap.set(collection, entry);
        dbOrder.push(collection);
      }
      entry.add(agent.id);
    }
  }

  const colHeight = (count: number, gap: number) =>
    count > 0 ? (count - 1) * gap : 0;
  const maxHeight = Math.max(
    colHeight(agents.length, AGENT_GAP),
    colHeight(toolOrder.length, TOOL_GAP),
    colHeight(dbOrder.length, DB_GAP),
  );
  const startY = (count: number, gap: number) =>
    (maxHeight - colHeight(count, gap)) / 2;

  const nodes: AppNode[] = [];
  const agentStart = startY(agents.length, AGENT_GAP);
  agents.forEach((agent, i) => {
    nodes.push({
      id: `agent:${agent.id}`,
      type: "agent",
      position: { x: COL_AGENT_X, y: agentStart + i * AGENT_GAP },
      initialWidth: 290,
      initialHeight: 150,
      data: {
        agent,
        gradient: pickAgentGradient(agent.id || agent.name),
        toolCount: agent.tools?.length ?? 0,
        dataCount: agent.dataCollections?.length ?? 0,
      },
    });
  });

  const toolStart = startY(toolOrder.length, TOOL_GAP);
  toolOrder.forEach((key, i) => {
    const entry = toolMap.get(key)!;
    nodes.push({
      id: `tool:${key}`,
      type: "tool",
      position: { x: COL_TOOL_X, y: toolStart + i * TOOL_GAP },
      initialWidth: 208,
      initialHeight: 52,
      data: {
        tool: entry.tool,
        label: toolDisplayName(entry.tool),
        category: toolCategory(entry.tool),
        agentCount: entry.agentIds.size,
      },
    });
  });

  const dbStart = startY(dbOrder.length, DB_GAP);
  dbOrder.forEach((collection, i) => {
    nodes.push({
      id: `db:${collection}`,
      type: "database",
      position: { x: COL_DB_X, y: dbStart + i * DB_GAP },
      initialWidth: 192,
      initialHeight: 52,
      data: { collection, agentCount: dbMap.get(collection)!.size },
    });
  });

  const edges: Edge[] = [];
  const seenEdges = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  for (const agent of agents) {
    const agentNodeId = `agent:${agent.id}`;
    for (const tool of agent.tools ?? []) {
      const toolNodeId = `tool:${toolKey(tool)}`;
      const edgeId = `e:${agentNodeId}->${toolNodeId}`;
      if (seenEdges.has(edgeId)) continue;
      seenEdges.add(edgeId);
      edges.push({
        id: edgeId,
        source: agentNodeId,
        sourceHandle: "r",
        target: toolNodeId,
        targetHandle: "in",
      });
      link(agentNodeId, toolNodeId);
    }
    for (const collection of agent.dataCollections ?? []) {
      const dbNodeId = `db:${collection}`;
      const edgeId = `e:${dbNodeId}->${agentNodeId}`;
      if (seenEdges.has(edgeId)) continue;
      seenEdges.add(edgeId);
      edges.push({
        id: edgeId,
        source: dbNodeId,
        sourceHandle: "out",
        target: agentNodeId,
        targetHandle: "l",
        data: { kind: "data" },
      });
      link(agentNodeId, dbNodeId);
    }
  }

  return {
    nodes,
    edges,
    adjacency,
    counts: {
      agents: agents.length,
      tools: toolOrder.length,
      collections: dbOrder.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Agent detail panel
// ---------------------------------------------------------------------------

function PromptSection({ prompt }: { prompt: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        System prompt
      </div>
      <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground/75">
        {prompt?.trim() ? prompt : "No system prompt defined."}
      </pre>
    </div>
  );
}

function ToolRow({
  tool,
  workspaceId,
}: {
  tool: AgentToolData;
  workspaceId: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
          <ToolGlyph tool={tool} size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-foreground">
            {toolDisplayName(tool)}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {toolCategory(tool)}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
            tool.enabled
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          {tool.enabled ? "Enabled" : "Off"}
        </span>
      </div>
      {tool.endpoint?.url ? (
        <div className="mt-2 flex items-center gap-1.5 overflow-hidden rounded-md border border-border/70 bg-muted/30 px-2 py-1 font-mono text-[10.5px]">
          {tool.endpoint.method ? (
            <span className="rounded bg-muted px-1 py-0.5 text-[9.5px] font-medium uppercase text-muted-foreground">
              {tool.endpoint.method}
            </span>
          ) : null}
          <span className="truncate text-muted-foreground">
            {tool.endpoint.url}
          </span>
        </div>
      ) : null}
      {tool.type === "custom" && tool.integration?.name ? (
        <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <KeyRoundIcon className="size-3 shrink-0" />
          <span className="truncate">
            Requires{" "}
            <span className="text-foreground/80">{tool.integration.name}</span>
          </span>
          <a
            href={`/w/${workspaceId}/settings/integrations`}
            className="ml-auto shrink-0 font-medium text-foreground underline underline-offset-2 hover:text-foreground/70"
          >
            Configure
          </a>
        </div>
      ) : null}
    </div>
  );
}

function AgentDetailPanel({
  agent,
  workspaceId,
  onClose,
}: {
  agent: AgentData;
  workspaceId: string;
  onClose: () => void;
}) {
  const tools = agent.tools ?? [];
  const dataCollections = agent.dataCollections ?? [];

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[400px] flex-col border-l border-border bg-background/95 shadow-2xl backdrop-blur-md animate-in slide-in-from-right duration-200">
      <div className="flex items-start gap-3 border-b border-border px-4 py-3.5">
        <div
          className="size-10 shrink-0 rounded-full ring-1 ring-border/40"
          style={{ backgroundImage: pickAgentGradient(agent.id || agent.name) }}
        />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="truncate text-sm font-semibold text-foreground">
            {agent.name}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {agent.id}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close agent details"
          className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {agent.description ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {agent.description}
          </p>
        ) : null}

        {tools.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <WrenchIcon className="size-3" />
              Tools
              <span className="text-muted-foreground/50">{tools.length}</span>
            </div>
            <div className="space-y-2">
              {tools.map((tool, i) => (
                <ToolRow
                  key={`${toolKey(tool)}:${i}`}
                  tool={tool}
                  workspaceId={workspaceId}
                />
              ))}
            </div>
          </div>
        ) : null}

        {dataCollections.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <DatabaseIcon className="size-3" />
              Data
              <span className="text-muted-foreground/50">
                {dataCollections.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {dataCollections.map((collection) => (
                <span
                  key={collection}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 font-mono text-[11px] text-foreground/80"
                >
                  <DatabaseIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
                  {collection}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <PromptSection prompt={agent.systemPrompt} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow canvas
// ---------------------------------------------------------------------------

function LegendDot({ className }: { className: string }) {
  return <span className={cn("size-2 rounded-full", className)} />;
}

function ArchitectureFlow({
  agents,
  workspaceId,
}: {
  agents: AgentData[];
  workspaceId: string;
}) {
  const graph = useMemo(() => buildGraph(agents), [agents]);
  const [nodes, , onNodesChange] = useNodesState<AppNode>(graph.nodes);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const focusId = hoverId ?? selectedAgentId;
  const connectedIds = useMemo(() => {
    if (!focusId) return new Set<string>();
    const set = new Set<string>([focusId]);
    for (const neighbor of graph.adjacency.get(focusId) ?? []) set.add(neighbor);
    return set;
  }, [focusId, graph.adjacency]);

  const focusValue = useMemo<FocusValue>(
    () => ({ focusId, connectedIds, selectedAgentId }),
    [focusId, connectedIds, selectedAgentId],
  );

  const edges = useMemo<Edge[]>(() => {
    return graph.edges.map((edge) => {
      const isData = (edge.data as { kind?: string } | undefined)?.kind === "data";
      const connected =
        focusId != null && (edge.source === focusId || edge.target === focusId);
      const dimmed = focusId != null && !connected;
      return {
        ...edge,
        animated: connected,
        className: cn(
          "arch-edge",
          isData && "arch-edge--data",
          connected && "arch-edge--active",
          dimmed && "arch-edge--dim",
        ),
      };
    });
  }, [graph.edges, focusId]);

  const selectedAgent = useMemo(() => {
    if (!selectedAgentId) return null;
    const node = graph.nodes.find((n) => n.id === selectedAgentId);
    return node?.type === "agent"
      ? (node.data as AgentNodeData).agent
      : null;
  }, [selectedAgentId, graph.nodes]);

  const handleNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
    if (node.type === "agent") {
      setSelectedAgentId((current) => (current === node.id ? null : node.id));
    }
  }, []);

  const handleNodeEnter = useCallback<NodeMouseHandler>((_event, node) => {
    setHoverId(node.id);
  }, []);

  const handleNodeLeave = useCallback(() => setHoverId(null), []);

  const minimapNodeColor = useCallback((node: Node) => {
    if (node.type === "agent") return "#64748b";
    if (node.type === "database") return "#10b981";
    return "#94a3b8";
  }, []);

  return (
    <FocusContext.Provider value={focusValue}>
      <div className="app-architecture relative size-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={handleNodeClick}
          onNodeMouseEnter={handleNodeEnter}
          onNodeMouseLeave={handleNodeLeave}
          onPaneClick={() => setSelectedAgentId(null)}
          fitView
          fitViewOptions={{ padding: 0.22 }}
          minZoom={0.2}
          maxZoom={1.75}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: "default" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
          <Controls
            showInteractive={false}
            className="!shadow-sm"
            position="bottom-left"
          />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor={minimapNodeColor}
            nodeStrokeWidth={0}
            nodeBorderRadius={8}
          />
          <Panel position="top-left">
            <div className="flex flex-col gap-2 rounded-xl bg-background/80 px-3 py-2.5 text-[11px] shadow-sm ring-1 ring-foreground/10 backdrop-blur">
              <div className="flex items-center gap-1.5 font-medium tabular-nums text-foreground">
                {graph.counts.agents} agent
                {graph.counts.agents === 1 ? "" : "s"}
                <span className="text-muted-foreground/40">·</span>
                {graph.counts.tools} tool
                {graph.counts.tools === 1 ? "" : "s"}
                <span className="text-muted-foreground/40">·</span>
                {graph.counts.collections} collection
                {graph.counts.collections === 1 ? "" : "s"}
              </div>
              <div className="flex items-center gap-3 text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <LegendDot className="bg-gradient-to-br from-violet-400 to-sky-400" />
                  Agents
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <LegendDot className="bg-muted-foreground/40" />
                  Tools
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <LegendDot className="bg-emerald-500" />
                  Data
                </span>
              </div>
            </div>
          </Panel>
        </ReactFlow>

        {selectedAgent ? (
          <AgentDetailPanel
            key={selectedAgent.id}
            agent={selectedAgent}
            workspaceId={workspaceId}
            onClose={() => setSelectedAgentId(null)}
          />
        ) : null}
      </div>
    </FocusContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Public component — fetches agents, handles loading/empty/error states
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; agents: AgentData[] };

export function AppArchitecture({
  workspaceId,
  appId,
}: {
  workspaceId: string;
  appId: string;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`/api/workspaces/${workspaceId}/apps/${appId}/agents`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data: { agents?: AgentData[] }) => {
        if (cancelled) return;
        setState({ status: "ready", agents: data.agents ?? [] });
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return;
        setState({ status: "error" });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [workspaceId, appId]);

  if (state.status === "loading") {
    return (
      <div className="flex size-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium text-foreground">
          Could not load the architecture
        </p>
        <p className="max-w-[280px] text-[13px] text-muted-foreground">
          Something went wrong fetching this app&apos;s agents. Try reopening
          this view.
        </p>
      </div>
    );
  }

  if (state.agents.length === 0) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-muted/50">
          <BotIcon className="size-5 text-muted-foreground/50" strokeWidth={1.5} />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">No agents yet</p>
          <p className="max-w-[300px] text-[13px] leading-relaxed text-muted-foreground">
            This app doesn&apos;t define any agents. Once it does, you&apos;ll
            see how they connect to tools and data here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <ArchitectureFlow agents={state.agents} workspaceId={workspaceId} />
    </ReactFlowProvider>
  );
}
