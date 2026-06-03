import { NextResponse } from "next/server";
import {
  integrationNeedsSetup,
  listIntegrationsForAppReview,
} from "@/lib/db";
import {
  buildLocalHeadlessAppPayload,
  findLocalHeadlessApp,
  validateLocalHeadlessRequest,
} from "@/lib/local-headless";

type HeadlessIntegrationsRouteContext = {
  params: Promise<{ appId: string }>;
};

export async function GET(
  request: Request,
  context: HeadlessIntegrationsRouteContext,
) {
  const authError = validateLocalHeadlessRequest(request);
  if (authError) return authError;

  const { appId } = await context.params;
  const appContext = await findLocalHeadlessApp(appId);
  if (!appContext) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }

  const app = buildLocalHeadlessAppPayload({
    workspaceId: appContext.workspaceId,
    appId,
    appName: appContext.app.name,
  });
  const integrations = await listIntegrationsForAppReview({
    workspaceId: appContext.workspaceId,
    appId,
  });

  return NextResponse.json({
    ok: true,
    url: app.integrationsUrl,
    items: integrations.map((integration) => ({
      id: integration._id,
      name: integration.name,
      domain: integration.domain,
      keySlug: integration.keySlug,
      configured: integration.configured,
      needsSetup: integrationNeedsSetup(integration),
      authType: integration.auth?.type ?? "static_secret",
      permissionGroups: integration.permissionGroups ?? [],
      secretRequirements: integration.secretRequirements ?? [],
    })),
  });
}
