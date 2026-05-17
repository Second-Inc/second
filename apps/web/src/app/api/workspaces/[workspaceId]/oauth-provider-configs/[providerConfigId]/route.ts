import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAccessDeniedAuditEvent,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  configureOAuthProviderClient,
  findOAuthProviderConfigById,
} from "@/lib/db";

type OAuthProviderConfigRouteContext = {
  params: Promise<{
    workspaceId: string;
    providerConfigId: string;
  }>;
};

export async function PATCH(
  request: Request,
  context: OAuthProviderConfigRouteContext,
) {
  const { workspaceId, providerConfigId } = await context.params;

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

  if (
    !hasWorkspacePermission(workspaceContext.membership, "integrations:manage")
  ) {
    await recordAccessDeniedAuditEvent({
      request,
      workspaceContext,
      permission: "integrations:manage",
      action: "oauth_provider_configure",
      summary:
        "Denied OAuth provider configuration because actor lacks integrations:manage.",
      target: { type: "oauth_provider_config", id: providerConfigId },
    });
    return NextResponse.json(
      { error: "oauth_provider_config_forbidden" },
      { status: 403 },
    );
  }

  const existing = await findOAuthProviderConfigById({
    workspaceId: workspaceContext.workspaceId,
    providerConfigId,
  });
  if (!existing) {
    return NextResponse.json(
      { error: "oauth_provider_config_not_found" },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { clientId?: string; clientSecret?: string }
    | null;
  const clientId = body?.clientId?.trim() ?? "";
  const clientSecret = body?.clientSecret?.trim();
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  if (
    existing.tokenAuthMethod !== "none" &&
    !existing.clientSecretRef &&
    !clientSecret?.length
  ) {
    return NextResponse.json(
      { error: "clientSecret is required" },
      { status: 400 },
    );
  }

  let config;
  try {
    config = await configureOAuthProviderClient({
      workspaceId: workspaceContext.workspaceId,
      providerConfigId,
      clientId,
      clientSecret,
      actor: {
        userId: workspaceContext.user._id,
        userName: workspaceContext.user.displayName,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "oauth_config_failed",
      },
      { status: 400 },
    );
  }

  if (!config) {
    return NextResponse.json(
      { error: "oauth_provider_config_not_found" },
      { status: 404 },
    );
  }

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: existing.configured
      ? "oauth.provider_secret_rotated"
      : "oauth.provider_configured",
    category: "integrations",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request),
    target: {
      type: "oauth_provider_config",
      id: config._id,
      name: config.displayName,
    },
    action: existing.configured ? "provider_secret_rotated" : "provider_configured",
    summary: `Configured OAuth provider ${config.displayName}.`,
    metadata: {
      providerKey: config.providerKey,
      authorizationHost: new URL(config.authorizationUrl).hostname,
      tokenHost: new URL(config.tokenUrl).hostname,
      tokenAuthMethod: config.tokenAuthMethod,
      clientIdChanged: existing.clientId !== config.clientId,
      clientSecretSubmitted: Boolean(clientSecret?.length),
    },
    changes: {
      changedFields: ["clientId", "clientSecretRef", "configured"],
      redactedFields: ["clientSecret"],
    },
  });

  return NextResponse.json({
    ok: true,
    configured: true,
    providerConfigId: config._id,
  });
}
