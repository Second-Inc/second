import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  findIntegrationById,
  findOAuthProviderConfigById,
} from "@/lib/db";
import type { IntegrationAuthConfig } from "@/lib/db";
import { readPublicUrlFromEnv } from "@/lib/config/public-url";
import {
  createOAuthState,
  createPkcePair,
  safeReturnTo,
} from "@/lib/oauth/state";
import { assertPublicHttpsUrl } from "@/lib/oauth/url-guards";

type OAuthStartRouteContext = {
  params: Promise<{
    workspaceId: string;
    providerConfigId: string;
  }>;
};

function redirectUriForRequest(request: Request): string {
  const origin = process.env.SECOND_PUBLIC_URL?.trim()
    ? readPublicUrlFromEnv()
    : new URL(request.url).origin;
  return `${origin}/api/oauth/callback`;
}

function oauthAuthFromIntegration(
  auth: IntegrationAuthConfig | undefined,
): Extract<IntegrationAuthConfig, { type: "oauth2" }> | null {
  return auth?.type === "oauth2" ? auth : null;
}

export async function GET(request: Request, context: OAuthStartRouteContext) {
  const { workspaceId, providerConfigId } = await context.params;
  const url = new URL(request.url);

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: url.pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const integrationId = url.searchParams.get("integrationId")?.trim();
  if (!integrationId) {
    return NextResponse.json(
      { error: "integrationId is required" },
      { status: 400 },
    );
  }

  const [providerConfig, integration] = await Promise.all([
    findOAuthProviderConfigById({
      workspaceId: workspaceContext.workspaceId,
      providerConfigId,
    }),
    findIntegrationById(integrationId, workspaceContext.workspaceId),
  ]);
  if (!providerConfig) {
    return NextResponse.json(
      { error: "oauth_provider_config_not_found" },
      { status: 404 },
    );
  }
  if (!providerConfig.configured || !providerConfig.clientId) {
    return NextResponse.json(
      { error: "oauth_provider_not_configured" },
      { status: 409 },
    );
  }
  if (!integration) {
    return NextResponse.json(
      { error: "integration_not_found" },
      { status: 404 },
    );
  }
  const auth = oauthAuthFromIntegration(integration.auth);
  if (!auth || auth.providerKey !== providerConfig.providerKey) {
    return NextResponse.json(
      { error: "integration_is_not_oauth_for_provider" },
      { status: 400 },
    );
  }
  if (
    providerConfig.authorizationUrl !== auth.authorizationUrl ||
    providerConfig.tokenUrl !== auth.tokenUrl ||
    providerConfig.tokenAuthMethod !== (auth.tokenAuthMethod ?? "client_secret_post")
  ) {
    return NextResponse.json(
      { error: "oauth_provider_config_mismatch" },
      { status: 409 },
    );
  }

  const redirectUri = redirectUriForRequest(request);
  const returnTo = safeReturnTo(
    url.searchParams.get("returnTo") ??
      `/w/${workspaceContext.workspaceId}/settings/integrations`,
  );
  const pkce = createPkcePair();
  const state = await createOAuthState({
    workspaceId: workspaceContext.workspaceId,
    userId: workspaceContext.user._id,
    providerConfigId: providerConfig._id,
    integrationId: integration._id,
    requestedScopes: auth.scopes,
    returnTo,
    codeVerifier: pkce.codeVerifier,
  });

  let authorizeUrl: URL;
  try {
    authorizeUrl = await assertPublicHttpsUrl({
      url: auth.authorizationUrl,
    });
  } catch {
    return NextResponse.json(
      { error: "oauth_authorization_url_not_allowed" },
      { status: 400 },
    );
  }
  for (const [key, value] of Object.entries(
    providerConfig.defaultAuthorizationParams ?? {},
  )) {
    authorizeUrl.searchParams.set(key, value);
  }
  for (const [key, value] of Object.entries(auth.authorizationParams ?? {})) {
    authorizeUrl.searchParams.set(key, value);
  }
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", providerConfig.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", auth.scopes.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", pkce.codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  return NextResponse.redirect(authorizeUrl);
}
