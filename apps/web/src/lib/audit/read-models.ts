import type { AuditEventDocument } from "@/lib/db/types";

export type AuditEventListItem = {
  id: string;
  occurredAt: string;
  eventName: string;
  category: AuditEventDocument["category"];
  outcome: AuditEventDocument["outcome"];
  severity: AuditEventDocument["severity"];
  actor: {
    kind: AuditEventDocument["actor"]["kind"];
    name: string;
    email?: string;
    role?: string;
    team: string;
  };
  source: {
    kind: AuditEventDocument["source"]["kind"];
    trust: AuditEventDocument["source"]["trust"];
    app?: string;
    appId?: string;
    runId?: string;
    requestId?: string;
  };
  target: {
    type: string;
    id: string;
    name: string;
  };
  summary: string;
  metadata: Array<{ label: string; value: string }>;
  changedFields?: string[];
  related?: string[];
};

export type AuditEventsSummaryReadModel = {
  window: "24h";
  total: number;
  trusted: number;
  denied: number;
  byCategory: Record<string, number>;
  byOutcome: Record<string, number>;
};

function humanizeKey(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll(".", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
          ? String(item)
          : JSON.stringify(item),
      )
      .join(", ");
  }
  return JSON.stringify(value);
}

function eventActorName(event: AuditEventDocument): string {
  return (
    event.actor.displayName ??
    event.actor.agentName ??
    event.actor.appName ??
    event.actor.email ??
    event.actor.userId ??
    event.actor.agentId ??
    "System"
  );
}

function eventTargetName(event: AuditEventDocument): string {
  return event.target.name ?? event.target.id ?? humanizeKey(event.target.type);
}

export function toAuditEventListItem(
  event: AuditEventDocument,
): AuditEventListItem {
  const metadata = Object.entries(event.metadata ?? {})
    .slice(0, 24)
    .map(([label, value]) => ({
      label: humanizeKey(label),
      value: formatMetadataValue(value),
    }));

  return {
    id: event._id,
    occurredAt: event.occurredAt.toISOString(),
    eventName: event.eventName,
    category: event.category,
    outcome: event.outcome,
    severity: event.severity,
    actor: {
      kind: event.actor.kind,
      name: eventActorName(event),
      email: event.actor.email,
      role: event.actor.role ?? event.actor.kind,
      team: event.actor.teamIds?.length ? `${event.actor.teamIds.length} teams` : "Workspace",
    },
    source: {
      kind: event.source.kind,
      trust: event.source.trust,
      app: event.source.appName,
      appId: event.source.appId,
      runId: event.source.runId ?? event.relatedIds?.runId,
      requestId: event.source.requestId,
    },
    target: {
      type: event.target.type,
      id: event.target.id ?? "",
      name: eventTargetName(event),
    },
    summary: event.summary,
    metadata,
    changedFields: event.changes?.changedFields,
    related: [
      event.relatedIds?.runId,
      event.relatedIds?.reviewRequestId,
      event.relatedIds?.integrationId,
      event.relatedIds?.agentRunId,
      event.relatedIds?.appDataDocumentId,
    ].filter((value): value is string => Boolean(value)),
  };
}

