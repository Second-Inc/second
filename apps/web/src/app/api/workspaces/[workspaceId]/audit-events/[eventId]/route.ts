import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import { toAuditEventListItem } from "@/lib/audit/read-models";
import { findAuditEventById } from "@/lib/db";

type AuditEventDetailRouteContext = {
  params: Promise<{
    workspaceId: string;
    eventId: string;
  }>;
};

export async function GET(
  request: Request,
  context: AuditEventDetailRouteContext,
) {
  const { workspaceId, eventId } = await context.params;

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

  const event = await findAuditEventById({
    workspaceId: workspaceContext.workspaceId,
    eventId,
  });
  if (!event) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ event: toAuditEventListItem(event) });
}

