"use client";

import { useState } from "react";
import {
  ChevronDownIcon,
  PencilIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanData = {
  title: string | null;
  overview: string | null;
  features: { name: string; description: string; emoji: string | null }[] | null;
  dataFlow: string | null;
  agents: string | null;
  backend: string | null;
};

type PlanCardProps = {
  plan: PlanData;
  isStreaming: boolean;
  actionsEnabled: boolean;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
};

// ---------------------------------------------------------------------------
// Agent parsing & sphere
// ---------------------------------------------------------------------------

type ParsedAgent = { name: string; summary: string };

function parseAgents(text: string): ParsedAgent[] {
  const regex = /\*\*([^*]+)\*\*/g;
  const matches = [...text.matchAll(regex)];
  if (matches.length === 0) return [];

  const parts: ParsedAgent[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const name = m[1].trim();
    const start = (m.index ?? 0) + m[0].length;
    const end =
      i + 1 < matches.length
        ? (matches[i + 1].index ?? text.length)
        : text.length;
    const summary = text
      .slice(start, end)
      .replace(/^[\s\u2014\-\u2013:.,()]+/, "")
      .replace(/\s+/g, " ")
      .trim();
    parts.push({ name, summary });
  }
  return parts;
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

function AgentAvatar({ seed }: { seed: string }) {
  return (
    <div
      className="size-9 shrink-0 rounded-full ring-1 ring-border/40"
      style={{ backgroundImage: pickAgentGradient(seed) }}
    />
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function TextSkeleton({
  lines = 2,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3.5 rounded"
          style={{ width: i === lines - 1 ? "64%" : "100%" }}
        />
      ))}
    </div>
  );
}

function FeatureSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="size-8 rounded-lg shrink-0" />
      <Skeleton className="h-3.5 w-28 rounded" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature accordion item
// ---------------------------------------------------------------------------

function FeatureAccordionItem({
  feature,
  index,
  isOpen,
  onToggle,
}: {
  feature: { name: string; description: string; emoji: string | null };
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "animate-fade-in-up opacity-0 rounded-xl transition-colors",
        isOpen && "bg-muted/40",
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 rounded-xl"
      >
        <span className="text-[16px] leading-none shrink-0">
          {feature.emoji || "✨"}
        </span>
        <span className="flex-1 text-[14px] font-medium leading-snug">
          {feature.name}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-foreground/50 transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>
      <div
        className={cn(
          "overflow-hidden transition-all duration-200",
          isOpen ? "max-h-40 opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <p className="px-4 pb-3 pl-[3.75rem] text-[13px] leading-relaxed text-muted-foreground">
          {feature.description}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PlanCard({
  plan,
  isStreaming,
  actionsEnabled,
  onApprove,
  onRequestChanges,
}: PlanCardProps) {
  const [openFeatures, setOpenFeatures] = useState<Set<number>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const [feedback, setFeedback] = useState("");

  const title = plan.title || "Build Plan";
  const agents = plan.agents ? parseAgents(plan.agents) : [];

  return (
    <div className="relative rounded-2xl">
      {actionsEnabled && (
        <>
          <div className="composer-gradient-border-short absolute -inset-[1px] rounded-2xl" />
          <div className="composer-focus-glow-short absolute -inset-1.5 rounded-2xl" />
        </>
      )}

      <div
        className="relative not-prose overflow-hidden rounded-2xl bg-[var(--composer-bg)]"
        style={{ boxShadow: "var(--composer-shadow)" }}
      >
        {/* Header + actions */}
        <div className="px-5 pt-6 pb-4 sm:px-6 sm:pt-7 sm:pb-5">
          <div className="text-[11px] font-medium text-muted-foreground/50 mb-2.5">
            Plan
          </div>
          <span className="text-[15px] font-semibold tracking-[-0.01em]">
            {title}
          </span>
          {plan.overview ? (
            <p className="mt-2 text-[14px] leading-relaxed text-foreground">
              {plan.overview}
            </p>
          ) : (
            <TextSkeleton lines={2} className="mt-3" />
          )}

          {/* Actions — right below description */}
          {!editMode ? (
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <Button
                className="rounded-full h-8 px-3.5 text-[13px]"
                disabled={!actionsEnabled}
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
            <div className="mt-5 flex flex-col gap-3">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What would you like to change?"
                rows={3}
                className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  className="rounded-full"
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
                  className="rounded-full"
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

        {/* Features */}
        <div className="border-t border-border/50 px-5 py-5 sm:px-6">
          <div className="text-[13px] font-semibold text-foreground/70 mb-2">
            Features
          </div>
          <div className="space-y-1.5 -mx-3 sm:-mx-3">
            {plan.features ? (
              <>
                {plan.features
                  .filter((f) => f.emoji)
                  .map((feature, index) => (
                    <FeatureAccordionItem
                      key={`${feature.name}-${index}`}
                      feature={feature}
                      index={index}
                      isOpen={openFeatures.has(index)}
                      onToggle={() =>
                        setOpenFeatures((prev) => {
                          const next = new Set(prev);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          return next;
                        })
                      }
                    />
                  ))}
                {isStreaming &&
                  plan.features.some((f) => !f.emoji) && <FeatureSkeleton />}
              </>
            ) : isStreaming ? (
              <>
                <FeatureSkeleton />
                <FeatureSkeleton />
                <FeatureSkeleton />
              </>
            ) : null}
          </div>
        </div>

        {/* Agents — hidden for now */}
        {false && (plan.agents || isStreaming) && (
          <div className="border-t border-border/50 px-5 py-5 sm:px-6">
            <div className="text-[13px] font-semibold text-foreground/70 mb-3">
              Agents
            </div>
            {plan.agents ? (
              agents.length > 0 ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {agents.map((agent, index) => (
                    <Tooltip key={`${agent.name}-${index}`}>
                      <TooltipTrigger asChild>
                        <div
                          className="animate-fade-in-up flex items-center gap-2.5 opacity-0 cursor-default"
                          style={{ animationDelay: `${index * 60}ms` }}
                        >
                          <AgentAvatar seed={agent.name} />
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium leading-snug">
                              {agent.name}
                            </div>
                            {agent.summary && (
                              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground line-clamp-1">
                                {agent.summary}
                              </p>
                            )}
                          </div>
                        </div>
                      </TooltipTrigger>
                      {agent.summary && (
                        <TooltipContent
                          side="top"
                          sideOffset={8}
                          className="pointer-events-none max-w-xs rounded-xl bg-background px-4 py-3.5 text-foreground shadow-lg ring-1 ring-border/50 backdrop-blur-md data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=closed]:hidden"
                        >
                          <div className="flex items-start gap-3">
                            <AgentAvatar seed={agent.name} />
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold leading-snug">
                                {agent.name}
                              </div>
                              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                                {agent.summary}
                              </p>
                            </div>
                          </div>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {plan.agents}
                </p>
              )
            ) : (
              <TextSkeleton lines={1} />
            )}
          </div>
        )}

      </div>
    </div>
  );
}
