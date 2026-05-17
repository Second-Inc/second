import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import { summarizeAuditEvents } from "@/lib/db";

type AuditEventsSummaryRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function GET(
  request: Request,
  context: AuditEventsSummaryRouteContext,
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

  const summary = await summarizeAuditEvents({
    workspaceId: workspaceContext.workspaceId,
    since: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

  return NextResponse.json({
    window: "24h",
    ...summary,
  });
}

