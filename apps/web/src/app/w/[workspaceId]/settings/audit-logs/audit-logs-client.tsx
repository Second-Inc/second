"use client";

import { useMemo, useState } from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  AppWindowIcon,
  BotIcon,
  CheckCircle2Icon,
  ClockIcon,
  Code2Icon,
  DatabaseIcon,
  DownloadIcon,
  EyeIcon,
  FileJsonIcon,
  FingerprintIcon,
  KeyRoundIcon,
  ListFilterIcon,
  LockKeyholeIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  UserRoundIcon,
  UsersRoundIcon,
  WrenchIcon,
  XCircleIcon,
  type LucideIcon,
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
import { Input } from "@/components/ui/input";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type AuditCategory =
  | "access"
  | "members"
  | "apps"
  | "integrations"
  | "agents"
  | "tools"
  | "app_data"
  | "app_event"
  | "audit";

type AuditOutcome = "success" | "denied" | "failure" | "started";
type AuditSeverity = "info" | "notice" | "warning" | "critical";
type AuditTrust = "server_trusted" | "internal_trusted" | "client_untrusted";
type AuditSource =
  | "web_server"
  | "worker"
  | "app_iframe"
  | "app_agent"
  | "builder_agent";

type AuditEvent = {
  id: string;
  occurredAt: string;
  eventName: string;
  category: AuditCategory;
  outcome: AuditOutcome;
  severity: AuditSeverity;
  actor: {
    name: string;
    email?: string;
    role?: string;
    team: string;
    kind: "user" | "agent" | "system";
  };
  source: {
    kind: AuditSource;
    trust: AuditTrust;
    app?: string;
    runId?: string;
    requestId: string;
  };
  target: {
    type: string;
    name: string;
    id: string;
  };
  summary: string;
  metadata: Array<{ label: string; value: string }>;
  changedFields?: string[];
  related?: string[];
  sdkPayload?: string;
};

const CATEGORY_LABELS: Record<AuditCategory, string> = {
  access: "Access",
  members: "Members",
  apps: "Apps",
  integrations: "Integrations",
  agents: "Agents",
  tools: "Tools",
  app_data: "Data",
  app_event: "App events",
  audit: "Audit",
};

const CATEGORY_ICONS: Record<AuditCategory, LucideIcon> = {
  access: LockKeyholeIcon,
  members: UsersRoundIcon,
  apps: AppWindowIcon,
  integrations: KeyRoundIcon,
  agents: BotIcon,
  tools: WrenchIcon,
  app_data: DatabaseIcon,
  app_event: SparklesIcon,
  audit: ShieldCheckIcon,
};

const SEVERITY_ICONS: Record<AuditSeverity, LucideIcon> = {
  info: CheckCircle2Icon,
  notice: CheckCircle2Icon,
  warning: AlertTriangleIcon,
  critical: XCircleIcon,
};

const MOCK_EVENTS: AuditEvent[] = [
  {
    id: "aud_01JZ9K0M52F4",
    occurredAt: "2026-04-26T09:42:18+03:00",
    eventName: "integration.secret_rotated",
    category: "integrations",
    outcome: "success",
    severity: "notice",
    actor: {
      name: "Maya Patel",
      email: "maya@acme.internal",
      role: "admin",
      team: "Platform",
      kind: "user",
    },
    source: {
      kind: "web_server",
      trust: "server_trusted",
      requestId: "req_a8f2",
    },
    target: {
      type: "integration",
      name: "Slack",
      id: "int_slack",
    },
    summary: "Rotated saved Slack bot token and marked requested scopes as configured.",
    metadata: [
      { label: "Domain", value: "slack.com" },
      { label: "Configured scopes", value: "chat:write, users:read" },
      { label: "Secrets", value: "SLACK_BOT_TOKEN saved" },
    ],
    changedFields: ["configuredSecrets", "configuredPermissionGroups"],
    related: ["aud_01JZ9JYPR8T1", "aud_01JZ9K1HMBCC"],
  },
  {
    id: "aud_01JZ9JYPR8T1",
    occurredAt: "2026-04-26T09:39:02+03:00",
    eventName: "tool.custom.executed",
    category: "tools",
    outcome: "success",
    severity: "info",
    actor: {
      name: "Incident Briefing Agent",
      role: "approved app agent",
      team: "Engineering",
      kind: "agent",
    },
    source: {
      kind: "app_agent",
      trust: "internal_trusted",
      app: "24h Slack Summary",
      runId: "app_run_71be",
      requestId: "req_f133",
    },
    target: {
      type: "custom tool",
      name: "Slack / chat.postMessage",
      id: "tool_slack_post",
    },
    summary: "Posted an incident summary through an approved Slack custom tool.",
    metadata: [
      { label: "Integration", value: "Slack" },
      { label: "Domain", value: "slack.com" },
      { label: "Mode", value: "Live API" },
      { label: "HTTP", value: "200 OK" },
    ],
    related: ["aud_01JZ9K0M52F4"],
  },
  {
    id: "aud_01JZ9HSK4TT8",
    occurredAt: "2026-04-26T09:27:44+03:00",
    eventName: "app_data.document.updated",
    category: "app_data",
    outcome: "success",
    severity: "notice",
    actor: {
      name: "Revenue Ops Agent",
      role: "approved app agent",
      team: "Revenue",
      kind: "agent",
    },
    source: {
      kind: "app_agent",
      trust: "internal_trusted",
      app: "Lead Enrichment",
      runId: "app_run_6d03",
      requestId: "req_98b5",
    },
    target: {
      type: "app_data_document",
      name: "leads / lead_402",
      id: "lead_402",
    },
    summary: "Updated a lead after enrichment completed.",
    metadata: [
      { label: "Collection", value: "leads" },
      { label: "Data scope", value: "published" },
      { label: "Before hash", value: "sha256:91f2...aa0d" },
      { label: "After hash", value: "sha256:22c0...7d19" },
    ],
    changedFields: ["status", "ownerId", "lastEnrichedAt"],
  },
  {
    id: "aud_01JZ9GNAV020",
    occurredAt: "2026-04-26T09:12:13+03:00",
    eventName: "app_event.recorded",
    category: "app_event",
    outcome: "success",
    severity: "info",
    actor: {
      name: "Daniella Cohen",
      email: "daniella@acme.internal",
      role: "member",
      team: "Finance",
      kind: "user",
    },
    source: {
      kind: "app_iframe",
      trust: "client_untrusted",
      app: "Expense approvals",
      requestId: "req_40fb",
    },
    target: {
      type: "app_event",
      name: "expense.policy_exception",
      id: "evt_expense_policy_exception",
    },
    summary: "Generated app recorded a policy exception event for an expense approval.",
    metadata: [
      { label: "App target", value: "expense / exp_7782" },
      { label: "Amount band", value: "1000-5000" },
      { label: "Department", value: "Finance" },
      { label: "Trust", value: "Client untrusted" },
    ],
    sdkPayload:
      'audit.track("expense.policy_exception", { target: { type: "expense", id: expenseId }, metadata: { amountBand: "1000-5000" } })',
  },
  {
    id: "aud_01JZ9G9H7V99",
    occurredAt: "2026-04-26T09:06:51+03:00",
    eventName: "access.denied",
    category: "access",
    outcome: "denied",
    severity: "warning",
    actor: {
      name: "Leo Martin",
      email: "leo@acme.internal",
      role: "member",
      team: "Sales",
      kind: "user",
    },
    source: {
      kind: "web_server",
      trust: "server_trusted",
      requestId: "req_69aa",
    },
    target: {
      type: "integration",
      name: "HubSpot",
      id: "int_hubspot",
    },
    summary: "Blocked integration settings change by a member without admin access.",
    metadata: [
      { label: "Permission", value: "integrations:manage" },
      { label: "HTTP", value: "403" },
      { label: "Route", value: "/settings/integrations" },
    ],
  },
  {
    id: "aud_01JZ9EVS5M13",
    occurredAt: "2026-04-26T08:48:20+03:00",
    eventName: "app.agents_config.approved",
    category: "agents",
    outcome: "success",
    severity: "notice",
    actor: {
      name: "Maya Patel",
      email: "maya@acme.internal",
      role: "admin",
      team: "Platform",
      kind: "user",
    },
    source: {
      kind: "web_server",
      trust: "server_trusted",
      app: "Lead Enrichment",
      requestId: "req_6c2f",
    },
    target: {
      type: "agents.json",
      name: "Lead Enrichment agents.json",
      id: "agents_hash_7b91",
    },
    summary: "Approved app-agent runtime policy for exact agents.json hash.",
    metadata: [
      { label: "Agents", value: "Lead Enricher, CRM Sync" },
      { label: "Data collections", value: "leads" },
      { label: "Approved hash", value: "sha256:7b91...f3c2" },
    ],
    changedFields: ["agentsJsonApprovalHash", "agentsJsonApprovedPayload"],
  },
  {
    id: "aud_01JZ9DAHENK2",
    occurredAt: "2026-04-26T08:20:08+03:00",
    eventName: "app.published",
    category: "apps",
    outcome: "success",
    severity: "notice",
    actor: {
      name: "Jordan Lee",
      email: "jordan@acme.internal",
      role: "owner",
      team: "General",
      kind: "user",
    },
    source: {
      kind: "web_server",
      trust: "server_trusted",
      app: "Quarter Planning",
      requestId: "req_e719",
    },
    target: {
      type: "app",
      name: "Quarter Planning",
      id: "app_quarter_planning",
    },
    summary: "Published app to Finance and Leadership teams after review.",
    metadata: [
      { label: "Teams", value: "Finance, Leadership" },
      { label: "Snapshot", value: "sha256:b241...390e" },
      { label: "Review", value: "approved" },
    ],
    changedFields: ["publishStatus", "publishedSnapshotId", "teamIds"],
  },
  {
    id: "aud_01JZ9CZ72T67",
    occurredAt: "2026-04-26T08:13:55+03:00",
    eventName: "member.team_added",
    category: "members",
    outcome: "success",
    severity: "info",
    actor: {
      name: "Jordan Lee",
      email: "jordan@acme.internal",
      role: "owner",
      team: "General",
      kind: "user",
    },
    source: {
      kind: "web_server",
      trust: "server_trusted",
      requestId: "req_1ad5",
    },
    target: {
      type: "member",
      name: "Daniella Cohen",
      id: "usr_daniella",
    },
    summary: "Added member to Finance team.",
    metadata: [
      { label: "Team", value: "Finance" },
      { label: "Role", value: "member" },
    ],
    changedFields: ["teamIds"],
  },
  {
    id: "aud_01JZ9BWR90FC",
    occurredAt: "2026-04-26T07:58:31+03:00",
    eventName: "app_event.rejected",
    category: "app_event",
    outcome: "failure",
    severity: "warning",
    actor: {
      name: "Expense approvals",
      role: "generated app",
      team: "Finance",
      kind: "system",
    },
    source: {
      kind: "app_iframe",
      trust: "client_untrusted",
      app: "Expense approvals",
      requestId: "req_dca3",
    },
    target: {
      type: "app_event",
      name: "expense.export_attempted",
      id: "evt_rejected_export",
    },
    summary: "Blocked unsafe generated-app audit payload before storage.",
    metadata: [
      { label: "Reason", value: "Sensitive metadata key: authorization" },
      { label: "Limit", value: "metadata keys allowlist" },
      { label: "HTTP", value: "400" },
    ],
  },
  {
    id: "aud_01JZ9AG8N4B5",
    occurredAt: "2026-04-26T07:21:09+03:00",
    eventName: "audit.export_requested",
    category: "audit",
    outcome: "started",
    severity: "notice",
    actor: {
      name: "Nora Levin",
      email: "nora@acme.internal",
      role: "admin",
      team: "Leadership",
      kind: "user",
    },
    source: {
      kind: "web_server",
      trust: "server_trusted",
      requestId: "req_4fd1",
    },
    target: {
      type: "audit_export",
      name: "Last 24 hours evidence bundle",
      id: "export_24h",
    },
    summary: "Requested JSONL export for governance and data-change events.",
    metadata: [
      { label: "Format", value: "JSONL + manifest" },
      { label: "Window", value: "Last 24 hours" },
      { label: "Rows", value: "1,842 estimated" },
    ],
  },
];

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

const CATEGORY_OPTIONS: Array<{ value: AuditCategory | "all"; label: string }> = [
  { value: "all", label: "All categories" },
  { value: "access", label: "Access" },
  { value: "integrations", label: "Integrations" },
  { value: "agents", label: "Agents" },
  { value: "tools", label: "Tools" },
  { value: "app_data", label: "Data" },
  { value: "app_event", label: "App events" },
];

const OUTCOME_OPTIONS: Array<{ value: AuditOutcome | "all"; label: string }> = [
  { value: "all", label: "All outcomes" },
  { value: "success", label: "Success" },
  { value: "denied", label: "Denied" },
  { value: "failure", label: "Failure" },
  { value: "started", label: "Started" },
];

const SOURCE_OPTIONS: Array<{ value: AuditSource | "all"; label: string }> = [
  { value: "all", label: "All sources" },
  { value: "web_server", label: "Platform" },
  { value: "app_agent", label: "App agents" },
  { value: "app_iframe", label: "Generated apps" },
  { value: "worker", label: "Worker" },
  { value: "builder_agent", label: "Builder" },
];

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
  if (value === "server_trusted") return "Server";
  return value.replaceAll("_", " ");
}

function outcomeVariant(outcome: AuditOutcome): "default" | "secondary" | "outline" | "destructive" {
  if (outcome === "denied" || outcome === "failure") return "destructive";
  if (outcome === "success") return "secondary";
  return "outline";
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
    event.source.app,
    event.target.name,
    event.target.id,
    ...event.metadata.map((item) => `${item.label} ${item.value}`),
  ]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(normalized));
}

function MetricPanel({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-background px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        <span className="pb-1 text-right text-[11px] leading-tight text-muted-foreground">
          {detail}
        </span>
      </div>
    </div>
  );
}

function ActivityChart() {
  return (
    <div className="flex h-28 items-end gap-2 rounded-xl border border-border bg-background px-4 py-3">
      {ACTIVITY_POINTS.map((point) => (
        <div key={point.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <div className="flex h-20 w-full items-end">
            <div
              className="w-full rounded-t-sm bg-primary/65"
              style={{ height: `${point.value}%` }}
            />
          </div>
          <span className="font-mono text-[10px] text-muted-foreground/70">
            {point.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function CoverageMap() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Coverage map</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Mocked readiness by audit source.
          </p>
        </div>
        <Badge variant="outline">Plan target</Badge>
      </div>
      <div className="flex flex-col gap-3">
        {COVERAGE.map((item) => (
          <div key={item.label} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium">{item.label}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {item.value}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${item.value}%` }}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {item.detail}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventRow({
  event,
  selected,
  onSelect,
}: {
  event: AuditEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const CategoryIcon = CATEGORY_ICONS[event.category];
  const SeverityIcon = SEVERITY_ICONS[event.severity];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors",
        selected ? "bg-muted" : "hover:bg-muted/60",
      )}
    >
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
        <CategoryIcon className="size-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{event.summary}</span>
          <Badge variant={outcomeVariant(event.outcome)}>{event.outcome}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{formatTime(event.occurredAt)}</span>
          <span className="font-mono text-[11px]">{event.eventName}</span>
          <span>{event.actor.name}</span>
          {event.source.app ? <span>{event.source.app}</span> : null}
        </div>
      </div>
      <SeverityIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground/70" />
    </button>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate text-right font-mono text-[11px]">
        {value}
      </span>
    </div>
  );
}

function EventInspector({ event }: { event: AuditEvent }) {
  const CategoryIcon = CATEGORY_ICONS[event.category];

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-border bg-background">
      <div className="flex items-start gap-3 border-b border-border px-4 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30">
          <CategoryIcon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{CATEGORY_LABELS[event.category]}</h2>
            <Badge variant={outcomeVariant(event.outcome)}>{event.outcome}</Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {event.summary}
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <ClockIcon className="size-3.5 text-muted-foreground" />
            Event
          </div>
          <div className="grid gap-2">
            <DetailItem label="Occurred" value={formatDateTime(event.occurredAt)} />
            <DetailItem label="Name" value={event.eventName} />
            <DetailItem label="Target" value={`${event.target.type}:${event.target.id}`} />
            <DetailItem label="Request" value={event.source.requestId} />
            {event.source.runId ? (
              <DetailItem label="Run" value={event.source.runId} />
            ) : null}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <UserRoundIcon className="size-3.5 text-muted-foreground" />
            Actor and source
          </div>
          <div className="grid gap-2">
            <DetailItem label="Actor" value={event.actor.name} />
            <DetailItem label="Team" value={event.actor.team} />
            <DetailItem label="Role" value={event.actor.role ?? event.actor.kind} />
            <DetailItem label="Source" value={humanize(event.source.kind)} />
            <DetailItem label="Trust" value={humanize(event.source.trust)} />
          </div>
        </section>

        {event.changedFields?.length ? (
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              <FingerprintIcon className="size-3.5 text-muted-foreground" />
              Change summary
            </div>
            <div className="flex flex-wrap gap-1.5">
              {event.changedFields.map((field) => (
                <Badge key={field} variant="outline" className="font-mono">
                  {field}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <ListFilterIcon className="size-3.5 text-muted-foreground" />
            Metadata
          </div>
          <div className="grid gap-2">
            {event.metadata.map((item) => (
              <DetailItem key={`${item.label}:${item.value}`} {...item} />
            ))}
          </div>
        </section>

        {event.sdkPayload ? (
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Code2Icon className="size-3.5 text-muted-foreground" />
              App SDK event
            </div>
            <pre className="overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
              <code>{event.sdkPayload}</code>
            </pre>
          </section>
        ) : null}

        {event.related?.length ? (
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              <ActivityIcon className="size-3.5 text-muted-foreground" />
              Related events
            </div>
            <div className="flex flex-wrap gap-1.5">
              {event.related.map((id) => (
                <Badge key={id} variant="secondary" className="font-mono">
                  {id}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function FilterButton({
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
        "rounded-full border px-3 py-1.5 text-xs transition-colors",
        active
          ? "border-foreground/30 bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export default function AuditLogsClient({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState("");
  const [timeRange, setTimeRange] = useState("24h");
  const [category, setCategory] = useState<AuditCategory | "all">("all");
  const [outcome, setOutcome] = useState<AuditOutcome | "all">("all");
  const [source, setSource] = useState<AuditSource | "all">("all");
  const [live, setLive] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState(MOCK_EVENTS[0]?.id ?? "");

  const filteredEvents = useMemo(() => {
    return MOCK_EVENTS.filter((event) => {
      if (category !== "all" && event.category !== category) return false;
      if (outcome !== "all" && event.outcome !== outcome) return false;
      if (source !== "all" && event.source.kind !== source) return false;
      return matchesQuery(event, query);
    });
  }, [category, outcome, query, source]);

  const selectedEvent =
    filteredEvents.find((event) => event.id === selectedEventId) ??
    filteredEvents[0] ??
    MOCK_EVENTS[0];

  const deniedCount = MOCK_EVENTS.filter((event) => event.outcome === "denied").length;
  const appEventCount = MOCK_EVENTS.filter((event) => event.category === "app_event").length;
  const trustedCount = MOCK_EVENTS.filter(
    (event) => event.source.trust !== "client_untrusted",
  ).length;

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {workspaceId.slice(0, 8)}
                </Badge>
                <Badge variant={live ? "secondary" : "outline"} className="gap-1">
                  <ActivityIcon data-icon="inline-start" />
                  {live ? "Streaming" : "Paused"}
                </Badge>
              </div>
              <h1 className="text-lg font-semibold">Audit logs</h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Workspace activity, generated app events, agent/tool runtime,
                and data changes in one searchable trail.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={live ? "outline" : "default"}
                size="sm"
                onClick={() => setLive((current) => !current)}
                aria-pressed={live}
              >
                {live ? (
                  <PauseIcon data-icon="inline-start" />
                ) : (
                  <PlayIcon data-icon="inline-start" />
                )}
                {live ? "Pause" : "Resume"}
              </Button>
              <Button variant="outline" size="sm">
                <RefreshCwIcon data-icon="inline-start" />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                <DownloadIcon data-icon="inline-start" />
                Export
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterButton
              active={category === "all" && outcome === "all"}
              onClick={() => {
                setCategory("all");
                setOutcome("all");
                setSource("all");
              }}
            >
              Last 24h
            </FilterButton>
            <FilterButton
              active={category === "app_data"}
              onClick={() => {
                setCategory("app_data");
                setOutcome("all");
                setSource("all");
              }}
            >
              Data writes
            </FilterButton>
            <FilterButton
              active={category === "agents" || category === "tools"}
              onClick={() => {
                setCategory("tools");
                setOutcome("all");
                setSource("app_agent");
              }}
            >
              Agent activity
            </FilterButton>
            <FilterButton
              active={outcome === "denied"}
              onClick={() => {
                setOutcome("denied");
                setCategory("all");
                setSource("all");
              }}
            >
              Denied access
            </FilterButton>
            <FilterButton
              active={category === "app_event"}
              onClick={() => {
                setCategory("app_event");
                setOutcome("all");
                setSource("app_iframe");
              }}
            >
              Generated app events
            </FilterButton>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricPanel
            icon={ActivityIcon}
            label="Last 24 hours"
            value="1,842"
            detail="mock events captured"
          />
          <MetricPanel
            icon={ShieldCheckIcon}
            label="Trusted events"
            value={`${trustedCount}/${MOCK_EVENTS.length}`}
            detail="server or worker sourced"
          />
          <MetricPanel
            icon={AlertTriangleIcon}
            label="Denied attempts"
            value={String(deniedCount)}
            detail="permission boundaries hit"
          />
          <MetricPanel
            icon={SparklesIcon}
            label="App SDK events"
            value={String(appEventCount)}
            detail="business events emitted"
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium">Activity by hour</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Bounded mock rollup for the selected window.
                </p>
              </div>
              <ToggleGroup
                type="single"
                value={timeRange}
                onValueChange={(value) => value && setTimeRange(value)}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="1h">1h</ToggleGroupItem>
                <ToggleGroupItem value="24h">24h</ToggleGroupItem>
                <ToggleGroupItem value="7d">7d</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <ActivityChart />
          </div>
          <CoverageMap />
        </section>

        <section className="grid min-h-[620px] gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex min-w-0 flex-col rounded-xl border border-border bg-background">
            <div className="flex flex-col gap-3 border-b border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium">Event stream</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {filteredEvents.length} matching events in this mock window.
                  </p>
                </div>
                <Badge variant="outline" className="gap-1">
                  <EyeIcon data-icon="inline-start" />
                  Details audited
                </Badge>
              </div>

              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search actor, app, target, event name..."
                    className="pl-9"
                  />
                </div>

                <select
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as AuditCategory | "all")
                  }
                  className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                  aria-label="Category"
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <select
                  value={outcome}
                  onChange={(event) =>
                    setOutcome(event.target.value as AuditOutcome | "all")
                  }
                  className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                  aria-label="Outcome"
                >
                  {OUTCOME_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <select
                  value={source}
                  onChange={(event) =>
                    setSource(event.target.value as AuditSource | "all")
                  }
                  className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                  aria-label="Source"
                >
                  {SOURCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-2">
              {filteredEvents.length > 0 ? (
                filteredEvents.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    selected={selectedEvent.id === event.id}
                    onSelect={() => setSelectedEventId(event.id)}
                  />
                ))
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
                  <SlidersHorizontalIcon className="size-8 text-muted-foreground/40" />
                  <div>
                    <p className="text-sm font-medium">No matching events</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Adjust filters or refresh the selected window.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <EventInspector event={selectedEvent} />
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background px-4 py-4">
            <div className="flex items-center gap-2">
              <ShieldCheckIcon className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">Enterprise questions</h2>
            </div>
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                What changed in the last 24 hours?
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                Which agents used live integrations?
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                Which app events came from untrusted clients?
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background px-4 py-4">
            <div className="flex items-center gap-2">
              <FileJsonIcon className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">Evidence bundle</h2>
            </div>
            <div className="grid gap-2">
              <DetailItem label="Format" value="JSONL + CSV + manifest" />
              <DetailItem label="Hash" value="sha256:pending" />
              <DetailItem label="Retention" value="365 days default" />
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background px-4 py-4">
            <div className="flex items-center gap-2">
              <DatabaseIcon className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">Data redaction</h2>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["tokens", "cookies", "headers", "prompts", "sourceFiles", "full documents"].map(
                (item) => (
                  <Badge key={item} variant="outline">
                    {item}
                  </Badge>
                ),
              )}
            </div>
          </div>
        </section>
      </div>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Export audit evidence</DialogTitle>
            <DialogDescription>
              Mock export for the current filters and selected time window.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="grid gap-2 rounded-xl border border-border bg-muted/20 p-3">
              <DetailItem label="Window" value={timeRange} />
              <DetailItem label="Category" value={category} />
              <DetailItem label="Outcome" value={outcome} />
              <DetailItem label="Rows" value={`${filteredEvents.length} visible now`} />
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-border bg-background px-3 py-3">
              <LockKeyholeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Export creation and download will be recorded as audit events,
                including filters, creator, manifest hash, and row count.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setExportOpen(false)}>
              <DownloadIcon data-icon="inline-start" />
              Create export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
