"use client";

import { useState } from "react";
import {
  ArrowRightLeftIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  HammerIcon,
  LayoutListIcon,
  PencilIcon,
  ServerIcon,
  SparklesIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type PlanData = {
  overview: string | null;
  features: { name: string; description: string }[] | null;
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

function SectionLabel({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] mt-1 font-medium tracking-wide text-muted-foreground">
      {icon}
      {label}
    </div>
  );
}

function TextSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
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
    <div className="grid grid-cols-[2rem_1fr] gap-3 px-1 py-2">
      <Skeleton className="size-7 rounded-full" />
      <div className="flex flex-col gap-1.5 pt-0.5">
        <Skeleton className="h-3.5 w-32 rounded" />
        <Skeleton className="h-3 w-full rounded" />
      </div>
    </div>
  );
}

function ExpandableText({
  text,
  threshold = 260,
  className,
}: {
  text: string;
  threshold?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const canCollapse = text.length > threshold;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <p
          className={cn(
            "text-[13px] leading-relaxed text-foreground/80",
            canCollapse && !open && "max-h-28 overflow-hidden",
            className,
          )}
        >
          {text}
        </p>
        {canCollapse && !open ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-[var(--composer-bg)]" />
        ) : null}
      </div>
      {canCollapse ? (
        <button
          type="button"
          className="w-fit text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function FeatureItem({
  feature,
  index,
}: {
  feature: { name: string; description: string };
  index: number;
}) {
  return (
    <div
      className="animate-fade-in-up grid grid-cols-[2rem_1fr] gap-3 rounded-lg px-1 py-2 opacity-0 transition-colors hover:bg-muted/20"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className="flex size-7 items-center justify-center rounded-full border border-border bg-background text-[11px] font-medium">
        {index + 1}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-snug">
          {feature.name}
        </div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {feature.description}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agents / Backend preview — parsed text shown as mini UI cards
// ---------------------------------------------------------------------------

type ParsedAgent = { name: string; summary: string };

/** Parse a loose markdown string like "**Name A** — does X. **Name B** — does Y."
 * into structured {name, summary} entries. Returns [] if no **name** markers. */
function parseAgents(text: string): ParsedAgent[] {
  const regex = /\*\*([^*]+)\*\*/g;
  const matches = [...text.matchAll(regex)];
  if (matches.length === 0) return [];

  const parts: ParsedAgent[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const name = m[1].trim();
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
    const summary = text
      .slice(start, end)
      .replace(/^[\s—\-–:.,()]+/, "")
      .replace(/\s+/g, " ")
      .trim();
    parts.push({ name, summary });
  }
  return parts;
}

function AgentMiniCard({ agent }: { agent: ParsedAgent }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-background/40 px-3 py-2.5 transition-colors hover:bg-background/60">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06]">
        <BotIcon className="size-3 text-foreground/70" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-snug">{agent.name}</div>
        {agent.summary ? (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {agent.summary}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AgentsPreview({ text }: { text: string }) {
  const parsed = parseAgents(text);
  if (parsed.length > 0) {
    return (
      <div className="flex flex-col gap-1.5">
        {parsed.map((a, i) => (
          <AgentMiniCard key={`${a.name}-${i}`} agent={a} />
        ))}
      </div>
    );
  }
  return <ExpandableText text={text} threshold={180} />;
}

function BackendPreview({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
      <ExpandableText text={text} threshold={180} />
    </div>
  );
}

function RuntimePanel({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2.5">
      <SectionLabel icon={icon} label={label} />
      {children}
    </div>
  );
}

function NotAvailableState() {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-background/30 px-3 py-2.5 text-[11.5px] text-muted-foreground/70">
      Not available
    </div>
  );
}

export function PlanCard({
  plan,
  isStreaming,
  actionsEnabled,
  onApprove,
  onRequestChanges,
}: PlanCardProps) {
  const [editMode, setEditMode] = useState(false);
  const [feedback, setFeedback] = useState("");
  const featureCount = plan.features?.length ?? 0;

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
        <div className="px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex items-start gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06]">
              <HammerIcon className="size-4 text-foreground/70" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Build Plan</span>
                <Badge variant="secondary" className="gap-1">
                  {isStreaming ? (
                    <SparklesIcon className="size-2.5" />
                  ) : (
                    <CheckCircle2Icon className="size-2.5" />
                  )}
                  {isStreaming ? "Streaming" : "Ready"}
                </Badge>
                {featureCount > 0 ? (
                  <Badge variant="outline">
                    {featureCount} feature{featureCount === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3">
                {plan.overview ? (
                  <ExpandableText text={plan.overview} threshold={360} />
                ) : (
                  <TextSkeleton />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border px-5 py-4 sm:px-6">
          <SectionLabel
            icon={<LayoutListIcon className="size-3" />}
            label="Feature Scope"
          />
          <div className="mt-3 flex flex-col gap-1">
            {plan.features ? (
              plan.features.map((feature, index) => (
                <FeatureItem
                  key={`${feature.name}-${index}`}
                  feature={feature}
                  index={index}
                />
              ))
            ) : (
              <div className="flex flex-col gap-2">
                <FeatureSkeleton />
                <FeatureSkeleton />
                <FeatureSkeleton />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 border-t border-border px-5 py-4 sm:px-6 md:grid-cols-[1.4fr_1fr]">
          <RuntimePanel
            icon={<BotIcon className="size-3" />}
            label="Agents"
          >
            {plan.agents ? (
              <AgentsPreview text={plan.agents} />
            ) : isStreaming ? (
              <TextSkeleton lines={2} />
            ) : (
              <NotAvailableState />
            )}
          </RuntimePanel>
          <RuntimePanel
            icon={<ServerIcon className="size-3" />}
            label="Backend"
          >
            {plan.backend ? (
              <BackendPreview text={plan.backend} />
            ) : isStreaming ? (
              <TextSkeleton lines={1} />
            ) : (
              <NotAvailableState />
            )}
          </RuntimePanel>
        </div>

        <div className="border-t border-border px-5 py-3.5 sm:px-6">
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground">
              <ArrowRightLeftIcon className="size-3" />
              Data Flow
              <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3">
                {plan.dataFlow ? (
                  <ExpandableText text={plan.dataFlow} threshold={280} />
                ) : (
                  <TextSkeleton lines={3} />
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <div className="border-t border-border px-5 py-4 sm:px-6">
          {!editMode ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="rounded-full"
                disabled={!actionsEnabled}
                onClick={onApprove}
              >
                Approve & Build
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="rounded-full"
                disabled={!actionsEnabled}
                onClick={() => setEditMode(true)}
              >
                <PencilIcon data-icon="inline-start" />
                Request Changes
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What would you like to change?"
                rows={3}
                className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
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
                  size="lg"
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
      </div>
    </div>
  );
}
