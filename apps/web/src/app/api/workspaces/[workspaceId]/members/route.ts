import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import { createPerfTrace, perfResponseHeaders } from "@/lib/perf/trace";
import {
  dedupeWorkspaceSettingsRequest,
  workspaceSettingsDedupeKey,
} from "@/lib/workspace-settings/request-dedupe";
import { loadMembersSettingsReadModel } from "@/lib/workspace-settings/read-models";

type WorkspaceMembersRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function GET(
  request: Request,
  context: WorkspaceMembersRouteContext,
) {
  const { workspaceId } = await context.params;
  const trace = createPerfTrace({
    route: "GET /api/workspaces/[workspaceId]/members",
    workspaceId,
  });
  trace.log("settings.members.request_start");

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await trace.time("auth.workspace", () =>
      requireWorkspaceContext({
        headers: request.headers,
        pathname: new URL(request.url).pathname,
        workspaceId,
      }),
    );
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  if (!hasWorkspacePermission(workspaceContext.membership, "members:view")) {
    return NextResponse.json(
      { error: "workspace_members_forbidden" },
      { status: 403 },
    );
  }

  const data = await trace.time("settings.members.read_model", () =>
    dedupeWorkspaceSettingsRequest(
      workspaceSettingsDedupeKey("members", workspaceContext),
      750,
      () => loadMembersSettingsReadModel(workspaceContext, { trace }),
    ),
  );
  trace.log("settings.members.response", {
    members: data.members.length,
    hasDefaultTeam: Boolean(data.defaultTeam),
    totalElapsedMs: trace.elapsedMs(),
  });
  return NextResponse.json(data, { headers: perfResponseHeaders(trace) });
}
