"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Briefcase,
  Check,
  Code,
  FileText,
  Globe,
  Heart,
  Lightbulb,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Settings,
  Shield,
  Target,
  Trash2,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  listSkills,
  getSkillDetail,
  createSkill,
  deleteSkill,
  updateSkill,
  type MockSkill,
} from "@/lib/mock-data/workspace-library";

export type SkillFormData = {
  displayName: string;
  description: string;
  icon: string;
  bodyMarkdown: string;
  tags: string[];
  teamIds: string[];
};

function defaultTeamId(teams: Array<{ _id: string; name: string }>): string | null {
  return teams.find((team) => team.name.toLowerCase() === "general")?._id ??
    teams[0]?._id ??
    null;
}

function defaultTeamIds(teams: Array<{ _id: string; name: string }>): string[] {
  const teamId = defaultTeamId(teams);
  return teamId ? [teamId] : [];
}

// Multi-select combo for teams
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

// ---------------------------------------------------------------------------
// Icon catalogue for skills
// ---------------------------------------------------------------------------

const SKILL_ICONS: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  code: Code,
  target: Target,
  shield: Shield,
  "message-square": MessageSquare,
  users: Users,
  zap: Zap,
  "bar-chart-3": BarChart3,
  mail: Mail,
  globe: Globe,
  briefcase: Briefcase,
  lightbulb: Lightbulb,
  "file-text": FileText,
  settings: Settings,
  "alert-triangle": AlertTriangle,
  heart: Heart,
};

function SkillIcon({ name, className }: { name: string; className?: string }) {
  const Icon = SKILL_ICONS[name] ?? BookOpen;
  return <Icon className={className} />;
}

function IconPicker({ value, onChange, disabled }: { value: string; onChange: (icon: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={(nextOpen) => !disabled && setOpen(nextOpen)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Choose skill icon"
          className={cn(
            "relative flex size-12 items-center justify-center rounded-full bg-muted ring-1 ring-border/30 transition-shadow",
            !disabled && "cursor-pointer hover:ring-[3px] hover:ring-border/70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70",
            disabled && "cursor-default",
          )}
        >
          <SkillIcon name={value} className="size-5 text-muted-foreground" />
          {!disabled && (
            <span className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full border border-background bg-background text-muted-foreground shadow-sm ring-1 ring-border">
              <Pencil className="size-2.5" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <p className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground/60">Choose an icon</p>
        <div className="grid grid-cols-8 gap-1">
          {Object.entries(SKILL_ICONS).map(([name, Icon]) => (
            <button
              key={name}
              type="button"
              onClick={() => { onChange(name); setOpen(false); }}
              className={cn(
                "flex size-7 items-center justify-center rounded-md transition-colors",
                value === name
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
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

function parseTagInput(value: string): string[] {
  return value
    .split(/[,\s]+/g)
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean);
}

function appendTags(current: string[], input: string): string[] {
  const seen = new Set(current);
  const next = [...current];
  for (const tag of parseTagInput(input)) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    next.push(tag);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Main Library page
// ---------------------------------------------------------------------------

type LibraryClientProps = {
  workspaceId: string;
  teams: Array<{ _id: string; name: string; memberCount: number }>;
};

export function LibraryClient({ workspaceId, teams }: LibraryClientProps) {
  const [skills, setSkills] = useState<MockSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedListKey, setSelectedListKey] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<
    (MockSkill & { bodyMarkdown: string }) | null
  >(null);
  const [isCreating, setIsCreating] = useState(false);

  const teamMap = new Map(teams.map((t) => [t._id, t.name]));

  const fetchSkills = useCallback(async () => {
    const result = await listSkills({
      workspaceId,
      query: searchQuery || undefined,
    });
    setSkills(result);
    setLoading(false);
  }, [searchQuery, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    listSkills({ workspaceId, query: searchQuery || undefined }).then((result) => {
      if (!cancelled) { setSkills(result); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [searchQuery, workspaceId]);

  useEffect(() => {
    if (!selectedSkillId) return;
    let cancelled = false;
    getSkillDetail(selectedSkillId, workspaceId).then((detail) => {
      if (!cancelled) setSelectedSkill(detail);
    });
    return () => { cancelled = true; };
  }, [selectedSkillId, workspaceId]);

  const openSkill = (skillId: string, listKey: string) => {
    setSelectedSkillId(skillId);
    setSelectedListKey(listKey);
    setSelectedSkill(null);
    setIsCreating(false);
  };

  const closePanel = () => {
    setSelectedSkillId(null);
    setSelectedListKey(null);
    setSelectedSkill(null);
    setIsCreating(false);
  };

  const handleCreate = async (data: SkillFormData) => {
    await createSkill({
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
    setIsCreating(false);
    void fetchSkills();
  };

  // "n" shortcut
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "n" && !isCreating) { e.preventDefault(); setIsCreating(true); setSelectedSkillId(null); setSelectedListKey(null); setSelectedSkill(null); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isCreating]);

  // Filter + group by team
  const filtered = useMemo(() => {
    if (!searchQuery) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter((s) =>
      s.displayName.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t) => t.includes(q)),
    );
  }, [skills, searchQuery]);

  const teamGroups = useMemo(() => {
    const groups = new Map<string, MockSkill[]>();
    const seen = new Map<string, Set<string>>();
    for (const skill of filtered) {
      const keys = skill.teamIds.length === 0 ? ["workspace"] : skill.teamIds;
      for (const key of keys) {
        const list = groups.get(key) ?? [];
        const ids = seen.get(key) ?? new Set();
        if (!ids.has(skill._id)) { list.push(skill); ids.add(skill._id); groups.set(key, list); seen.set(key, ids); }
      }
    }
    return groups;
  }, [filtered]);

  const panelOpen = !!(selectedSkillId || selectedSkill || isCreating);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[720px] flex-col items-center px-6 pt-[18vh] pb-12">
        {/* Header */}
        <h1
          className="text-2xl tracking-tight opacity-0 animate-fade-in-up"
          style={{ fontFamily: "AlphaLyrae, sans-serif", fontFeatureSettings: '"calt" 1' }}
        >
          Library.
        </h1>
        <div className="mt-6 flex items-center gap-2 opacity-0 animate-fade-in-up" style={{ animationDelay: "150ms" }}>
          <Button variant="outline" size="default" onClick={() => { setIsCreating(true); setSelectedSkillId(null); setSelectedListKey(null); setSelectedSkill(null); }}>
            <Plus className="size-3.5" />
            New skill
            <Kbd className="ml-1">N</Kbd>
          </Button>
        </div>

        {/* Empty state */}
        {!loading && skills.length === 0 && (
          <div className="mt-12 w-full max-w-lg opacity-0 animate-fade-in-up" style={{ animationDelay: "300ms" }}>
            <div className="text-center">
              <h3 className="text-sm font-medium text-foreground/90">What are skills?</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground/70">
                A skill is a reusable set of <span className="text-foreground/80 font-medium">instructions</span> that you can attach to any agent. Define a skill once, then share it across multiple agents so they all behave consistently without duplicating prompts.
              </p>
            </div>

            {/* Visual: skill flowing into multiple agents */}
            <div className="mt-6 flex justify-center">
              <svg width="380" height="160" viewBox="0 0 380 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-muted-foreground">
                {/* Skill */}
                <rect x="30" y="50" width="90" height="60" rx="10" stroke="currentColor" strokeWidth="1.4" opacity="0.4" />
                <rect x="48" y="68" width="54" height="4" rx="2" fill="currentColor" fillOpacity="0.12" />
                <rect x="48" y="78" width="40" height="4" rx="2" fill="currentColor" fillOpacity="0.08" />
                <rect x="48" y="88" width="48" height="4" rx="2" fill="currentColor" fillOpacity="0.08" />
                <text x="75" y="128" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.35">Skill</text>

                {/* Arrows */}
                <line x1="120" y1="65" x2="220" y2="45" stroke="currentColor" strokeWidth="1" opacity="0.2" />
                <line x1="120" y1="80" x2="220" y2="80" stroke="currentColor" strokeWidth="1" opacity="0.2" />
                <line x1="120" y1="95" x2="220" y2="115" stroke="currentColor" strokeWidth="1" opacity="0.2" />

                {/* Agent 1 */}
                <circle cx="240" cy="40" r="14" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
                <circle cx="240" cy="40" r="5" fill="currentColor" fillOpacity="0.2" />
                <text x="280" y="44" fontSize="9" fill="currentColor" opacity="0.35">Agent A</text>

                {/* Agent 2 */}
                <circle cx="240" cy="80" r="14" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
                <circle cx="240" cy="80" r="5" fill="currentColor" fillOpacity="0.2" />
                <text x="280" y="84" fontSize="9" fill="currentColor" opacity="0.35">Agent B</text>

                {/* Agent 3 */}
                <circle cx="240" cy="120" r="14" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
                <circle cx="240" cy="120" r="5" fill="currentColor" fillOpacity="0.2" />
                <text x="280" y="124" fontSize="9" fill="currentColor" opacity="0.35">Agent C</text>
              </svg>
            </div>
          </div>
        )}

        {/* Skills section */}
        {!loading && skills.length > 0 && (
          <div className="mt-10 w-full opacity-0 animate-fade-in-up" style={{ animationDelay: "300ms" }}>
            <div className="flex w-full items-center gap-3 mb-5">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">your skills</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <input
                  type="text"
                  placeholder="Search skills..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-full rounded-lg bg-muted/50 pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-muted focus:ring-1 focus:ring-ring/20"
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="mt-4 text-center text-xs text-muted-foreground/50">
                No skills match your search
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {Array.from(teamGroups.entries()).map(([key, groupSkills]) => (
                  <div key={key}>
                    <h2 className="mb-1.5 px-3 text-[11px] font-medium text-muted-foreground/50">
                      {key === "workspace" ? "Entire workspace" : teamMap.get(key) ?? key}
                    </h2>
                    <div className="flex flex-col gap-0.5">
                      {groupSkills.map((skill) => {
                        const listKey = `${key}:${skill._id}`;
                        return (
                          <button
                            key={listKey}
                            type="button"
                            onClick={() => openSkill(skill._id, listKey)}
                            className={cn(
                              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-150",
                              selectedListKey === listKey ? "bg-accent" : "hover:bg-accent/50",
                            )}
                          >
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                              <SkillIcon name={skill.icon} className="size-3.5 text-muted-foreground" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-sm font-medium leading-tight">{skill.displayName}</h3>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground/70">{skill.description}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {/*
                              {skill.tags.slice(0, 2).map((tag) => (
                                <span key={tag} className="rounded-full bg-muted/60 px-1.5 py-px text-[9px] font-medium text-muted-foreground/50">{tag}</span>
                              ))}
                              */}
                              <ArrowRight className="size-3.5 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail/create drawer */}
      {panelOpen && (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Close skill drawer"
            className="absolute inset-0 bg-background/30"
            onClick={closePanel}
          />
          <div className="ml-auto relative flex h-full w-full max-w-[680px] flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right-full duration-200">
            {selectedSkill && !isCreating ? (
              <SkillDetailPanel
                key={selectedSkill._id}
                skill={selectedSkill}
                teams={teams}
                onClose={closePanel}
                onDelete={async () => {
                  const deleted = await deleteSkill(selectedSkill._id, workspaceId);
                  if (!deleted) return false;
                  await fetchSkills();
                  return true;
                }}
                onSave={async (data) => {
                  await updateSkill(selectedSkill._id, data);
                  void fetchSkills();
                  const updated = await getSkillDetail(selectedSkill._id, workspaceId);
                  if (updated) setSelectedSkill(updated);
                }}
              />
            ) : null}

            {isCreating ? (
              <SkillCreatePanel
                teams={teams}
                onClose={closePanel}
                onSave={handleCreate}
              />
            ) : null}

            {selectedSkillId && !selectedSkill && !isCreating ? (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between px-5 py-3">
                  <div className="h-3 w-32 rounded bg-muted" />
                  <button type="button" onClick={closePanel} className="rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="space-y-3 px-6 py-4">
                  <div className="size-10 rounded-full bg-muted" />
                  <div className="h-5 w-48 rounded bg-muted" />
                  <div className="h-3 w-72 rounded bg-muted" />
                  <div className="h-px bg-border/40" />
                  <div className="h-3 w-full rounded bg-muted" />
                  <div className="h-3 w-5/6 rounded bg-muted" />
                  <div className="h-3 w-2/3 rounded bg-muted" />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill detail panel (right side) — read-only by default, E to edit
// ---------------------------------------------------------------------------

function SkillDetailPanel({
  skill,
  teams,
  onClose,
  onDelete,
  onSave,
}: {
  skill: MockSkill & { bodyMarkdown: string };
  teams: Array<{ _id: string; name: string; memberCount: number }>;
  onClose: () => void;
  onDelete: () => Promise<boolean>;
  onSave: (data: SkillFormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(skill.displayName);
  const [description, setDescription] = useState(skill.description);
  const [icon, setIcon] = useState(skill.icon);
  const [bodyMarkdown, setBodyMarkdown] = useState(skill.bodyMarkdown);
  const [tags, setTags] = useState(skill.tags);
  const [teamIds, setTeamIds] = useState(skill.teamIds);
  const [tagInput, setTagInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const teamMap = new Map(teams.map((t) => [t._id, t.name]));
  const markDirty = () => { if (!dirty) setDirty(true); };

  const enterEditMode = () => {
    setEditing(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const cancelEdit = useCallback(() => {
    setDisplayName(skill.displayName);
    setDescription(skill.description);
    setIcon(skill.icon);
    setBodyMarkdown(skill.bodyMarkdown);
    setTags(skill.tags);
    setTeamIds(skill.teamIds);
    setTagInput("");
    setDirty(false);
    setEditing(false);
  }, [skill]);

  const handleSave = async () => {
    setSaving(true);
    await onSave({ displayName, description, icon, bodyMarkdown, tags, teamIds });
    setSaving(false);
    setDirty(false);
    setEditing(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const deleted = await onDelete();
      if (deleted) {
        toast.success("Skill deleted");
        setDeleteOpen(false);
        onClose();
        return;
      }
      toast.error("Could not delete skill");
    } catch (error) {
      toast.error("Could not delete skill", {
        description: apiErrorLabel(error),
      });
    } finally {
      setDeleting(false);
    }
  };

  // Tag UI is intentionally commented out below for now.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const addTag = () => {
    const nextTags = appendTags(tags, tagInput);
    if (nextTags.length !== tags.length) {
      setTags(nextTags);
      markDirty();
    }
    setTagInput("");
  };

  // E to edit, Escape to exit
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (editing) {
          cancelEdit();
        } else {
          onClose();
        }
        return;
      }
      const t = (e.target as HTMLElement)?.tagName;
      if (t === "INPUT" || t === "TEXTAREA") return;
      if (e.key === "e" && !editing) { e.preventDefault(); enterEditMode(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [cancelEdit, editing, onClose]);

  // Auto-resize textarea
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [bodyMarkdown, editing]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <>
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden animate-fade-in-up" style={{ animationDuration: "0.15s" }}>
      {/* Nav */}
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/40">
          <span className="font-mono">{skill.slug}</span>
          <span>v{skill.currentRevisionNumber}</span>
          <span>{formatDate(skill.updatedAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <Button size="sm" variant="outline" onClick={enterEditMode}>
              <Pencil className="size-3" />
              Edit
              <Kbd className="ml-1">E</Kbd>
            </Button>
          )}
          {!editing && (
            <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="size-3" />
              Delete
            </Button>
          )}
          {editing && dirty && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
          {editing && !dirty && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Done
            </Button>
          )}
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Floating edit bar */}
      {editing && (
        <div className="pointer-events-none absolute inset-x-0 top-11 z-10 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-card px-4 py-2 ring-1 ring-border/50 animate-fade-in-up" style={{ animationDuration: "0.2s", boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>
            <Pencil className="size-3 text-muted-foreground" />
            <span className="text-xs font-medium">Document is now editable</span>
            <span className="text-[11px] text-muted-foreground/50">Click any text to edit</span>
            <span className="h-4 w-px bg-border" />
            {dirty ? (
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Done</Button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-4 pb-20">
          {/* Icon */}
          <div className="mb-3">
            <IconPicker value={icon} onChange={(i) => { setIcon(i); markDirty(); }} disabled={!editing} />
          </div>

          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            value={displayName}
            onChange={(e) => { setDisplayName(e.target.value); markDirty(); }}
            readOnly={!editing}
            tabIndex={editing ? 0 : -1}
            placeholder="Skill name"
            className={cn(
              "w-full bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/25",
              !editing && "pointer-events-none",
            )}
          />

          {/* Description */}
          <input
            type="text"
            value={description}
            onChange={(e) => { setDescription(e.target.value); markDirty(); }}
            readOnly={!editing}
            tabIndex={editing ? 0 : -1}
            placeholder="Add a description..."
            className={cn(
              "mt-1 w-full bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/25",
              !editing && "pointer-events-none",
            )}
          />

          {/* Tags */}
          {/*
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="group inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {tag}
                {editing && (
                  <button type="button" onClick={() => { setTags(tags.filter((t) => t !== tag)); markDirty(); }} className="opacity-0 transition-opacity group-hover:opacity-100">
                    <X className="size-2.5" />
                  </button>
                )}
              </span>
            ))}
            {editing && (
              <input
                type="text"
                placeholder="+ tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addTag(); }
                  if (e.key === "," && tagInput.trim()) { e.preventDefault(); addTag(); }
                  if (e.key === "Backspace" && !tagInput && tags.length > 0) { setTags(tags.slice(0, -1)); markDirty(); }
                }}
                className="min-w-[40px] max-w-[80px] bg-transparent text-[11px] text-muted-foreground outline-none placeholder:text-muted-foreground/30"
              />
            )}
          </div>
          */}

          {/* Teams */}
          <div className="mt-2">
            {editing ? (
              <TeamMultiSelect teams={teams} selected={teamIds} onChange={(ids) => { setTeamIds(ids); markDirty(); }} />
            ) : (
              <span className="text-xs text-muted-foreground/50">
                {teamIds.length === 0 ? "Entire workspace" : teamIds.map((id) => teamMap.get(id) ?? id).join(", ")}
                {" \u00B7 "}{skill.createdByName}
              </span>
            )}
          </div>

          {/* Divider */}
          <div className="my-5 h-px bg-border/40" />

          {/* Body */}
          {editing ? (
            <textarea
              ref={bodyRef}
              value={bodyMarkdown}
              onChange={(e) => { setBodyMarkdown(e.target.value); markDirty(); }}
              placeholder="Write your skill instructions here..."
              className="w-full resize-none bg-transparent text-sm leading-[1.8] text-foreground/90 outline-none placeholder:text-muted-foreground/25"
              rows={1}
            />
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-[1.8] text-foreground/90 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_p]:my-1">
              <Markdown remarkPlugins={[remarkGfm]}>{bodyMarkdown || "*No instructions yet*"}</Markdown>
            </div>
          )}
        </div>
      </div>
    </div>
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete skill</DialogTitle>
          <DialogDescription>
            Delete &ldquo;{skill.displayName}&rdquo; from the library? Agents using this skill will lose it and may need review before running.
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
// Skill create panel (right side)
// ---------------------------------------------------------------------------

export function SkillCreatePanel({
  teams,
  onClose,
  onSave,
}: {
  teams: Array<{ _id: string; name: string; memberCount: number }>;
  onClose: () => void;
  onSave: (data: SkillFormData) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("book-open");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>(() =>
    defaultTeamIds(teams),
  );
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => titleRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [bodyMarkdown]);

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Tag UI is intentionally commented out below for now.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const addTag = () => {
    setTags(appendTags(tags, tagInput));
    setTagInput("");
  };

  const canSave = Boolean(displayName.trim()) && !saving;

  const handleSave = async () => {
    if (!displayName.trim() || saving) return;
    setSaving(true);
    await onSave({ displayName, description, icon, bodyMarkdown, tags, teamIds });
    setSaving(false);
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      e.key !== "Enter" ||
      (!e.ctrlKey && !e.metaKey) ||
      e.nativeEvent.isComposing
    ) {
      return;
    }

    e.preventDefault();
    if (canSave) void handleSave();
  };

  return (
    <div
      className="flex min-w-0 flex-1 flex-col overflow-hidden animate-fade-in-up"
      style={{ animationDuration: "0.15s" }}
      onKeyDown={handleCreateKeyDown}
    >
      {/* Nav */}
      <div className="flex items-center justify-between px-5 py-3">
        <span className="text-sm font-medium">New skill</span>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {saving ? "Creating..." : "Create"}
          </Button>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-4 pb-20">
          {/* Icon */}
          <div className="mb-3">
            <IconPicker value={icon} onChange={setIcon} />
          </div>

          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Skill name"
            className="w-full bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/25"
          />

          {/* Description */}
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this skill do?"
            className="mt-1 w-full bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/25"
          />

          {/* Tags */}
          {/*
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="group inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {tag}
                <button type="button" onClick={() => setTags(tags.filter((t) => t !== tag))} className="opacity-0 transition-opacity group-hover:opacity-100">
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
            <input
              type="text"
              placeholder="Add tags..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addTag(); }
                if (e.key === "," && tagInput.trim()) { e.preventDefault(); addTag(); }
                if (e.key === "Backspace" && !tagInput && tags.length > 0) setTags(tags.slice(0, -1));
              }}
              className="min-w-[60px] max-w-[120px] bg-transparent text-[11px] text-muted-foreground outline-none placeholder:text-muted-foreground/30"
            />
          </div>
          */}

          {/* Teams */}
          <div className="mt-3">
            <p className="mb-2 text-[11px] font-medium text-muted-foreground/50">
              Shared with
            </p>
            <TeamMultiSelect teams={teams} selected={teamIds} onChange={setTeamIds} />
          </div>

          {/* Divider */}
          <div className="my-5 h-px bg-border/40" />

          {/* Body */}
          <textarea
            ref={bodyRef}
            value={bodyMarkdown}
            onChange={(e) => setBodyMarkdown(e.target.value)}
            placeholder="Write your skill instructions here..."
            className="w-full resize-none bg-transparent text-sm leading-[1.8] text-foreground/90 outline-none placeholder:text-muted-foreground/25"
            rows={8}
          />
        </div>
      </div>
    </div>
  );
}
