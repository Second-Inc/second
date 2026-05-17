import type { WorkspaceContext } from "@/lib/auth/guard";
import { insertAuditEvent } from "@/lib/db/repositories/audit-events";
import type {
  AuditActorKind,
  AuditEventCategory,
  AuditEventDocument,
  AuditEventOutcome,
  AuditEventSeverity,
  AuditSourceKind,
  AuditSourceTrust,
  AuditTargetType,
} from "@/lib/db/types";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import {
  hashAuditIdentifier,
  safeChangedFields,
  sanitizeAuditMetadata,
} from "./redaction";

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)+$/;

export type AuditActorInput = {
  kind: AuditActorKind;
  userId?: string;
  displayName?: string;
  email?: string;
  role?: AuditEventDocument["actor"]["role"];
  teamIds?: string[];
  agentId?: string;
  agentName?: string;
  appId?: string;
  appName?: string;
};

export type AuditSourceInput = {
  kind: AuditSourceKind;
  trust: AuditSourceTrust;
  appId?: string;
  appName?: string;
  sourceVersion?: "draft" | "published";
  runId?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  ipHash?: string;
  userAgentHash?: string;
};

export type RecordAuditEventInput = {
  workspaceId: string;
  occurredAt?: Date;
  eventName: string;
  category: AuditEventCategory;
  severity?: AuditEventSeverity;
  outcome: AuditEventOutcome;
  actor: AuditActorInput;
  source: AuditSourceInput;
  target: {
    type: AuditTargetType;
    id?: string;
    name?: string;
    parentType?: string;
    parentId?: string;
  };
  action: string;
  summary: string;
  metadata?: Record<string, unknown>;
  changes?: {
    changedFields?: unknown;
    beforeHash?: string;
    afterHash?: string;
    redactedFields?: string[];
  };
  correlationId?: string;
  relatedIds?: AuditEventDocument["relatedIds"];
  retention?: Partial<AuditEventDocument["retention"]>;
};

function cleanText(value: string | undefined, maxLength = 280): string | undefined {
  const trimmed = value
    ?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function assertValidAuditInput(input: RecordAuditEventInput): void {
  if (!input.workspaceId.trim()) {
    throw new Error("[audit] workspaceId is required.");
  }
  if (!EVENT_NAME_PATTERN.test(input.eventName)) {
    throw new Error(`[audit] Invalid event name: ${input.eventName}`);
  }
  if (!input.action.trim()) {
    throw new Error("[audit] action is required.");
  }
  if (!input.summary.trim()) {
    throw new Error("[audit] summary is required.");
  }
}

export function auditActorFromWorkspaceContext(
  workspaceContext: WorkspaceContext,
): AuditActorInput {
  return {
    kind: "user",
    userId: workspaceContext.user._id,
    displayName: workspaceContext.user.displayName,
    email: workspaceContext.user.email,
    role: workspaceContext.membership.role,
  };
}

export function auditSourceFromRequest(
  request: Request,
  input: Partial<AuditSourceInput> = {},
): AuditSourceInput {
  const requestId =
    cleanText(request.headers.get("x-request-id") ?? undefined, 120) ??
    cleanText(request.headers.get("x-vercel-id") ?? undefined, 120);
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0];
  const userAgent = request.headers.get("user-agent");

  return {
    kind: input.kind ?? "web_server",
    trust: input.trust ?? "server_trusted",
    ...input,
    requestId: input.requestId ?? requestId,
    ipHash: input.ipHash ?? hashAuditIdentifier(forwardedFor),
    userAgentHash: input.userAgentHash ?? hashAuditIdentifier(userAgent),
  };
}

function buildAuditEventDocument(
  input: RecordAuditEventInput,
): Omit<AuditEventDocument, "_id"> {
  assertValidAuditInput(input);

  const now = new Date();
  const sanitizedMetadata = sanitizeAuditMetadata(input.metadata);
  const changedFields = safeChangedFields(input.changes?.changedFields);
  const changes =
    changedFields.length > 0 ||
    input.changes?.beforeHash ||
    input.changes?.afterHash ||
    input.changes?.redactedFields?.length
      ? {
          changedFields,
          beforeHash: cleanText(input.changes?.beforeHash, 96),
          afterHash: cleanText(input.changes?.afterHash, 96),
          redactedFields: [
            ...new Set([
              ...sanitizedMetadata.redactedFields,
              ...(input.changes?.redactedFields ?? []),
            ]),
          ].slice(0, 100),
        }
      : undefined;

  return {
    workspaceId: input.workspaceId,
    schemaVersion: 1,
    occurredAt: input.occurredAt ?? now,
    observedAt: now,
    eventName: input.eventName,
    category: input.category,
    severity: input.severity ?? "info",
    outcome: input.outcome,
    actor: {
      ...input.actor,
      displayName: cleanText(input.actor.displayName, 160),
      email: cleanText(input.actor.email, 160),
      agentName: cleanText(input.actor.agentName, 160),
      appName: cleanText(input.actor.appName, 160),
    },
    source: {
      ...input.source,
      appName: cleanText(input.source.appName, 160),
      requestId: cleanText(input.source.requestId, 160),
      traceId: cleanText(input.source.traceId, 160),
      spanId: cleanText(input.source.spanId, 160),
    },
    target: {
      ...input.target,
      id: cleanText(input.target.id, 160),
      name: cleanText(input.target.name, 200),
      parentType: cleanText(input.target.parentType, 80),
      parentId: cleanText(input.target.parentId, 160),
    },
    action: cleanText(input.action, 120) ?? input.action,
    summary: cleanText(input.summary, 500) ?? input.summary,
    metadata: {
      ...sanitizedMetadata.value,
      ...(sanitizedMetadata.truncated ? { _truncated: true } : {}),
    },
    changes,
    correlationId: cleanText(input.correlationId, 160),
    relatedIds: input.relatedIds,
    retention: {
      policy: input.retention?.policy ?? "default",
      expiresAt: input.retention?.expiresAt ?? null,
      legalHold: input.retention?.legalHold ?? false,
    },
    createdAt: now,
  };
}

export async function recordAuditEventRequired(
  input: RecordAuditEventInput,
): Promise<AuditEventDocument> {
  const event = await insertAuditEvent(buildAuditEventDocument(input));
  publishWorkspaceEvent({
    type: "audit.changed",
    workspaceId: event.workspaceId,
    scope: "audit-events",
  });
  return event;
}

export async function recordAuditEvent(
  input: RecordAuditEventInput,
): Promise<AuditEventDocument | null> {
  try {
    return await recordAuditEventRequired(input);
  } catch (error) {
    console.warn("[audit] Failed to record audit event", {
      eventName: input.eventName,
      workspaceId: input.workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function recordAccessDeniedAuditEvent(input: {
  request: Request;
  workspaceContext: WorkspaceContext;
  permission: string;
  action: string;
  summary: string;
  target?: RecordAuditEventInput["target"];
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await recordAuditEvent({
    workspaceId: input.workspaceContext.workspaceId,
    eventName: "access.denied",
    category: "access",
    severity: "warning",
    outcome: "denied",
    actor: auditActorFromWorkspaceContext(input.workspaceContext),
    source: auditSourceFromRequest(input.request),
    target: input.target ?? {
      type: "workspace",
      id: input.workspaceContext.workspaceId,
      name: "Workspace",
    },
    action: input.action,
    summary: input.summary,
    metadata: {
      permission: input.permission,
      route: new URL(input.request.url).pathname,
      httpStatus: 403,
      ...input.metadata,
    },
    retention: { policy: "security" },
  });
}

