"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
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
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_RUNTIME_SETTINGS } from "@/lib/agent/runtime-registry";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_AGENT_GRADIENTS,
  randomWorkspaceAgentGradientSeed,
  workspaceAgentGradient,
  workspaceAgentGradientSeedForIndex,
} from "@/lib/workspace-agent-avatar";
import {
  listAgents,
  createAgent,
  listTools,
  type MockAgent,
  type MockTool,
} from "@/lib/mock-data/workspace-agents";
import { listSkills, createSkill as createSkillApi, type MockSkill } from "@/lib/mock-data/workspace-library";
import { SkillCreatePanel, type SkillFormData } from "../library/library-client";

const BUILTIN_AGENT_TOOLS = [
  {
    id: "WebSearch",
    name: "Web Search",
    description: "Search the web for current public information.",
    claudeName: "WebSearch",
    codexName: "WebSearch",
  },
  {
    id: "WebFetch",
    name: "Web Fetch",
    description: "Open and read a specific public URL.",
    claudeName: "WebFetch",
    codexName: "WebFetch",
  },
] as const;

function defaultTeamId(teams: Array<{ _id: string; name: string }>): string | null {
  return teams.find((team) => team.name.toLowerCase() === "general")?._id ??
    teams[0]?._id ??
    null;
}

function defaultTeamIds(teams: Array<{ _id: string; name: string }>): string[] {
  const teamId = defaultTeamId(teams);
  return teamId ? [teamId] : [];
}

// Shared team multi-select
function TeamMultiSelect({
  teams,
  selected,
  onChange,
}: {
  teams: Array<{ _id: string; name: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const selectedSet = new Set(selected);
  const fallbackTeamId = defaultTeamId(teams);
  const visibleTeams = [
    ...teams,
    ...selected
      .filter((id) => !teams.some((team) => team._id === id))
      .map((id) => ({ _id: id, name: id })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visibleTeams.map((team) => {
        const active = selectedSet.has(team._id);
        return (
          <button
            key={team._id}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(
                active
                  ? selected.filter((id) => id !== team._id).length > 0
                    ? selected.filter((id) => id !== team._id)
                    : fallbackTeamId
                      ? [fallbackTeamId]
                      : []
                  : [...selected, team._id],
              )
            }
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
              active
                ? "border-foreground/30 bg-foreground text-background"
                : "border-border/60 bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {active ? <Check className="size-3" /> : null}
            {team.name}
          </button>
        );
      })}
    </div>
  );
}

function apiErrorLabel(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.message) return undefined;
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    if (parsed.error) return parsed.error.replace(/_/g, " ");
  } catch {
    // Keep the original message below.
  }
  return error.message;
}

function AgentGradientPicker({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: string;
  onChange: (seed: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedGradient = workspaceAgentGradient(value);

  return (
    <Popover open={open} onOpenChange={(nextOpen) => !disabled && setOpen(nextOpen)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Choose agent gradient"
          className={cn(
            "relative rounded-full ring-1 ring-border/30 transition-shadow",
            !disabled && "cursor-pointer hover:ring-[3px] hover:ring-border/70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70",
            disabled && "cursor-default",
            className,
          )}
        >
          <span
            className="block size-full rounded-full"
            style={{ backgroundImage: selectedGradient }}
          />
          {!disabled && (
            <span className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full border border-background bg-background text-muted-foreground shadow-sm ring-1 ring-border">
              <Pencil className="size-2.5" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <p className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground/60">
          Choose a gradient
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {WORKSPACE_AGENT_GRADIENTS.map((gradient, index) => {
            const seed = workspaceAgentGradientSeedForIndex(index);
            const selected = gradient === selectedGradient;
            return (
              <button
                key={seed}
                type="button"
                aria-label={`Gradient ${index + 1}`}
                aria-pressed={selected}
                onClick={() => {
                  onChange(seed);
                  setOpen(false);
                }}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full ring-1 transition-all",
                  selected
                    ? "ring-foreground"
                    : "ring-border/50 hover:ring-foreground/50",
                )}
              >
                <span
                  className="block size-6 rounded-full"
                  style={{ backgroundImage: gradient }}
                />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Main Agents page
// ---------------------------------------------------------------------------

type AgentsClientProps = {
  workspaceId: string;
  teams: Array<{ _id: string; name: string; memberCount: number }>;
};
type View = "grid" | "list" | "create";

export function AgentsClient({ workspaceId, teams }: AgentsClientProps) {
  const router = useRouter();
  const [agents, setAgents] = useState<MockAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<View>("grid");

  const fetchAgents = useCallback(async () => {
    const result = await listAgents({
      workspaceId,
      query: searchQuery || undefined,
    });
    setAgents(result);
    setLoading(false);
  }, [searchQuery, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    listAgents({ workspaceId, query: searchQuery || undefined }).then((result) => {
      if (!cancelled) {
        setAgents(result);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [searchQuery, workspaceId]);

  const openAgent = (agentSlug: string) => {
    router.push(`/w/${workspaceId}/agents/${agentSlug}`);
  };

  const handleAgentCreated = () => {
    setView("grid");
    void fetchAgents();
  };

  // "n" shortcut for New agent on grid view
  useEffect(() => {
    if (view !== "grid") return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "n") {
        e.preventDefault();
        setView("create");
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [view]);

  // Shared agent row component
  const AgentRow = ({ agent }: { agent: MockAgent }) => (
    <button
      type="button"
      onClick={() => openAgent(agent.slug)}
      className="group flex items-center gap-4 rounded-xl px-3 py-3 text-left transition-all duration-150 hover:bg-accent/50"
    >
      <div
        className="size-9 shrink-0 rounded-full ring-1 ring-border/30"
        style={{
          backgroundImage: workspaceAgentGradient(
            agent.avatarGradientSeed ?? agent._id,
          ),
        }}
      />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium leading-tight">{agent.displayName}</h3>
        <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
          {agent.description}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground/50">
        {agent.selectedSkillIds.length > 0 && (
          <span className="flex items-center gap-1">
            <BookOpen className="size-3" />
            {agent.selectedSkillIds.length}
          </span>
        )}
        {agent.selectedToolIds.length > 0 && (
          <span className="flex items-center gap-1">
            <Wrench className="size-3" />
            {agent.selectedToolIds.length}
          </span>
        )}
        <ArrowRight className="size-3.5 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </button>
  );

  // Grid view (home)
  if (view === "grid") {
    const filtered = searchQuery
      ? agents.filter(
          (a) =>
            a.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            a.description.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : agents;
    const previewAgents = filtered.slice(0, 4);
    const hasMore = filtered.length > 4;

    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <div
          data-second-desktop-drag-region
          className="mx-auto flex w-full max-w-[720px] flex-col items-center px-6 pt-[18vh] pb-12"
        >
          {/* Title */}
          <h1
            className="text-2xl tracking-tight opacity-0 animate-fade-in-up"
            style={{ fontFamily: "AlphaLyrae, sans-serif", fontFeatureSettings: '"calt" 1' }}
          >
            Agents.
          </h1>

          {/* Actions */}
          <div className="mt-6 flex items-center gap-2 opacity-0 animate-fade-in-up" style={{ animationDelay: "150ms" }}>
            <Button variant="outline" size="default" onClick={() => setView("create")}>
              <Plus className="size-3.5" />
              New agent
              <Kbd className="ml-1">N</Kbd>
            </Button>
          </div>

          {/* Empty state */}
          {!loading && agents.length === 0 && (
            <div className="mt-12 w-full max-w-lg opacity-0 animate-fade-in-up" style={{ animationDelay: "300ms" }}>

              {/* Section 1: What's an agent */}
              {/* <div className="text-center">
                <h3 className="text-sm font-medium text-foreground/90">What&apos;s an agent?</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground/70">
                  An agent is a <span className="text-foreground/80 font-medium">prompt</span> combined with <span className="text-foreground/80 font-medium">skills</span> and <span className="text-foreground/80 font-medium">tools</span>.
                </p>
              </div>

              <div className="my-8 h-px w-12 mx-auto bg-border/60" /> */}

              {/* Section 2: Workspace vs app agents */}
              <div className="text-center">
                <h3 className="text-sm font-medium text-foreground/90">Workspace agents vs. app agents</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground/70">
                  You are now creating <span className="text-foreground/80 font-medium">workspace-wide agents</span> that you or your team can select and reuse across any conversation. They are different from app-specific agents, which are created for you when you build apps.
                </p>
              </div>

              {/* Visual: workspace with agents + app inside workspace with its own agent */}
              <div className="mt-6 flex justify-center">
                <svg width="380" height="180" viewBox="0 0 380 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-muted-foreground">
                  {/* Workspace boundary */}
                  <rect x="10" y="10" width="360" height="160" rx="14" stroke="currentColor" strokeWidth="1.4" opacity="0.25" />
                  <text x="24" y="30" fontSize="11" fill="currentColor" opacity="0.4" fontWeight="500">workspace</text>

                  {/* Workspace agents - floating freely */}
                  <circle cx="70" cy="80" r="14" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
                  <circle cx="70" cy="80" r="5" fill="currentColor" fillOpacity="0.2" />
                  <text x="70" y="108" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.35">Workspace agent</text>

                  <circle cx="130" cy="130" r="14" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
                  <circle cx="130" cy="130" r="5" fill="currentColor" fillOpacity="0.2" />
                  <text x="130" y="158" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.35">Workspace agent</text>

                  {/* App box inside workspace */}
                  <rect x="200" y="45" width="150" height="105" rx="10" stroke="currentColor" strokeWidth="1.4" opacity="0.3" strokeDasharray="5 4" />
                  <text x="216" y="64" fontSize="10" fill="currentColor" opacity="0.35" fontWeight="500">app</text>

                  {/* Agent locked inside the app */}
                  <circle cx="275" cy="105" r="16" fill="currentColor" fillOpacity="0.05" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
                  <circle cx="275" cy="105" r="5.5" fill="currentColor" fillOpacity="0.12" />
                  <text x="275" y="135" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.25">App agent</text>
                </svg>
              </div>

            </div>
          )}

          {/* Agents section */}
          {!loading && agents.length > 0 && (
            <div className="mt-10 w-full opacity-0 animate-fade-in-up" style={{ animationDelay: "300ms" }}>
              {/* Divider + label */}
              <div className="flex w-full items-center gap-3 mb-5">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">your agents</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Search */}
              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                  <input
                    type="text"
                    placeholder="Search agents..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 w-full rounded-lg bg-muted/50 pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-muted focus:ring-1 focus:ring-ring/20"
                  />
                </div>
              </div>

              {/* Agent rows */}
              <div className="flex flex-col gap-0.5">
                {previewAgents.map((agent) => (
                  <AgentRow key={agent._id} agent={agent} />
                ))}
              </div>

              {hasMore && (
                <div className="mt-3 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setView("list")}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    View all {filtered.length} agents
                    <ArrowRight className="size-3" />
                  </button>
                </div>
              )}

              {searchQuery && filtered.length === 0 && (
                <p className="mt-4 text-center text-xs text-muted-foreground/50">No agents match your search</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Full list view (grouped by team)
  if (view === "list") {
    const teamMap = new Map(teams.map((t) => [t._id, t.name]));
    const grouped = new Map<string, MockAgent[]>();
    for (const agent of agents) {
      if (agent.teamIds.length === 0) {
        const list = grouped.get("workspace") ?? [];
        list.push(agent);
        grouped.set("workspace", list);
      } else {
        for (const tid of agent.teamIds) {
          const list = grouped.get(tid) ?? [];
          if (!list.some((a) => a._id === agent._id)) list.push(agent);
          grouped.set(tid, list);
        }
      }
    }

    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <button
            type="button"
            onClick={() => setView("grid")}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </button>
          <h1 className="text-sm font-semibold">All agents</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="default" onClick={() => setView("create")}>
              <Plus className="size-3.5" />
              New agent
            </Button>
          </div>
        </div>

        <div className="px-6 pb-3">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <input
              type="text"
              placeholder="Search agents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full rounded-lg bg-muted/50 pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-muted focus:ring-1 focus:ring-ring/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-10">
          <div className="mx-auto max-w-[720px]">
            {Array.from(grouped.entries()).map(([key, groupAgents]) => (
              <div key={key} className="mb-6">
                <h2 className="mb-2 px-3 text-[11px] font-medium text-muted-foreground/50">
                  {key === "workspace" ? "Entire workspace" : teamMap.get(key) ?? key}
                </h2>
                <div className="flex flex-col gap-0.5">
                  {groupAgents.map((agent) => (
                    <AgentRow key={agent._id} agent={agent} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Create view (flow-based)
  if (view === "create") {
    return (
      <AgentCreateView
        workspaceId={workspaceId}
        teams={teams}
        onBack={() => setView("grid")}
        onCreated={handleAgentCreated}
      />
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Agent detail view — read-only by default, edit mode on click
// ---------------------------------------------------------------------------

export function AgentDetailView({
  agent,
  skills,
  tools,
  teams,
  onBack,
  onDelete,
  onRun,
  onSave,
}: {
  agent: MockAgent;
  skills: Array<Pick<MockSkill, "_id" | "slug" | "displayName" | "description" | "tags">>;
  tools: MockTool[];
  teams: Array<{ _id: string; name: string; memberCount: number }>;
  onBack: () => void;
  onDelete: () => Promise<boolean>;
  onRun: () => void;
  onSave: (data: Partial<{
    avatarGradientSeed: string | null;
    displayName: string;
    description: string;
    systemPrompt: string;
    teamIds: string[];
    selectedSkillIds: string[];
    selectedToolIds: string[];
  }>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(agent.displayName);
  const [description, setDescription] = useState(agent.description);
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [avatarGradientSeed, setAvatarGradientSeed] = useState(
    agent.avatarGradientSeed ?? agent._id,
  );
  const [localSkillIds, setLocalSkillIds] = useState(agent.selectedSkillIds);
  const [localToolIds, setLocalToolIds] = useState(agent.selectedToolIds);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allSkills, setAllSkills] = useState<MockSkill[]>([]);
  const [allTools, setAllTools] = useState<MockTool[]>([]);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [showToolPicker, setShowToolPicker] = useState(false);
  const [skillSearch, setSkillSearch] = useState("");
  const [toolSearch, setToolSearch] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Focusable element refs for arrow/tab navigation
  const focusOrder = useRef<Array<HTMLElement | null>>([]);
  const setFocusRef = (index: number) => (el: HTMLElement | null) => {
    focusOrder.current[index] = el;
  };

  const markDirty = () => { if (!dirty) setDirty(true); };

  const teamMap = new Map(teams.map((t) => [t._id, t.name]));
  const canRunAgent =
    agent.status === "published" && agent.approvalStatus === "approved";
  const runDisabledReason =
    agent.approvalStatus !== "approved"
      ? "This agent needs approval before it can run."
      : agent.status !== "published"
        ? "This agent must be published before it can run."
        : undefined;

  useEffect(() => {
    let cancelled = false;
    listSkills().then((s) => { if (!cancelled) setAllSkills(s); });
    listTools().then((t) => { if (!cancelled) setAllTools(t); });
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      avatarGradientSeed,
      displayName, description, systemPrompt,
      selectedSkillIds: localSkillIds,
      selectedToolIds: localToolIds,
    });
    setSaving(false);
    setDirty(false);
    setEditing(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const deleted = await onDelete();
      if (deleted) {
        toast.success("Agent deleted");
        setDeleteOpen(false);
        onBack();
        return;
      }
      toast.error("Could not delete agent");
    } catch (error) {
      toast.error("Could not delete agent", {
        description: apiErrorLabel(error),
      });
    } finally {
      setDeleting(false);
    }
  };

  const enterEditMode = () => {
    setEditing(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const cancelEdit = useCallback(() => {
    setDisplayName(agent.displayName);
    setDescription(agent.description);
    setSystemPrompt(agent.systemPrompt);
    setAvatarGradientSeed(agent.avatarGradientSeed ?? agent._id);
    setLocalSkillIds(agent.selectedSkillIds);
    setLocalToolIds(agent.selectedToolIds);
    setSkillSearch("");
    setToolSearch("");
    setShowSkillPicker(false);
    setShowToolPicker(false);
    setDirty(false);
    setEditing(false);
  }, [agent]);

  // "e" to enter edit, Escape to exit
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editing) {
        e.preventDefault();
        cancelEdit();
        return;
      }
      // Don't trigger if typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "e" && !editing) {
        e.preventDefault();
        enterEditMode();
      }
      if (e.key === "r" && !editing) {
        if (!canRunAgent) return;
        e.preventDefault();
        onRun();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [canRunAgent, cancelEdit, editing, onRun]);

  // Auto-resize prompt textarea
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [systemPrompt, editing]);

  // Arrow/Tab navigation handler
  const handleFieldKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      const next = focusOrder.current[currentIndex + 1];
      if (next) next.focus();
    }
    if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      const prev = focusOrder.current[currentIndex - 1];
      if (prev) prev.focus();
    }
  };

  const filteredSkills = allSkills.filter(
    (s) => !skillSearch || s.displayName.toLowerCase().includes(skillSearch.toLowerCase()),
  );
  const filteredTools = allTools.filter(
    (t) => !toolSearch || t.displayName.toLowerCase().includes(toolSearch.toLowerCase()),
  );

  // Show skills/tools from both the initial loaded set AND allSkills/allTools for newly added ones
  const localSkillSet = new Set(localSkillIds);
  const localToolSet = new Set(localToolIds);
  const currentSkills = [
    ...skills.filter((s) => localSkillSet.has(s._id)),
    ...allSkills
      .filter((s) => localSkillSet.has(s._id) && !skills.some((sk) => sk._id === s._id))
      .map((s) => ({ _id: s._id, slug: s.slug, displayName: s.displayName, description: s.description, tags: s.tags })),
  ];
  const currentTools = [
    ...tools.filter((t) => localToolSet.has(t._id)),
    ...allTools.filter((t) => localToolSet.has(t._id) && !tools.some((tl) => tl._id === t._id)),
  ];

  // Close pickers on Escape or click-outside
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const toolPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSkillPicker && !showToolPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (showSkillPicker && skillPickerRef.current && !skillPickerRef.current.contains(e.target as Node)) {
        setShowSkillPicker(false);
      }
      if (showToolPicker && toolPickerRef.current && !toolPickerRef.current.contains(e.target as Node)) {
        setShowToolPicker(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowSkillPicker(false);
        setShowToolPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showSkillPicker, showToolPicker]);

  return (
    <>
    <div className="relative flex h-full flex-col overflow-hidden animate-fade-in-up" style={{ animationDuration: "0.2s" }}>
      {/* Nav */}
      <div className="flex items-center justify-between px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Agents
        </button>
        <div className="flex items-center gap-2">
          {!editing && (
            <Button size="default" variant="outline" onClick={enterEditMode}>
              <Pencil className="size-3.5" />
              Edit
              <Kbd className="ml-1">E</Kbd>
            </Button>
          )}
          {!editing && (
            <Button size="default" variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          )}
          {editing && dirty && (
            <Button size="default" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
          <Button
            size="default"
            onClick={onRun}
            disabled={!canRunAgent}
            title={runDisabledReason}
          >
            <Zap className="size-3.5" />
            {canRunAgent ? "Run" : "Needs approval"}
            {canRunAgent && <Kbd className="ml-1">R</Kbd>}
          </Button>
        </div>
      </div>

      {/* Floating edit bar — centered at top, overlaying content */}
      {editing && (
        <div className="pointer-events-none absolute inset-x-0 top-11 z-10 flex justify-center">
          <div
            className="pointer-events-auto flex items-center gap-3 rounded-full bg-card px-4 py-2 ring-1 ring-border/50 animate-fade-in-up"
            style={{ animationDuration: "0.2s", boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
          >
            <Pencil className="size-3 text-muted-foreground" />
            <span className="text-xs font-medium">Document is now editable</span>
            <span className="text-[11px] text-muted-foreground/50">Click any text or item to edit</span>
            <span className="h-4 w-px bg-border" />
            {dirty ? (
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Done
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-6 pb-20">
          {/* Avatar — circle, no icon */}
          <AgentGradientPicker
            value={avatarGradientSeed}
            onChange={(seed) => {
              setAvatarGradientSeed(seed);
              markDirty();
            }}
            disabled={!editing}
            className="mb-5 size-14"
          />

          {/* Name — always an input to avoid layout shift */}
          <input
            ref={(el) => { titleRef.current = el; setFocusRef(0)(el); }}
            type="text"
            value={displayName}
            onChange={(e) => { setDisplayName(e.target.value); markDirty(); }}
            onKeyDown={(e) => handleFieldKeyDown(e, 0)}
            readOnly={!editing}
            tabIndex={editing ? 0 : -1}
            placeholder="Agent name"
            className={cn(
              "w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/25",
              !editing && "pointer-events-none",
            )}
          />

          {/* Description — always an input to avoid layout shift */}
          <input
            ref={(el) => { descRef.current = el; setFocusRef(1)(el); }}
            type="text"
            value={description}
            onChange={(e) => { setDescription(e.target.value); markDirty(); }}
            onKeyDown={(e) => handleFieldKeyDown(e, 1)}
            readOnly={!editing}
            tabIndex={editing ? 0 : -1}
            placeholder="What does this agent do?"
            className={cn(
              "mt-1 w-full bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/25",
              !editing && "pointer-events-none",
            )}
          />

          {/* Teams */}
          <div className="mt-3 text-xs text-muted-foreground/60">
            {agent.teamIds.length === 0
              ? "Entire workspace"
              : agent.teamIds.map((id) => teamMap.get(id) ?? id).join(", ")}
            {" \u00B7 "}
            {agent.createdByName}
          </div>

          {/* Skills section */}
          <div className="mt-8">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground/50">
                Skills
              </h3>
              <button
                type="button"
                onClick={() => setShowSkillPicker(!showSkillPicker)}
                className={cn(
                  "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/50 transition-all hover:bg-muted hover:text-muted-foreground",
                  !editing && "pointer-events-none opacity-0",
                )}
                tabIndex={editing ? 0 : -1}
              >
                <Plus className="size-3" />
                Add
              </button>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {currentSkills.length === 0 && !showSkillPicker && (
                <p className="text-xs text-muted-foreground/40">No skills attached</p>
              )}
              {currentSkills.map((skill, i) => (
                <div
                  key={skill._id}
                  ref={setFocusRef(2 + i)}
                  tabIndex={editing ? 0 : undefined}
                  onKeyDown={editing ? (e) => handleFieldKeyDown(e, 2 + i) : undefined}
                  className={cn(
                    "group flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors outline-none",
                    editing
                      ? "border-border/50 bg-muted/20 hover:bg-muted/40 focus:ring-1 focus:ring-ring/30"
                      : "border-transparent",
                  )}
                >
                  <BookOpen className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">{skill.displayName}</p>
                    <p className="truncate text-[11px] text-muted-foreground/60">{skill.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setLocalSkillIds(localSkillIds.filter((id) => id !== skill._id));
                      markDirty();
                    }}
                    className={cn(
                      "shrink-0 rounded-md p-0.5 text-muted-foreground/30 transition-opacity hover:text-destructive",
                      editing ? "opacity-0 group-hover:opacity-100" : "pointer-events-none opacity-0",
                    )}
                    tabIndex={editing ? 0 : -1}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              {/* Skill picker */}
              {editing && showSkillPicker && (
                <div ref={skillPickerRef} className="mt-1 rounded-lg border border-border/50 bg-card p-2">
                  <div className="relative mb-2">
                    <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/40" />
                    <input
                      type="text"
                      placeholder="Search skills..."
                      value={skillSearch}
                      onChange={(e) => setSkillSearch(e.target.value)}
                      className="h-7 w-full rounded-md bg-muted/50 pl-7 pr-2 text-[11px] outline-none placeholder:text-muted-foreground/40 focus:bg-muted"
                      autoFocus
                    />
                  </div>
                  {filteredSkills.filter((s) => !localSkillIds.includes(s._id)).map((skill) => (
                    <button
                      key={skill._id}
                      type="button"
                      onClick={() => {
                        setLocalSkillIds([...localSkillIds, skill._id]);
                        markDirty();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <Plus className="size-3 text-muted-foreground/40" />
                      <span className="text-xs">{skill.displayName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tools section */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground/50">
                Tools
              </h3>
              <button
                type="button"
                onClick={() => setShowToolPicker(!showToolPicker)}
                className={cn(
                  "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/50 transition-all hover:bg-muted hover:text-muted-foreground",
                  !editing && "pointer-events-none opacity-0",
                )}
                tabIndex={editing ? 0 : -1}
              >
                <Plus className="size-3" />
                Add
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {currentTools.length === 0 && !showToolPicker && (
                <p className="text-xs text-muted-foreground/40">No tools attached</p>
              )}
              {currentTools.map((tool, i) => (
                <div
                  key={tool._id}
                  ref={setFocusRef(2 + currentSkills.length + i)}
                  tabIndex={editing ? 0 : undefined}
                  onKeyDown={editing ? (e) => handleFieldKeyDown(e, 2 + currentSkills.length + i) : undefined}
                  className={cn(
                    "group relative flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors outline-none",
                    editing
                      ? "border-border/50 bg-muted/20 hover:bg-muted/40 focus:ring-1 focus:ring-ring/30"
                      : "border-transparent",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://www.google.com/s2/favicons?sz=32&domain=${tool.integrationDomain}`}
                    alt=""
                    className="size-4"
                  />
                  <span className="text-xs font-medium">{tool.displayName}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setLocalToolIds(localToolIds.filter((id) => id !== tool._id));
                      markDirty();
                    }}
                    className={cn(
                      "shrink-0 rounded-md p-0.5 text-muted-foreground/30 transition-opacity hover:text-destructive",
                      editing ? "opacity-0 group-hover:opacity-100" : "pointer-events-none opacity-0",
                    )}
                    tabIndex={editing ? 0 : -1}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {/* Tool picker */}
              {editing && showToolPicker && (
                <div ref={toolPickerRef} className="mt-1 w-full rounded-lg border border-border/50 bg-card p-2">
                  <div className="relative mb-2">
                    <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/40" />
                    <input
                      type="text"
                      placeholder="Search tools..."
                      value={toolSearch}
                      onChange={(e) => setToolSearch(e.target.value)}
                      className="h-7 w-full rounded-md bg-muted/50 pl-7 pr-2 text-[11px] outline-none placeholder:text-muted-foreground/40 focus:bg-muted"
                      autoFocus
                    />
                  </div>
                  {filteredTools.filter((t) => !localToolIds.includes(t._id)).map((tool) => (
                    <button
                      key={tool._id}
                      type="button"
                      onClick={() => {
                        setLocalToolIds([...localToolIds, tool._id]);
                        markDirty();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <Plus className="size-3 text-muted-foreground/40" />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`https://www.google.com/s2/favicons?sz=32&domain=${tool.integrationDomain}`} alt="" className="size-3.5" />
                      <span className="text-xs">{tool.integrationName}: {tool.displayName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* System prompt */}
          <div className="mt-8">
            <h3 className="text-xs font-medium text-muted-foreground/50">
              System prompt
            </h3>
            <div className="mt-3 h-px bg-border/40" />
            <textarea
              ref={(el) => { promptRef.current = el; setFocusRef(2 + currentSkills.length + currentTools.length)(el); }}
              value={systemPrompt}
              onChange={(e) => { setSystemPrompt(e.target.value); markDirty(); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" && promptRef.current?.selectionStart === 0) {
                  handleFieldKeyDown(e, 2 + currentSkills.length + currentTools.length);
                }
              }}
              readOnly={!editing}
              tabIndex={editing ? 0 : -1}
              placeholder="Instructions for how this agent should behave..."
              className={cn(
                "mt-3 w-full resize-none bg-transparent text-sm leading-[1.8] text-foreground/80 outline-none placeholder:text-muted-foreground/25",
                !editing && "pointer-events-none",
              )}
              rows={1}
            />
          </div>
        </div>
      </div>
    </div>
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete agent</DialogTitle>
          <DialogDescription>
            Delete &ldquo;{agent.displayName}&rdquo;? It will be removed from the agent picker and cannot be run from the workspace.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Agent create view (flow-based, step by step)
// ---------------------------------------------------------------------------

function AgentCreateView({
  workspaceId,
  teams,
  onBack,
  onCreated,
}: {
  workspaceId: string;
  teams: Array<{ _id: string; name: string; memberCount: number }>;
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>(() =>
    defaultTeamIds(teams),
  );
  const [avatarGradientSeed, setAvatarGradientSeed] = useState(() =>
    randomWorkspaceAgentGradientSeed(),
  );
  const [allSkills, setAllSkills] = useState<MockSkill[]>([]);
  const [skillSearch, setSkillSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    listSkills({ workspaceId }).then((s) => { if (!cancelled) setAllSkills(s); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  useEffect(() => {
    if (step === 0) {
      const timer = setTimeout(() => nameRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
    if (step === 1) {
      const timer = setTimeout(() => promptRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
  }, [step]);

  const filteredSkills = allSkills.filter(
    (s) => !skillSearch || s.displayName.toLowerCase().includes(skillSearch.toLowerCase()),
  );

  const handleCreate = async () => {
    setSaving(true);
    await createAgent({
      workspaceId,
      avatarGradientSeed,
      displayName,
      slug: displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      description,
      systemPrompt,
      visibility: teamIds.length > 0 ? "teams" : "workspace",
      teamIds,
      selectedSkillIds,
      selectedToolIds: [],
      builtinTools: BUILTIN_AGENT_TOOLS.map((tool) => tool.id),
      model: DEFAULT_RUNTIME_SETTINGS.model,
    });
    setSaving(false);
    onCreated();
  };

  const continueFromCurrentStep = () => {
    if (step === 0) {
      if (!displayName.trim()) return;
      setStep(1);
      return;
    }
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      setStep(3);
      return;
    }
    if (step === 3) {
      setStep(4);
      return;
    }
    if (step === 4 && !saving) {
      void handleCreate();
    }
  };

  useEffect(() => {
    const handleDocumentKeyDown = (e: KeyboardEvent) => {
      if (
        e.key !== "Enter" ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.isComposing ||
        creatingSkill
      ) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA" && e.shiftKey) return;

      e.preventDefault();
      e.stopPropagation();
      continueFromCurrentStep();
    };

    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
    };
  });

  useEffect(() => {
    const handleDocumentKeyDown = (e: KeyboardEvent) => {
      if (
        e.key !== "Escape" ||
        e.defaultPrevented ||
        e.isComposing ||
        creatingSkill ||
        saving
      ) {
        return;
      }

      e.preventDefault();
      onBack();
    };

    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [creatingSkill, onBack, saving]);

  const steps = [
    { label: "Identity", step: 0, done: !!displayName.trim() },
    { label: "Prompt", step: 1, done: !!systemPrompt.trim() },
    { label: "Skills", step: 2, done: true },
    { label: "Tools", step: 3, done: true },
    { label: "Review", step: 4, done: false },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Agents
        </button>
        <div className="flex items-center gap-1">
          {steps.map((s) => (
            <button key={s.label} type="button" onClick={() => setStep(s.step)} className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-all",
              step === s.step ? "bg-foreground text-background font-medium" : s.step < step ? "text-muted-foreground hover:bg-muted" : "text-muted-foreground/40",
            )}>
              {s.step < step ? <Check className="size-3" /> : null}
              {s.label}
            </button>
          ))}
        </div>
        <div className="w-16" />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-6 py-10">
          {step === 0 && (
            <div className="animate-fade-in-up" style={{ animationDuration: "0.25s" }}>
              <AgentGradientPicker
                value={avatarGradientSeed}
                onChange={setAvatarGradientSeed}
                className="mb-6 size-14"
              />
              <input ref={nameRef} type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Agent name" className="w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/20" />
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" className="mt-2 w-full bg-transparent text-base text-muted-foreground outline-none placeholder:text-muted-foreground/20" />
              <div className="mt-6">
                <p className="mb-2 text-[11px] font-medium text-muted-foreground/50">Shared with</p>
                <TeamMultiSelect teams={teams} selected={teamIds} onChange={setTeamIds} />
              </div>
              <div className="mt-10 flex justify-end">
                <Button onClick={() => setStep(1)} disabled={!displayName.trim()}>Continue <ArrowRight className="size-3.5" /></Button>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="animate-fade-in-up" style={{ animationDuration: "0.25s" }}>
              <h2 className="text-lg font-semibold tracking-tight">System prompt</h2>
              <p className="mt-1 text-sm text-muted-foreground/60">Define how {displayName || "this agent"} should behave.</p>
              <textarea ref={promptRef} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder={`You are ${displayName || "an assistant"}. Your job is to...`} className="mt-6 min-h-[200px] w-full resize-none rounded-xl border border-border/50 bg-muted/20 px-4 py-3 text-sm leading-[1.8] outline-none transition-colors placeholder:text-muted-foreground/25 focus:border-border focus:bg-transparent" rows={8} />
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => setStep(0)}><ArrowLeft className="size-3.5" />Back</Button>
                <Button onClick={() => setStep(2)}>Continue <ArrowRight className="size-3.5" /></Button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="animate-fade-in-up" style={{ animationDuration: "0.25s" }}>
              <h2 className="text-lg font-semibold tracking-tight">Attach skills</h2>
              <p className="mt-1 text-sm text-muted-foreground/60">Skills give {displayName || "your agent"} specialized knowledge.</p>
              <div className="mt-4 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/40" />
                  <input type="text" placeholder="Search skills..." value={skillSearch} onChange={(e) => setSkillSearch(e.target.value)} className="h-8 w-full rounded-lg bg-muted/50 pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground/40 focus:bg-muted" />
                </div>
                <Button variant="outline" size="sm" onClick={() => setCreatingSkill(true)}>
                  <Plus className="size-3" />
                  Create skill
                </Button>
              </div>
              <div className="mt-3 flex flex-col gap-1">
                {filteredSkills.map((skill) => {
                  const sel = selectedSkillIds.includes(skill._id);
                  return (
                    <button key={skill._id} type="button" onClick={() => setSelectedSkillIds(sel ? selectedSkillIds.filter((id) => id !== skill._id) : [...selectedSkillIds, skill._id])} className={cn("flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-all duration-150", sel ? "bg-accent ring-1 ring-foreground/10" : "hover:bg-muted/40")}>
                      <div className={cn("flex size-5 shrink-0 items-center justify-center rounded-md border transition-all duration-150", sel ? "border-foreground bg-foreground" : "border-muted-foreground/20")}>
                        {sel && <Check className="size-3 text-background" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{skill.displayName}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground/60">{skill.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => setStep(1)}><ArrowLeft className="size-3.5" />Back</Button>
                <Button onClick={() => setStep(3)}>{selectedSkillIds.length > 0 ? `Continue with ${selectedSkillIds.length} skill${selectedSkillIds.length > 1 ? "s" : ""}` : "Skip"} <ArrowRight className="size-3.5" /></Button>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="animate-fade-in-up" style={{ animationDuration: "0.25s" }}>
              <h2 className="text-lg font-semibold tracking-tight">Tools</h2>
              <p className="mt-1 text-sm text-muted-foreground/60">Built-in web tools are included for {displayName || "your agent"}.</p>
              <div className="mt-4 rounded-xl border border-dashed border-border/60 bg-muted/20 px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground/80">Tool creation and customization is coming soon.</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground/60">
                      Organization tools and integrations will be added here after the workspace tools flow is ready.
                    </p>
                  </div>
                  <Button size="sm" variant="outline" disabled className="shrink-0">
                    <Plus className="size-3" />
                    Create tool
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-1">
                {BUILTIN_AGENT_TOOLS.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    disabled
                    aria-pressed="true"
                    className="flex cursor-not-allowed items-start gap-3 rounded-xl bg-accent px-3.5 py-3 text-left ring-1 ring-foreground/10"
                  >
                    <div className="flex size-5 shrink-0 items-center justify-center rounded-md border border-foreground bg-foreground">
                      <Check className="size-3 text-background" />
                    </div>
                    <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{tool.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground/60">{tool.description}</p>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground/45">
                        Claude {tool.claudeName} · Codex {tool.codexName}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => setStep(2)}><ArrowLeft className="size-3.5" />Back</Button>
                <Button onClick={() => setStep(4)}>Continue with {BUILTIN_AGENT_TOOLS.length} tools <ArrowRight className="size-3.5" /></Button>
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="animate-fade-in-up" style={{ animationDuration: "0.25s" }}>
              <h2 className="text-lg font-semibold tracking-tight">Review</h2>
              <p className="mt-1 text-sm text-muted-foreground/60">Everything look good?</p>
              <div className="mt-6 rounded-2xl border border-border/50 bg-card p-6" style={{ boxShadow: "0 2px 8px 0 rgba(0,0,0,0.04)" }}>
                <div className="mb-4 size-12 rounded-full" style={{ backgroundImage: workspaceAgentGradient(avatarGradientSeed) }} />
                <h3 className="text-xl font-semibold">{displayName}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                {selectedSkillIds.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-muted-foreground/50">Skills</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {allSkills.filter((s) => selectedSkillIds.includes(s._id)).map((s) => (
                        <Badge key={s._id} variant="secondary" className="text-[11px]"><BookOpen className="mr-1 size-2.5" />{s.displayName}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted-foreground/50">Tools</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {BUILTIN_AGENT_TOOLS.map((tool) => (
                      <Badge key={tool.id} variant="secondary" className="text-[11px]">
                        <Wrench className="mr-1 size-2.5" />
                        {tool.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => setStep(3)}><ArrowLeft className="size-3.5" />Back</Button>
                <Button onClick={handleCreate} disabled={saving}>{saving ? "Creating..." : "Create agent"}</Button>
              </div>
            </div>
          )}
        </div>
      </div>

        {creatingSkill && (
          <div className="fixed inset-0 z-50 flex">
            <button
              type="button"
              aria-label="Close skill drawer"
              className="absolute inset-0 bg-background/30"
              onClick={() => setCreatingSkill(false)}
            />
            <div className="ml-auto relative flex h-full w-full max-w-[680px] flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right-full duration-200">
            <SkillCreatePanel
              teams={teams}
              onClose={() => setCreatingSkill(false)}
              onSave={async (data: SkillFormData) => {
                const skill = await createSkillApi({
                  workspaceId,
                  displayName: data.displayName,
                  slug: data.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
                  description: data.description,
                  icon: data.icon,
                  bodyMarkdown: data.bodyMarkdown,
                  tags: data.tags,
                  teamIds: data.teamIds,
                  visibility: data.teamIds.length > 0 ? "teams" : "workspace",
                });
                setCreatingSkill(false);
                setSelectedSkillIds((prev) => [...prev, skill._id]);
                listSkills({ workspaceId }).then(setAllSkills);
              }}
            />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
