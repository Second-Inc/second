import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";

type AuditViewedRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

const VIEW_RATE_LIMIT = new Map<string, number>();
const VIEW_RATE_LIMIT_MS = 60_000;

function shouldRecordView(key: string): boolean {
  const now = Date.now();
  const previous = VIEW_RATE_LIMIT.get(key) ?? 0;
  if (now - previous < VIEW_RATE_LIMIT_MS) return false;
  VIEW_RATE_LIMIT.set(key, now);
  return true;
}

export async function POST(
  request: Request,
  context: AuditViewedRouteContext,
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

  const key = `${workspaceContext.workspaceId}:${workspaceContext.user._id}:audit.viewed`;
  if (shouldRecordView(key)) {
    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "audit.viewed",
      category: "audit",
      severity: "info",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request),
      target: {
        type: "workspace",
        id: workspaceContext.workspaceId,
        name: "Audit logs",
      },
      action: "viewed",
      summary: "Opened the workspace audit logs.",
      metadata: {
        route: `/w/${workspaceContext.workspaceId}/settings/audit-logs`,
        rateLimitedWindowSeconds: VIEW_RATE_LIMIT_MS / 1000,
      },
      retention: { policy: "security" },
    });
  }

  return NextResponse.json({ ok: true });
}

