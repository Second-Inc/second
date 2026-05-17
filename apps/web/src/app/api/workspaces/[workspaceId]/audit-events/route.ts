import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import { toAuditEventListItem } from "@/lib/audit/read-models";
import { listAuditEvents } from "@/lib/db";
import type {
  AuditEventCategory,
  AuditEventOutcome,
  AuditTargetType,
} from "@/lib/db/types";

type AuditEventsRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

const CATEGORIES: ReadonlySet<AuditEventCategory> = new Set([
  "auth",
  "access",
  "members",
  "teams",
  "apps",
  "reviews",
  "integrations",
  "agents",
  "tools",
  "app_data",
  "app_event",
  "audit",
  "library",
  "system",
]);

const OUTCOMES: ReadonlySet<AuditEventOutcome> = new Set([
  "success",
  "failure",
  "denied",
  "started",
  "completed",
]);

const TARGET_TYPES: ReadonlySet<AuditTargetType> = new Set([
  "workspace",
  "member",
  "team",
  "invitation",
  "app",
  "review",
  "integration",
  "agent",
  "run",
  "source_snapshot",
  "tool",
  "app_data_document",
  "app_event",
  "audit_export",
]);

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(
  request: Request,
  context: AuditEventsRouteContext,
) {
  const { workspaceId } = await context.params;

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  if (!hasWorkspacePermission(workspaceContext.membership, "audit:read")) {
    return NextResponse.json({ error: "audit_logs_forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const rawCategory = url.searchParams.get("category") as AuditEventCategory | null;
  const rawOutcome = url.searchParams.get("outcome") as AuditEventOutcome | null;
  const rawTargetType = url.searchParams.get("targetType") as AuditTargetType | null;
  const events = await listAuditEvents({
    workspaceId: workspaceContext.workspaceId,
    limit: parseLimit(url.searchParams.get("limit")),
    before: parseDate(url.searchParams.get("before")),
    since: parseDate(url.searchParams.get("since")),
    until: parseDate(url.searchParams.get("until")),
    category: rawCategory && CATEGORIES.has(rawCategory) ? rawCategory : undefined,
    outcome: rawOutcome && OUTCOMES.has(rawOutcome) ? rawOutcome : undefined,
    targetType:
      rawTargetType && TARGET_TYPES.has(rawTargetType) ? rawTargetType : undefined,
    targetId: url.searchParams.get("targetId") ?? undefined,
    actorUserId: url.searchParams.get("actorUserId") ?? undefined,
    sourceAppId: url.searchParams.get("appId") ?? undefined,
    eventName: url.searchParams.get("eventName") ?? undefined,
    query: url.searchParams.get("q") ?? undefined,
  });

  return NextResponse.json({
    items: events.map(toAuditEventListItem),
    nextBefore: events.at(-1)?.occurredAt.toISOString() ?? null,
  });
}

