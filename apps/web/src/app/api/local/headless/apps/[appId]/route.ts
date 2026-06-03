import { NextResponse } from "next/server";
import {
  getAppPublishStatus,
  integrationNeedsSetup,
  listIntegrationsForAppReview,
} from "@/lib/db";
import {
  buildLocalHeadlessAppPayload,
  findLocalHeadlessApp,
  validateLocalHeadlessRequest,
} from "@/lib/local-headless";

type HeadlessAppRouteContext = {
  params: Promise<{ appId: string }>;
};

export async function GET(
  request: Request,
  context: HeadlessAppRouteContext,
) {
  const authError = validateLocalHeadlessRequest(request);
  if (authError) return authError;

  const { appId } = await context.params;
  const appContext = await findLocalHeadlessApp(appId);
  if (!appContext) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }

  const integrations = await listIntegrationsForAppReview({
    workspaceId: appContext.workspaceId,
    appId,
  });

  return NextResponse.json({
    ok: true,
    app: {
      ...buildLocalHeadlessAppPayload({
        workspaceId: appContext.workspaceId,
        appId,
        appName: appContext.app.name,
      }),
      publishStatus: getAppPublishStatus(appContext.app),
    },
    integrations: integrations.map((integration) => ({
      id: integration._id,
      name: integration.name,
      domain: integration.domain,
      keySlug: integration.keySlug,
      configured: integration.configured,
      needsSetup: integrationNeedsSetup(integration),
      authType: integration.auth?.type ?? "static_secret",
    })),
  });
}
