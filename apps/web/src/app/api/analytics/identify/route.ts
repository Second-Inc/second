import { NextRequest, NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  normalizeWorkspaceId,
  requireReadyState,
} from "@/lib/auth";
import { readAnalyticsPublicConfig } from "@/lib/analytics-public-config";
import { ensurePostHogIdentity } from "@/lib/posthog-server";

function jsonError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

export async function POST(request: NextRequest) {
  let readyState: Awaited<ReturnType<typeof requireReadyState>>;

  try {
    readyState = await requireReadyState({ headers: request.headers });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    return jsonError(500, "analytics_auth_failed");
  }

  const payload = await request.json().catch(() => null);
  const workspaceId = isPlainRecord(payload) &&
    typeof payload.workspaceId === "string"
    ? normalizeWorkspaceId(payload.workspaceId)
    : null;
  const membership = workspaceId
    ? readyState.memberships.find((item) => item.workspaceId === workspaceId)
    : readyState.memberships[0] ?? null;

  if (workspaceId && !membership) {
    return jsonError(404, "workspace_not_found");
  }

  const config = readAnalyticsPublicConfig();
  if (!config.posthogToken) return new NextResponse(null, { status: 204 });

  const identified = await ensurePostHogIdentity({
    config,
    user: readyState.user,
    membership,
  });

  if (!identified) {
    return jsonError(502, "analytics_identify_failed");
  }

  return new NextResponse(null, { status: 204 });
}
