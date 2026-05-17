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
import { loadIntegrationsSettingsReadModel } from "@/lib/workspace-settings/read-models";

type IntegrationsRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function GET(request: Request, context: IntegrationsRouteContext) {
  const { workspaceId } = await context.params;
  const trace = createPerfTrace({
    route: "GET /api/workspaces/[workspaceId]/integrations",
    workspaceId,
  });
  trace.log("settings.integrations.request_start");

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

  const data = await trace.time("settings.integrations.read_model", () =>
    dedupeWorkspaceSettingsRequest(
      workspaceSettingsDedupeKey("integrations", workspaceContext),
      750,
      () =>
        loadIntegrationsSettingsReadModel(workspaceContext, {
          requestOrigin: new URL(request.url).origin,
        }),
    ),
  );
  trace.log("settings.integrations.response", {
    integrations: data.integrations.length,
    canManage: data.canManage,
    totalElapsedMs: trace.elapsedMs(),
  });
  return NextResponse.json(data, { headers: perfResponseHeaders(trace) });
}

export async function POST(request: Request, context: IntegrationsRouteContext) {
  const { workspaceId } = await context.params;

  try {
    await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  return NextResponse.json(
    {
      error:
        "app_scoped_integration_required",
      message:
        "Integration requests are created from an app's integration setup flow, not from a workspace-wide provider create.",
    },
    { status: 400 },
  );
}
