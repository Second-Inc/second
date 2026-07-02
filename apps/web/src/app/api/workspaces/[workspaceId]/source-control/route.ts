import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import { createPerfTrace, perfResponseHeaders } from "@/lib/perf/trace";
import {
  dedupeWorkspaceSettingsRequest,
  workspaceSettingsDedupeKey,
} from "@/lib/workspace-settings/request-dedupe";
import { loadSourceControlSettingsReadModel } from "@/lib/workspace-settings/read-models";

type SourceControlRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function GET(
  request: Request,
  context: SourceControlRouteContext,
) {
  const { workspaceId } = await context.params;
  const trace = createPerfTrace({
    route: "GET /api/workspaces/[workspaceId]/source-control",
    workspaceId,
  });
  trace.log("settings.source_control.request_start");

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

  const data = await trace.time("settings.source_control.read_model", () =>
    dedupeWorkspaceSettingsRequest(
      workspaceSettingsDedupeKey("source-control", workspaceContext),
      750,
      () => loadSourceControlSettingsReadModel(workspaceContext),
    ),
  );
  trace.log("settings.source_control.response", {
    connected: Boolean(data.connection),
    canManage: data.canManage,
    totalElapsedMs: trace.elapsedMs(),
  });

  return NextResponse.json(data, { headers: perfResponseHeaders(trace) });
}
