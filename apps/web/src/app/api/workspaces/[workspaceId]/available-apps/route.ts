import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import { canShowLocalSourceControlFeatures } from "@/lib/source-control/runtime";
import { listAvailableSourceControlApps } from "@/lib/source-control/catalog";
import {
  safeSourceControlErrorMessage,
  SourceControlProviderError,
} from "@/lib/source-control/types";

type AvailableAppsRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function GET(
  request: Request,
  context: AvailableAppsRouteContext,
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

  if (!canShowLocalSourceControlFeatures()) {
    return NextResponse.json({ error: "local_runtime_required" }, { status: 404 });
  }

  try {
    const catalog = await listAvailableSourceControlApps({
      workspaceId: workspaceContext.workspaceId,
    });
    return NextResponse.json(catalog, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof SourceControlProviderError
            ? error.code
            : "available_apps_failed",
        message: safeSourceControlErrorMessage(error),
      },
      { status: error instanceof SourceControlProviderError ? error.status : 500 },
    );
  }
}
