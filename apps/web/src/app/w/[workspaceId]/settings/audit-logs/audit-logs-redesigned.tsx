"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  AppWindowIcon,
  ArrowRightIcon,
  BotIcon,
  ClockIcon,
  Code2Icon,
  DatabaseIcon,
  DownloadIcon,
  EyeOffIcon,
  FileJsonIcon,
  FingerprintIcon,
  HelpCircleIcon,
  GitBranchIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UsersRoundIcon,
  WrenchIcon,
  XIcon,
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
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AUDIT_EVENT_EXPLANATIONS } from "@/lib/audit/event-explanations";
import type { AuditEventListItem, AuditEventsSummaryReadModel } from "@/lib/audit/read-models";
import type {
  AuditEventCategory,
  AuditEventOutcome,
  AuditSourceKind,
  AuditSourceTrust,
} from "@/lib/db/types";

type AuditCategory = AuditEventCategory;
type AuditOutcome = AuditEventOutcome;
type AuditTrust = AuditSourceTrust;
type AuditSource = AuditSourceKind;

type AuditEvent = AuditEventListItem;

const CATEGORY_LABELS: Record<AuditCategory, string> = {
  auth: "Auth",
  access: "Access",
  members: "Members",
  teams: "Teams",
  apps: "Apps",
  reviews: "Reviews",
  integrations: "Integrations",
  agents: "Agents",
  tools: "Tools",
  app_data: "Data",
  app_event: "App events",
  audit: "Audit",
  library: "Library",
  source_control: "Source control",
  system: "System",
};

const CATEGORY_ICONS: Record<AuditCategory, LucideIcon> = {
  auth: LockKeyholeIcon,
  access: LockKeyholeIcon,
  members: UsersRoundIcon,
  teams: UsersRoundIcon,
  apps: AppWindowIcon,
  reviews: ShieldCheckIcon,
  integrations: KeyRoundIcon,
  agents: BotIcon,
  tools: WrenchIcon,
  app_data: DatabaseIcon,
  app_event: SparklesIcon,
  audit: ShieldCheckIcon,
  library: FileJsonIcon,
  source_control: GitBranchIcon,
  system: ActivityIcon,
};

const TRUST_LABEL: Record<AuditTrust, string> = {
  server_trusted: "Server",
  internal_trusted: "Internal trusted",
  client_untrusted: "Client untrusted",
};

const SOURCE_LABEL: Record<AuditSource, string> = {
  web_server: "Platform",
  worker: "Worker",
  app_iframe: "Generated app",
  app_agent: "App agent",
  builder_agent: "Builder",
  workspace_agent: "Workspace agent",
  system: "System",
};

const ACTIVITY_POINTS = [
  { label: "00", value: 30 },
  { label: "03", value: 18 },
  { label: "06", value: 42 },
  { label: "09", value: 88 },
  { label: "12", value: 54 },
  { label: "15", value: 66 },
  { label: "18", value: 74 },
  { label: "21", value: 45 },
];

const COVERAGE = [
  { label: "Platform governance", value: 96, detail: "members, teams, reviews, publishing" },
  { label: "App data writes", value: 91, detail: "insert, update, delete, agent writes" },
  { label: "Agent and tool runtime", value: 84, detail: "approvals, custom tools, mock/live calls" },
  { label: "Generated app events", value: 72, detail: "SDK events, rejected payloads, catalog match" },
];

const REDACTION_KEYS = [
  "tokens",
  "cookies",
  "headers",
  "session ids",
  "prompts",
  "messages",
  "source files",
  "full documents",
  "raw integration responses",
];

const ENTERPRISE_QUESTIONS = [
  "What changed in the last 24 hours?",
  "Which agents used live integrations?",
  "Which app events came from untrusted clients?",
  "Who rotated the Slack token?",
  "Which leads did the enrichment agent touch?",
];

const ENTERPRISE_ONLY_LABEL = "Enterprise only";

type FilterId =
  | "all"
  | "data_writes"
  | "agent_activity"
  | "denied_access"
  | "generated_events"
  | "integrations"
  | "members";

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: "all", label: "Last 24h" },
  { id: "data_writes", label: "Data writes" },
  { id: "agent_activity", label: "Agent activity" },
  { id: "denied_access", label: "Denied access" },
  { id: "generated_events", label: "Generated events" },
  { id: "integrations", label: "Integrations" },
  { id: "members", label: "Members & teams" },
];

function applyFilter(event: AuditEvent, filter: FilterId): boolean {
  switch (filter) {
    case "all":
      return true;
    case "data_writes":
      return event.category === "app_data";
    case "agent_activity":
      return (
        event.category === "agents" ||
        event.category === "tools" ||
        event.source.kind === "app_agent" ||
        event.source.kind === "builder_agent"
      );
    case "denied_access":
      return event.outcome === "denied" || event.outcome === "failure";
    case "generated_events":
      return event.category === "app_event" || event.source.kind === "app_iframe";
    case "integrations":
      return event.category === "integrations";
    case "members":
      return event.category === "members" || event.category === "teams";
  }
}

function matchesQuery(event: AuditEvent, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    event.eventName,
    event.summary,
    event.actor.name,
    event.actor.email,
    event.actor.team,
    event.actor.role,
    event.source.app,
    event.target.name,
    event.target.id,
    ...event.metadata.map((item) => `${item.label} ${item.value}`),
  ]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(normalized));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function actorInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function actorBackground(seed: string): string {
  const palette = [
    "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
    "linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)",
    "linear-gradient(120deg, #fddb92 0%, #d1fdff 100%)",
    "linear-gradient(120deg, #fff1eb 0%, #ace0f9 100%)",
    "linear-gradient(120deg, #f78ca0 0%, #fe9a8b 100%)",
    "linear-gradient(120deg, #74ebd5 0%, #9face6 100%)",
    "linear-gradient(120deg, #accbee 0%, #e7f0fd 100%)",
  ];
  const hash = seed.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return palette[hash % palette.length]!;
}

function outcomeColor(outcome: AuditOutcome): string {
  switch (outcome) {
    case "success":
    case "completed":
      return "text-emerald-600 dark:text-emerald-400";
    case "started":
      return "text-sky-600 dark:text-sky-400";
    case "denied":
      return "text-rose-600 dark:text-rose-400";
    case "failure":
      return "text-amber-700 dark:text-amber-400";
  }
}

function outcomeDot(outcome: AuditOutcome): string {
  switch (outcome) {
    case "success":
    case "completed":
      return "bg-emerald-500";
    case "started":
      return "bg-sky-500";
    case "denied":
      return "bg-rose-500";
    case "failure":
      return "bg-amber-500";
  }
}

function trustColor(trust: AuditTrust): string {
  if (trust === "client_untrusted") return "text-amber-700 dark:text-amber-400";
  if (trust === "internal_trusted") return "text-sky-700 dark:text-sky-400";
  return "text-emerald-700 dark:text-emerald-400";
}

function StatusPill({ live }: { live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
      <span className="relative flex size-1.5">
        {live ? (
          <>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </>
        ) : (
          <span className="inline-flex size-1.5 rounded-full bg-muted-foreground/40" />
        )}
      </span>
      {live ? "Streaming" : "Manual refresh"}
    </span>
  );
}

function EnterpriseOnlyBadge() {
  return (
    <Badge variant="outline" className="gap-1 border-border/70 bg-background/80">
      <LockKeyholeIcon />
      {ENTERPRISE_ONLY_LABEL}
    </Badge>
  );
}

function EnterpriseOnlyTooltip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-not-allowed">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{ENTERPRISE_ONLY_LABEL}</TooltipContent>
    </Tooltip>
  );
}

function EnterpriseOnlyPreview({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center">
        <EnterpriseOnlyBadge />
      </div>
      <div className="opacity-40">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ActorAvatar({
  event,
  size = "md",
}: {
  event: AuditEvent;
  size?: "sm" | "md" | "lg";
}) {
  const Icon = event.actor.kind === "agent" ? BotIcon : event.actor.kind === "system" ? SparklesIcon : null;
  const dim = size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-8";
  const text = size === "sm" ? "text-[9px]" : size === "lg" ? "text-xs" : "text-[10px]";
  const iconSize = size === "sm" ? "size-3" : size === "lg" ? "size-4" : "size-3.5";

  if (Icon) {
    return (
      <div
        className={cn(
          dim,
          "flex shrink-0 items-center justify-center rounded-full bg-muted ring-1 ring-border/40",
        )}
      >
        <Icon className={cn(iconSize, "text-muted-foreground")} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        dim,
        "flex shrink-0 items-center justify-center rounded-full font-medium text-foreground/70 ring-1 ring-border/30",
        text,
      )}
      style={{ backgroundImage: actorBackground(event.actor.name) }}
    >
      {actorInitials(event.actor.name)}
    </div>
  );
}

function CategoryGlyph({ event, size = "md" }: { event: AuditEvent; size?: "sm" | "md" }) {
  const Icon = CATEGORY_ICONS[event.category];
  const dim = size === "sm" ? "size-5" : "size-7";
  const iconSize = size === "sm" ? "size-3" : "size-3.5";
  return (
    <div
      className={cn(
        dim,
        "flex shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground/70",
      )}
    >
      <Icon className={iconSize} />
    </div>
  );
}

function ActivityChart() {
  return (
    <div className="flex h-20 items-end gap-1">
      {ACTIVITY_POINTS.map((point) => (
        <div key={point.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <div className="flex h-16 w-full items-end">
            <div
              className="w-full rounded-sm bg-foreground/15 transition-colors hover:bg-foreground/30"
              style={{ height: `${point.value}%` }}
            />
          </div>
          <span className="font-mono text-[9px] text-muted-foreground/40">{point.label}</span>
        </div>
      ))}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  enterpriseOnly = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  enterpriseOnly?: boolean;
}) {
  return (
    <div className="group flex flex-col gap-1.5 rounded-xl border border-border/50 bg-card/40 px-4 py-3.5 transition-colors hover:border-border hover:bg-card/60">
      {enterpriseOnly ? <EnterpriseOnlyBadge /> : null}
      <div className={cn("flex flex-col gap-1.5", enterpriseOnly && "opacity-40")}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground/70">{label}</span>
          <Icon className="size-3.5 text-muted-foreground/50" />
        </div>
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
        <span className="text-[11px] text-muted-foreground/60">{detail}</span>
      </div>
    </div>
  );
}

function sourceLabel(event: AuditEvent): string {
  if (event.source.kind === "web_server") return "Platform";
  if (event.source.app) return event.source.app;
  return SOURCE_LABEL[event.source.kind];
}

function TableRow({
  event,
  selected,
  onSelect,
}: {
  event: AuditEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const isUser = event.actor.kind === "user";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid w-full grid-cols-[64px_minmax(0,1fr)_220px_180px] items-center gap-4 border-b border-border/30 px-8 py-2.5 text-left transition-colors",
        selected ? "bg-accent" : "hover:bg-accent/40",
      )}
    >
      <span className="font-mono text-[11px] text-muted-foreground/50 tabular-nums">
        {formatTime(event.occurredAt)}
      </span>

      <div className="flex min-w-0 items-center gap-2.5">
        <CategoryGlyph event={event} size="sm" />
        <span className="truncate text-[11px] leading-tight">{event.summary}</span>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        {!isUser && <ActorAvatar event={event} size="sm" />}
        <span className="truncate text-[11px]">
          {event.actor.name}
          {isUser && event.actor.role ? (
            <span className="ml-1 text-muted-foreground/55">({event.actor.role})</span>
          ) : null}
        </span>
      </div>

      <span className="truncate text-[11px] text-muted-foreground/80">{sourceLabel(event)}</span>
    </button>
  );
}

function DetailRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <span className="w-24 shrink-0 text-[11px] text-muted-foreground/60">{label}</span>
      <span className={cn("min-w-0 flex-1 text-xs", mono && "font-mono text-[11px]")}>
        {value}
      </span>
    </div>
  );
}

function DetailGroup({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7">
      <div className="flex items-center gap-2">
        <Icon className="size-3 text-muted-foreground/50" />
        <h3 className="text-xs font-normal text-muted-foreground/70">
          {label}
        </h3>
      </div>
      <div className="mt-2 h-px bg-border/40" />
      <div className="mt-2 flex flex-col">{children}</div>
    </section>
  );
}

function EventDetailPanel({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  return (
    <div
      key={event.id}
      className="relative flex min-w-0 flex-1 flex-col overflow-hidden animate-fade-in-up"
      style={{ animationDuration: "0.18s" }}
    >
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/40">
          <span className="font-mono">{event.id}</span>
          <span className={cn("flex items-center gap-1", outcomeColor(event.outcome))}>
            <span className={cn("size-1.5 rounded-full", outcomeDot(event.outcome))} />
            {event.outcome}
          </span>
          <span>{formatDateTime(event.occurredAt)}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-3.5" />
          Close
          <Kbd className="ml-1">Esc</Kbd>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-6 pb-20">
          <div className="flex items-start gap-4">
            <div
              className="size-12 shrink-0 rounded-full ring-1 ring-border/30"
              style={{ backgroundImage: actorBackground(event.actor.name) }}
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-semibold tracking-tight">{event.summary}</h2>
              <p className="mt-1.5 font-mono text-xs text-muted-foreground/70">{event.eventName}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground/70">
            <span>{CATEGORY_LABELS[event.category]}</span>
            <span className="text-muted-foreground/30">·</span>
            <span>{SOURCE_LABEL[event.source.kind]}</span>
            <span className="text-muted-foreground/30">·</span>
            <span className={trustColor(event.source.trust)}>{TRUST_LABEL[event.source.trust]}</span>
            <span className="text-muted-foreground/30">·</span>
            <span>severity {event.severity}</span>
          </div>

          <DetailGroup icon={ClockIcon} label="Event">
            <DetailRow label="Occurred" value={formatDateTime(event.occurredAt)} />
            <DetailRow label="Name" value={event.eventName} />
            <DetailRow
              label="Target"
              value={`${event.target.type} · ${event.target.name} (${event.target.id})`}
            />
            <DetailRow label="Request" value={event.source.requestId ?? "n/a"} />
            {event.source.runId ? <DetailRow label="Run" value={event.source.runId} /> : null}
            {event.source.app ? <DetailRow label="App" value={event.source.app} mono={false} /> : null}
          </DetailGroup>

          <DetailGroup icon={UsersRoundIcon} label="Actor & source">
            <div className="flex items-center gap-3 py-2">
              <ActorAvatar event={event} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{event.actor.name}</p>
                <p className="text-[11px] text-muted-foreground/70">
                  {event.actor.role ? humanize(event.actor.role) : event.actor.kind}
                  {event.actor.email ? ` · ${event.actor.email}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground/50">{event.actor.team} team</p>
              </div>
            </div>
            <div className="mt-1 h-px bg-border/30" />
            <DetailRow label="Source" value={SOURCE_LABEL[event.source.kind]} mono={false} />
            <DetailRow label="Trust" value={TRUST_LABEL[event.source.trust]} mono={false} />
            <DetailRow label="Actor kind" value={humanize(event.actor.kind)} mono={false} />
          </DetailGroup>

          {event.changedFields?.length ? (
            <DetailGroup icon={FingerprintIcon} label="Changes">
              <div className="flex flex-wrap gap-1.5 py-1">
                {event.changedFields.map((field) => (
                  <span
                    key={field}
                    className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-[11px]"
                  >
                    {field}
                  </span>
                ))}
              </div>
            </DetailGroup>
          ) : null}

          <DetailGroup icon={DatabaseIcon} label="Metadata">
            {event.metadata.map((item) => (
              <DetailRow key={`${item.label}:${item.value}`} label={item.label} value={item.value} />
            ))}
          </DetailGroup>

          {event.category === "app_event" ? (
            <DetailGroup icon={Code2Icon} label="App SDK call">
              <EnterpriseOnlyPreview>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-muted/40 px-3 py-3 font-mono text-[11px] leading-relaxed text-foreground/80">
                  <code>second.audit.track(...)</code>
                </pre>
                <p className="mt-2 text-[11px] text-muted-foreground/60">
                  Stored as <span className={trustColor(event.source.trust)}>{TRUST_LABEL[event.source.trust]}</span>; actor and app are set from server context, not the client payload.
                </p>
              </EnterpriseOnlyPreview>
            </DetailGroup>
          ) : null}

          {event.related?.length ? (
            <DetailGroup icon={ActivityIcon} label="Related events">
              <EnterpriseOnlyPreview>
                <div className="flex flex-col gap-0.5 py-1">
                  {event.related.map((id) => (
                    <button
                      key={id}
                      type="button"
                      disabled
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-left"
                    >
                      <span className="font-mono text-[11px]">{id}</span>
                      <ArrowRightIcon className="size-3 text-muted-foreground/40" />
                    </button>
                  ))}
                </div>
              </EnterpriseOnlyPreview>
            </DetailGroup>
          ) : null}

          <DetailGroup icon={EyeOffIcon} label="Redacted from this record">
            <p className="py-2 text-[11px] leading-relaxed text-muted-foreground/70">
              Tokens, headers, cookies, prompts, full documents, and integration request bodies are
              never written to audit storage. This record stores changed field names and content
              hashes only.
            </p>
          </DetailGroup>
        </div>
      </div>
    </div>
  );
}

function CoverageCard() {
  return (
    <div className="flex flex-col gap-3">
      {COVERAGE.map((item) => (
        <div key={item.label} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium">{item.label}</span>
            <span className="font-mono text-[11px] text-muted-foreground/60 tabular-nums">
              {item.value}%
            </span>
          </div>
          <div className="h-[3px] overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/70 transition-all"
              style={{ width: `${item.value}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground/60">{item.detail}</p>
        </div>
      ))}
    </div>
  );
}

function EvidenceCard({ onExport }: { onExport: () => void }) {
  void onExport;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
        Filter-scoped exports include a manifest with creator, filters, row count, and a SHA-256
        hash. Export creation and download are themselves recorded as audit events.
      </p>
      <div className="flex flex-col">
        <DetailRow label="Format" value="JSONL + CSV + manifest" mono={false} />
        <DetailRow label="Hash" value="sha256:pending" />
        <DetailRow label="Retention" value="365 days default" mono={false} />
        <DetailRow label="Permission" value="audit:export (admin)" mono={false} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <EnterpriseOnlyTooltip>
          <Button variant="outline" size="sm" disabled>
            <DownloadIcon className="size-3" />
            Create export
          </Button>
        </EnterpriseOnlyTooltip>
        <EnterpriseOnlyTooltip>
          <Button variant="outline" size="sm" disabled>
            <FileJsonIcon className="size-3" />
            SIEM export
          </Button>
        </EnterpriseOnlyTooltip>
      </div>
    </div>
  );
}

function RedactionCard() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
        These keys are dropped or hashed before any audit row is written. Generated app SDK calls
        are validated against the same allowlist before storage.
      </p>
      <div className="flex flex-wrap gap-1">
        {REDACTION_KEYS.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground/80"
          >
            <EyeOffIcon className="size-2.5" />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function EventExplanationsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-hidden sm:max-w-[min(1120px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Audit event explanations</DialogTitle>
          <DialogDescription>
            The v1 coverage map: what each audit area records, what it lets admins understand, and
            what is deliberately excluded for security and privacy.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 overflow-hidden rounded-xl border border-border/60">
          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border/60 text-[11px] text-muted-foreground/70">
                  <th className="w-[16%] px-4 py-3 font-medium">Area</th>
                  <th className="w-[22%] px-4 py-3 font-medium">Events</th>
                  <th className="w-[28%] px-4 py-3 font-medium">What viewers can understand</th>
                  <th className="w-[24%] px-4 py-3 font-medium">Not logged</th>
                  <th className="w-[10%] px-4 py-3 font-medium">Scope</th>
                </tr>
              </thead>
              <tbody>
                {AUDIT_EVENT_EXPLANATIONS.map((row) => (
                  <tr
                    key={row.area}
                    className="border-b border-border/40 align-top last:border-b-0 hover:bg-muted/25"
                  >
                    <td className="px-4 py-3 font-medium">{row.area}</td>
                    <td className="px-4 py-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90">
                      {row.events.join(", ")}
                    </td>
                    <td className="px-4 py-3 leading-relaxed text-muted-foreground/90">
                      {row.canAnswer}
                    </td>
                    <td className="px-4 py-3 leading-relaxed text-muted-foreground/90">
                      {row.notLogged}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={row.scope === "OSS v1" ? "secondary" : "outline"}
                        className="whitespace-nowrap"
                      >
                        {row.scope}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
          <EyeOffIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
          <p className="text-[11px] leading-relaxed text-muted-foreground/80">
            Event rows are intentionally metadata-light. Audit records must never store source
            files, prompts, full app documents, full app-data documents, secrets, tokens, cookies,
            request headers, or raw integration responses.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OverviewPanel({
  timeRange,
  onClose,
  onExport,
}: {
  timeRange: "1h" | "24h" | "7d";
  onClose: () => void;
  onExport: () => void;
}) {
  return (
    <div
      className="relative flex min-w-0 flex-1 flex-col overflow-hidden animate-fade-in-up"
      style={{ animationDuration: "0.18s" }}
    >
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="size-3.5 text-muted-foreground/70" />
          <h2 className="text-sm font-semibold">Workspace audit overview</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-3.5" />
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-12">
        <div className="-mt-1">
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            What this audit log captures, what it deliberately leaves out, and how exports are
            generated for evidence workflows.
          </p>
        </div>

        <DetailGroup icon={EyeOffIcon} label="Data redaction">
          <RedactionCard />
        </DetailGroup>

        <DetailGroup icon={ActivityIcon} label="Activity">
          <EnterpriseOnlyPreview>
            <div className="mb-3 flex items-center justify-end">
              <div className="flex items-center gap-0.5 rounded-full bg-muted/40 p-0.5">
                {(["1h", "24h", "7d"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[10px] font-medium",
                      timeRange === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground/60",
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <ActivityChart />
          </EnterpriseOnlyPreview>
        </DetailGroup>

        <DetailGroup icon={ShieldCheckIcon} label="Coverage map">
          <EnterpriseOnlyPreview>
            <CoverageCard />
          </EnterpriseOnlyPreview>
        </DetailGroup>

        <DetailGroup icon={FileJsonIcon} label="Evidence bundle">
          <EnterpriseOnlyPreview>
            <EvidenceCard onExport={onExport} />
          </EnterpriseOnlyPreview>
        </DetailGroup>

        <DetailGroup icon={HelpCircleIcon} label="Questions you can answer">
          <EnterpriseOnlyPreview>
            <div className="flex flex-col gap-0.5 py-1">
              {ENTERPRISE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground/80"
                >
                  <span>{q}</span>
                  <ArrowRightIcon className="size-3 text-muted-foreground/30" />
                </button>
              ))}
            </div>
          </EnterpriseOnlyPreview>
        </DetailGroup>
      </div>
    </div>
  );
}

type RightPanel = "closed" | "overview" | "detail";

export default function AuditLogsRedesigned({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const timeRange = "24h" as const;
  const live = false;
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [summary, setSummary] = useState<AuditEventsSummaryReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [eventExplanationsOpen, setEventExplanationsOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);

  const loadAuditEvents = useCallback(async () => {
    setRefreshing(true);
    setLoadError(null);
    try {
      const [eventsResponse, summaryResponse] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/audit-events?limit=150`, {
          cache: "no-store",
        }),
        fetch(`/api/workspaces/${workspaceId}/audit-events/summary`, {
          cache: "no-store",
        }),
      ]);

      if (!eventsResponse.ok || !summaryResponse.ok) {
        throw new Error(
          eventsResponse.status === 403 || summaryResponse.status === 403
            ? "You need owner or admin access to view workspace audit logs."
            : "Audit logs could not be loaded.",
        );
      }

      const eventsPayload = (await eventsResponse.json()) as {
        items: AuditEvent[];
      };
      const summaryPayload =
        (await summaryResponse.json()) as AuditEventsSummaryReadModel;

      setEvents(eventsPayload.items);
      setSummary(summaryPayload);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Audit logs could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function loadAfterViewAudit() {
      await fetch(`/api/workspaces/${workspaceId}/audit-events/viewed`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {
        // View tracking is explicit but non-critical. Reads remain the source of truth.
      });

      if (!cancelled) {
        await loadAuditEvents();
      }
    }

    void loadAfterViewAudit();

    return () => {
      cancelled = true;
    };
  }, [loadAuditEvents, workspaceId]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => applyFilter(event, filter) && matchesQuery(event, query));
  }, [events, filter, query]);

  const selectedEvent = selectedEventId
    ? events.find((event) => event.id === selectedEventId) ?? null
    : null;

  const rightPanel: RightPanel = selectedEvent
    ? "detail"
    : overviewOpen
      ? "overview"
      : "closed";
  const panelOpen = rightPanel !== "closed";

  const totalEvents = summary?.total ?? events.length;
  const trustedCount =
    summary?.trusted ?? events.filter((e) => e.source.trust !== "client_untrusted").length;
  const deniedCount = summary?.denied ?? events.filter(
    (e) => e.outcome === "denied" || e.outcome === "failure",
  ).length;
  const sdkEventCount =
    summary?.byCategory?.app_event ??
    events.filter((e) => e.category === "app_event").length;

  useEffect(() => {
    if (selectedEventId && !events.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(null);
    }
  }, [events, selectedEventId]);

  useEffect(() => {
    if (!panelOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (selectedEventId) setSelectedEventId(null);
        else setOverviewOpen(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [panelOpen, selectedEventId]);

  return (
    <TooltipProvider>
      <div className="relative flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div
          data-second-desktop-drag-region
          className="flex items-end justify-between gap-4 px-8 pt-7 pb-5"
        >
          <div className="min-w-0">
            <div
              className="flex items-center gap-2 opacity-0 animate-fade-in-up"
              style={{ animationDelay: "60ms" }}
            >
              <h1 className="text-lg font-semibold">Audit logs</h1>
              <Button
                variant={overviewOpen ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setSelectedEventId(null);
                  setOverviewOpen((current) => !current);
                }}
                aria-pressed={overviewOpen}
              >
                {overviewOpen ? (
                  <PanelRightCloseIcon className="size-3" />
                ) : (
                  <PanelRightOpenIcon className="size-3" />
                )}
                Overview
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEventExplanationsOpen(true)}
              >
                <HelpCircleIcon className="size-3" />
                Event explanations
              </Button>
            </div>
            <div
              className="mt-2 flex items-center gap-2 opacity-0 animate-fade-in-up"
              style={{ animationDelay: "100ms" }}
            >
              <StatusPill live={live} />
              <span className="text-[11px] text-muted-foreground/40">·</span>
              <span className="text-[11px] text-muted-foreground/60">
                {loading ? "Loading events" : `${totalEvents} events in the last ${timeRange}`}
              </span>
            </div>
          </div>
          <div
            className="flex shrink-0 items-center gap-2 opacity-0 animate-fade-in-up"
            style={{ animationDelay: "180ms" }}
          >
            <EnterpriseOnlyTooltip>
              <Button variant="outline" size="sm" disabled>
                <PlayIcon className="size-3" />
                Live stream
              </Button>
            </EnterpriseOnlyTooltip>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadAuditEvents()}
              disabled={refreshing}
            >
              <RefreshCwIcon className="size-3" />
              {refreshing ? "Refreshing" : "Refresh"}
              <Kbd className="ml-1">R</Kbd>
            </Button>
            <EnterpriseOnlyTooltip>
              <Button variant="outline" size="sm" disabled>
                <DownloadIcon className="size-3" />
                Export
                <Kbd className="ml-1">E</Kbd>
              </Button>
            </EnterpriseOnlyTooltip>
            <EnterpriseOnlyTooltip>
              <Button variant="outline" size="sm" disabled>
                <FileJsonIcon className="size-3" />
                SIEM export
              </Button>
            </EnterpriseOnlyTooltip>
          </div>
        </div>

        <div
          className="grid gap-3 px-8 pb-5 opacity-0 animate-fade-in-up sm:grid-cols-2 xl:grid-cols-4"
          style={{ animationDelay: "240ms" }}
        >
          <MetricCard
            icon={ActivityIcon}
            label="Last 24 hours"
            value={loading ? "..." : String(totalEvents)}
            detail="events captured"
          />
          <MetricCard
            icon={ShieldCheckIcon}
            label="Trusted events"
            value={`${trustedCount}/${totalEvents}`}
            detail="server or worker sourced"
          />
          <MetricCard
            icon={AlertTriangleIcon}
            label="Denied attempts"
            value={String(deniedCount)}
            detail="permission boundaries hit"
          />
          <MetricCard
            icon={SparklesIcon}
            label="App SDK events"
            value={String(sdkEventCount)}
            detail="business events emitted"
            enterpriseOnly
          />
        </div>

        <div
          className="flex flex-col gap-2.5 px-8 pb-3 opacity-0 animate-fade-in-up"
          style={{ animationDelay: "300ms" }}
        >
          <div className="relative w-full">
            <SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <input
              type="text"
              placeholder="Search actor, app, target, event name..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:ring-1 focus:ring-ring/20"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap">
            {FILTERS.map((entry) => (
              <FilterChip
                key={entry.id}
                active={filter === entry.id}
                onClick={() => setFilter(entry.id)}
              >
                {entry.label}
              </FilterChip>
            ))}
          </div>
        </div>

        <div
          className="grid grid-cols-[64px_minmax(0,1fr)_220px_180px] items-center gap-4 border-y border-border/60 px-8 py-2.5 text-[11px] text-muted-foreground/60 opacity-0 animate-fade-in-up"
          style={{ animationDelay: "360ms" }}
        >
          <span>Time</span>
          <span>Event</span>
          <span>Actor</span>
          <span>Source</span>
        </div>

        <div
          className="flex-1 overflow-y-auto opacity-0 animate-fade-in-up"
          style={{ animationDelay: "360ms" }}
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-24">
              <RefreshCwIcon className="size-6 animate-spin text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground/60">Loading audit events</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center gap-2 py-24">
              <AlertTriangleIcon className="size-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground/70">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadAuditEvents()}
                className="mt-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground/60 hover:bg-muted hover:text-foreground"
              >
                Retry
              </button>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-24">
              <SearchIcon className="size-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground/60">
                {events.length === 0
                  ? "No audit events have been recorded yet"
                  : "No events match the current filters"}
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
                className="mt-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground/60 hover:bg-muted hover:text-foreground"
              >
                Clear filters
              </button>
            </div>
          ) : (
            filteredEvents.map((event) => (
              <TableRow
                key={event.id}
                event={event}
                selected={selectedEventId === event.id}
                onSelect={() => {
                  setOverviewOpen(false);
                  setSelectedEventId(event.id);
                }}
              />
            ))
          )}
          <div className="flex items-center justify-between px-8 py-3 text-[11px] text-muted-foreground/50">
            <span>
              {filteredEvents.length} of {totalEvents} events shown
            </span>
            <span>append-only · workspace scoped · {timeRange} window</span>
          </div>
        </div>
      </div>

      {panelOpen && (
        <>
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => {
              setSelectedEventId(null);
              setOverviewOpen(false);
            }}
            className="absolute inset-0 z-10 bg-foreground/[0.04] animate-in fade-in duration-150"
          />
          <div
            className="absolute inset-y-0 right-0 z-20 flex w-[600px] max-w-[92%] flex-col overflow-hidden border-l border-border bg-background shadow-2xl animate-in slide-in-from-right-10 fade-in duration-200"
          >
            {rightPanel === "detail" && selectedEvent && (
              <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEventId(null)} />
            )}
            {rightPanel === "overview" && (
              <OverviewPanel
                timeRange={timeRange}
                onClose={() => setOverviewOpen(false)}
                onExport={() => setExportOpen(true)}
              />
            )}
          </div>
        </>
      )}

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Export audit evidence</DialogTitle>
            <DialogDescription>
              Filter-scoped export for the visible window. Creates a manifest with row count, filters,
              creator, and a SHA-256 hash.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
              <DetailRow label="Window" value={timeRange} mono={false} />
              <DetailRow
                label="Filter"
                value={FILTERS.find((f) => f.id === filter)?.label ?? "All"}
                mono={false}
              />
              <DetailRow label="Search" value={query.trim() || "—"} mono={false} />
              <DetailRow label="Rows" value={`${filteredEvents.length} visible now`} mono={false} />
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-border/50 px-3 py-3">
              <LockKeyholeIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
              <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                Export creation and download will themselves be recorded as audit events, including
                filters, creator, manifest hash, and row count.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setExportOpen(false)}>
              <DownloadIcon className="size-3.5" />
              Create export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <EventExplanationsDialog
        open={eventExplanationsOpen}
        onOpenChange={setEventExplanationsOpen}
      />
      </div>
    </TooltipProvider>
  );
}

export { AuditLogsRedesigned };
