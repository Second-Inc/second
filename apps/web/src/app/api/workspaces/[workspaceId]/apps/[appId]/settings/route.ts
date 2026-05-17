import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import { updateAppSettings } from "@/lib/db";
import { parseRuntimeSettings } from "@/lib/agent/runtime-registry";

type SettingsRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

export async function PATCH(request: Request, context: SettingsRouteContext) {
  const { workspaceId, appId } = await context.params;

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;

  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) {
      return guardErrorToApiResponse(error);
    }
    throw error;
  }

  const body = (await request.json().catch(() => null)) as {
    runtimeId?: string;
    runtimeModel?: string;
    runtimeParams?: Record<string, string>;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }
  if (!access.canCollaborate) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const runtimeSettings = parseRuntimeSettings({
    runtimeId: body.runtimeId,
    model: body.runtimeModel,
    params: body.runtimeParams,
  });
  if (!runtimeSettings) {
    return NextResponse.json(
      { error: "invalid_runtime_settings" },
      { status: 400 },
    );
  }

  await updateAppSettings({
    workspaceId: workspaceContext.workspaceId,
    appId,
    runtimeId: runtimeSettings.runtimeId,
    runtimeModel: runtimeSettings.model,
    runtimeParams: runtimeSettings.params,
  });

  return NextResponse.json({ ok: true });
}
