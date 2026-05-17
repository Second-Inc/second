import { NextResponse } from "next/server";
import type { WorkspaceContext } from "@/lib/auth/guard";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  findConnectedAccountForUserProvider,
  findIntegrationById,
  findMembership,
  findOAuthProviderConfigById,
  findUserById,
  readOAuthProviderClientSecret,
  scopesIncludeAll,
  upsertConnectedAccount,
} from "@/lib/db";
import type { IntegrationAuthConfig } from "@/lib/db";
import { readPublicUrlFromEnv } from "@/lib/config/public-url";
import { storeOAuthSecret, upsertOAuthSecret } from "@/lib/oauth/secret-store";
import { consumeOAuthState, type OAuthStatePayload } from "@/lib/oauth/state";
import {
  exchangeAuthorizationCode,
  parseIdTokenClaims,
  tokenExpiresAt,
} from "@/lib/oauth/token-exchange";

function callbackRedirectUri(request: Request): string {
  const origin = process.env.SECOND_PUBLIC_URL?.trim()
    ? readPublicUrlFromEnv()
    : new URL(request.url).origin;
  return `${origin}/api/oauth/callback`;
}

function redirectWithStatus(
  origin: string,
  returnTo: string,
  params: Record<string, string>,
) {
  const destination = new URL(returnTo, "https://second.local");
  for (const [key, value] of Object.entries(params)) {
    destination.searchParams.set(key, value);
  }
  return NextResponse.redirect(
    `${origin}${destination.pathname}${destination.search}${destination.hash}`,
  );
}

function oauthAuthFromIntegration(
  auth: IntegrationAuthConfig | undefined,
): Extract<IntegrationAuthConfig, { type: "oauth2" }> | null {
  return auth?.type === "oauth2" ? auth : null;
}

function logOAuthCallback(event: "connected" | "failed", input: {
  workspaceId?: string;
  userId?: string;
  providerConfigId?: string;
  integrationId?: string;
  providerKey?: string;
  reason?: string;
}) {
  const payload = {
    workspaceId: input.workspaceId ?? null,
    userId: input.userId ?? null,
    providerConfigId: input.providerConfigId ?? null,
    integrationId: input.integrationId ?? null,
    providerKey: input.providerKey ?? null,
    reason: input.reason ?? null,
  };
  if (event === "connected") {
    console.info("[oauth] callback connected", payload);
  } else {
    console.warn("[oauth] callback failed", payload);
  }
}

async function workspaceContextFromOAuthState(
  state: OAuthStatePayload,
): Promise<WorkspaceContext | null> {
  const [user, membership] = await Promise.all([
    findUserById(state.userId),
    findMembership({
      workspaceId: state.workspaceId,
      userId: state.userId,
    }),
  ]);

  if (!user || !membership) return null;

  return {
    actor: {
      provider: process.env.SECOND_AUTH_MODE === "external" ? "external" : "none",
      userId: user._id,
    },
    user,
    workspaceId: state.workspaceId,
    membership,
    memberships: [membership],
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.SECOND_PUBLIC_URL?.trim()
    ? readPublicUrlFromEnv()
    : url.origin;
  const stateValue = url.searchParams.get("state")?.trim();
  const code = url.searchParams.get("code")?.trim();
  const providerError = url.searchParams.get("error")?.trim();

  if (!stateValue) {
    return NextResponse.json({ error: "missing_oauth_state" }, { status: 400 });
  }

  const state = await consumeOAuthState(stateValue);
  if (!state) {
    return NextResponse.json(
      { error: "invalid_or_expired_oauth_state" },
      { status: 400 },
    );
  }

  if (providerError) {
    logOAuthCallback("failed", {
      workspaceId: state.workspaceId,
      userId: state.userId,
      providerConfigId: state.providerConfigId,
      integrationId: state.integrationId,
      reason: providerError,
    });
    return redirectWithStatus(origin, state.returnTo, {
      oauth_error: providerError,
      providerConfigId: state.providerConfigId,
    });
  }
  if (!code) {
    logOAuthCallback("failed", {
      workspaceId: state.workspaceId,
      userId: state.userId,
      providerConfigId: state.providerConfigId,
      integrationId: state.integrationId,
      reason: "missing_code",
    });
    return redirectWithStatus(origin, state.returnTo, {
      oauth_error: "missing_code",
      providerConfigId: state.providerConfigId,
    });
  }

  const workspaceContext = await workspaceContextFromOAuthState(state);
  if (!workspaceContext) {
    logOAuthCallback("failed", {
      workspaceId: state.workspaceId,
      userId: state.userId,
      providerConfigId: state.providerConfigId,
      integrationId: state.integrationId,
      reason: "oauth_identity_missing",
    });
    return redirectWithStatus(origin, state.returnTo, {
      oauth_error: "oauth_identity_missing",
      providerConfigId: state.providerConfigId,
    });
  }

  const [providerConfig, integration] = await Promise.all([
    findOAuthProviderConfigById({
      workspaceId: state.workspaceId,
      providerConfigId: state.providerConfigId,
    }),
    findIntegrationById(state.integrationId, state.workspaceId),
  ]);
  const auth = oauthAuthFromIntegration(integration?.auth);
  if (!providerConfig || !integration || !auth) {
    logOAuthCallback("failed", {
      workspaceId: state.workspaceId,
      userId: state.userId,
      providerConfigId: state.providerConfigId,
      integrationId: state.integrationId,
      reason: "oauth_config_missing",
    });
    return redirectWithStatus(origin, state.returnTo, {
      oauth_error: "oauth_config_missing",
      providerConfigId: state.providerConfigId,
    });
  }
  if (
    providerConfig.providerKey !== auth.providerKey ||
    providerConfig.authorizationUrl !== auth.authorizationUrl ||
    providerConfig.tokenUrl !== auth.tokenUrl ||
    providerConfig.tokenAuthMethod !== (auth.tokenAuthMethod ?? "client_secret_post")
  ) {
    logOAuthCallback("failed", {
      workspaceId: state.workspaceId,
      userId: state.userId,
      providerConfigId: state.providerConfigId,
      integrationId: state.integrationId,
      providerKey: providerConfig.providerKey,
      reason: "oauth_config_mismatch",
    });
    return redirectWithStatus(origin, state.returnTo, {
      oauth_error: "oauth_config_mismatch",
      providerConfigId: state.providerConfigId,
    });
  }

  const existingAccount = await findConnectedAccountForUserProvider({
    workspaceId: state.workspaceId,
    userId: state.userId,
    providerConfigId: state.providerConfigId,
  });

  try {
    const clientSecret = await readOAuthProviderClientSecret(providerConfig);
    const tokenResponse = await exchangeAuthorizationCode({
      providerConfig,
      auth,
      clientSecret,
      code,
      redirectUri: callbackRedirectUri(request),
      codeVerifier: state.codeVerifier,
    });

    const refreshTokenRef = tokenResponse.refreshToken
      ? await upsertOAuthSecret({
          workspaceId: state.workspaceId,
          name: `oauth_refresh_token_${providerConfig._id}_${state.userId}`,
          value: tokenResponse.refreshToken,
          existingRef: existingAccount?.refreshTokenRef,
        })
      : existingAccount?.refreshTokenRef ?? null;

    if (!refreshTokenRef) {
      logOAuthCallback("failed", {
        workspaceId: state.workspaceId,
        userId: state.userId,
        providerConfigId: state.providerConfigId,
        integrationId: state.integrationId,
        providerKey: providerConfig.providerKey,
        reason: "missing_refresh_token",
      });
      return redirectWithStatus(origin, state.returnTo, {
        oauth_error: "missing_refresh_token",
        providerConfigId: state.providerConfigId,
      });
    }

    const accessTokenRef = await storeOAuthSecret({
      workspaceId: state.workspaceId,
      name: `oauth_access_token_${providerConfig._id}_${state.userId}`,
      value: tokenResponse.accessToken,
    });
    const claims = parseIdTokenClaims(tokenResponse.idToken);
    const account = await upsertConnectedAccount({
      workspaceId: state.workspaceId,
      userId: state.userId,
      providerConfigId: providerConfig._id,
      providerKey: providerConfig.providerKey,
      source: process.env.NODE_ENV === "production"
        ? "customer_oauth"
        : "local_direct",
      externalSubject: claims.sub ?? existingAccount?.externalSubject ?? null,
      accountEmail:
        claims.email ?? existingAccount?.accountEmail ?? workspaceContext.user.email,
      accountName:
        claims.name ??
        existingAccount?.accountName ??
        workspaceContext.user.displayName,
      grantedScopes: tokenResponse.scopes,
      refreshTokenRef,
      accessTokenRef,
      accessTokenExpiresAt: tokenExpiresAt(tokenResponse.expiresIn),
      tokenType: tokenResponse.tokenType ?? "Bearer",
    });

    const scopeOk = scopesIncludeAll({
      grantedScopes: account.grantedScopes,
      requiredScopes: state.requestedScopes,
    });

    await recordAuditEvent({
      workspaceId: state.workspaceId,
      eventName: "oauth.connected",
      category: "integrations",
      severity: "notice",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request),
      target: {
        type: "connected_account",
        id: account._id,
        name: providerConfig.providerKey,
      },
      action: "connected",
      summary: `Connected ${providerConfig.displayName} account.`,
      metadata: {
        providerKey: providerConfig.providerKey,
        providerConfigId: providerConfig._id,
        integrationId: integration._id,
        grantedScopes: account.grantedScopes,
        missingRequiredScopes: scopeOk ? [] : state.requestedScopes,
      },
      relatedIds: { integrationId: integration._id },
    });

    logOAuthCallback("connected", {
      workspaceId: state.workspaceId,
      userId: state.userId,
      providerConfigId: providerConfig._id,
      integrationId: integration._id,
      providerKey: providerConfig.providerKey,
      reason: scopeOk ? undefined : "missing_scopes",
    });

    return redirectWithStatus(origin, state.returnTo, {
      oauth: scopeOk ? "connected" : "missing_scopes",
      providerConfigId: state.providerConfigId,
    });
  } catch (error) {
    await recordAuditEvent({
      workspaceId: state.workspaceId,
      eventName: "oauth.connect_failed",
      category: "integrations",
      severity: "warning",
      outcome: "failure",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request),
      target: {
        type: "oauth_provider_config",
        id: providerConfig._id,
        name: providerConfig.displayName,
      },
      action: "connect_failed",
      summary: `Failed to connect ${providerConfig.displayName}.`,
      metadata: {
        providerKey: providerConfig.providerKey,
        providerConfigId: providerConfig._id,
        integrationId: integration._id,
        error: error instanceof Error ? error.message : "oauth_connect_failed",
      },
      relatedIds: { integrationId: integration._id },
    });

    logOAuthCallback("failed", {
      workspaceId: state.workspaceId,
      userId: state.userId,
      providerConfigId: providerConfig._id,
      integrationId: integration._id,
      providerKey: providerConfig.providerKey,
      reason: error instanceof Error ? error.message : "oauth_connect_failed",
    });

    return redirectWithStatus(origin, state.returnTo, {
      oauth_error:
        error instanceof Error ? error.message : "oauth_connect_failed",
      providerConfigId: state.providerConfigId,
    });
  }
}
