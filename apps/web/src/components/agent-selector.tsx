"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Hammer, Plus, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { listAvailableAgents, type ApprovalStatus } from "@/lib/mock-data/workspace-agents";
import { workspaceAgentGradient } from "@/lib/workspace-agent-avatar";

type AgentOption = {
  _id: string;
  slug: string;
  avatarGradientSeed?: string | null;
  displayName: string;
  description: string;
  approvalStatus: ApprovalStatus;
};

type AgentSelectorProps = {
  workspaceId: string;
  value: string | null;
  onChange: (agentId: string | null) => void;
  onSelectedAgentChange?: (agent: AgentOption | null) => void;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "bottom";
};

export function AgentSelector({
  workspaceId,
  value,
  onChange,
  onSelectedAgentChange,
  onOpenChange,
  side = "top",
}: AgentSelectorProps) {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null>(null);
  const loaded = loadedWorkspaceId === workspaceId;

  useEffect(() => {
    let cancelled = false;

    listAvailableAgents(workspaceId)
      .then((items) => {
        if (cancelled) return;
        setAgents(items);
        setLoadedWorkspaceId(workspaceId);
      })
      .catch(() => {
        if (cancelled) return;
        setAgents([]);
        setLoadedWorkspaceId(workspaceId);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!loaded || !value) return;
    if (!agents.some((agent) => agent._id === value)) {
      onChange(null);
    }
  }, [agents, loaded, onChange, value]);

  const selected = value ? agents.find((a) => a._id === value) : null;

  useEffect(() => {
    if (!loaded) return;
    onSelectedAgentChange?.(selected ?? null);
  }, [loaded, onSelectedAgentChange, selected]);

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="default"
          className={cn(
            "gap-1.5 text-xs",
            value ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {selected ? (
            <>
              <div
                className="size-4 shrink-0 rounded-full ring-1 ring-border/50"
                style={{
                  backgroundImage: workspaceAgentGradient(
                    selected.avatarGradientSeed ?? selected._id,
                  ),
                }}
              />
              <span className="max-w-[100px] truncate">{selected.displayName}</span>
            </>
          ) : (
            <>
              <Hammer className="size-3.5" strokeWidth={1.5} />
              <span>Builder</span>
            </>
          )}
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" className="w-64">
        <DropdownMenuLabel>Agent</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Builder (default) */}
        <DropdownMenuItem
          onClick={() => onChange(null)}
          className="flex items-center gap-2.5"
        >
          <div className="flex size-6 items-center justify-center rounded-full bg-muted ring-1 ring-border/50">
            <Hammer className="size-3.5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Builder</p>
            <p className="truncate text-[11px] text-muted-foreground">
              Build apps and workflows
            </p>
          </div>
          {!value && <Check className="size-3.5 shrink-0 text-foreground" />}
        </DropdownMenuItem>

        {agents.length > 0 && <DropdownMenuSeparator />}

        {agents.map((agent) => (
          <DropdownMenuItem
            key={agent._id}
            onClick={() => onChange(agent._id)}
            className="flex items-center gap-2.5"
            disabled={agent.approvalStatus !== "approved"}
          >
            <div
              className="size-6 shrink-0 rounded-full ring-1 ring-border/50"
              style={{
                backgroundImage: workspaceAgentGradient(
                  agent.avatarGradientSeed ?? agent._id,
                ),
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-xs font-medium">
                  {agent.displayName}
                </p>
                {agent.approvalStatus === "approved" && (
                  <ShieldCheck className="size-2.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
                {agent.approvalStatus === "stale" && (
                  <ShieldAlert className="size-2.5 shrink-0 text-amber-600 dark:text-amber-400" />
                )}
              </div>
            </div>
            {value === agent._id && (
              <Check className="size-3.5 shrink-0 text-foreground" />
            )}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => router.push(`/w/${workspaceId}/agents`)}
        >
          <Plus className="size-3.5" strokeWidth={1.8} />
          <span>New agent</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
