import { NextResponse } from "next/server";
import { validateInternalToken } from "@/lib/auth/internal-auth";
import {
  integrationNeedsSetup,
  listIntegrationsForAppReview,
  listIntegrationsForWorkspace,
  normalizeIntegrationDomain,
} from "@/lib/db";
import type { IntegrationGrantWithCredential } from "@/lib/db";

type AppIntegrationKeysRequest = {
  workspaceId?: string;
  appId?: string;
  domain?: string;
};

function hostFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function serializeGrant(
  grant: IntegrationGrantWithCredential,
) {
  const auth = grant.auth ?? { type: "static_secret" as const };
  return {
    id: grant._id,
    appId: grant.appId,
    appName: grant.appName,
    name: grant.name,
    domain: grant.domain,
    keySlug: grant.keySlug,
    keyName: grant.keyName,
    capabilityLabel: grant.capabilityLabel,
    accessLevel: grant.accessLevel,
    authType: auth.type,
    auth,
    oauth:
      auth.type === "oauth2"
        ? {
            providerKey: auth.providerKey,
            identity: auth.identity,
            scopes: auth.scopes,
            authorizationHost: hostFromUrl(auth.authorizationUrl),
            tokenHost: hostFromUrl(auth.tokenUrl),
            tokenAuthMethod: auth.tokenAuthMethod ?? "client_secret_post",
            providerConfigured: grant.configured,
          }
        : null,
    configured: grant.configured,
    needsSetup: integrationNeedsSetup(grant),
    configuredPermissionGroups: grant.configuredPermissionGroups,
    configuredSecrets: grant.configuredSecrets,
    requestedPermissionGroups: grant.permissionGroups ?? [],
    requestedSecrets: (grant.secretRequirements ?? []).map((secret) => ({
      name: secret.name,
      label: secret.label,
      description: secret.description,
      required: secret.required ?? true,
    })),
    setupInstructions: grant.setupInstructions ?? null,
    credentialName: grant.credentialName,
    reuseSuggestions: [],
  };
}

export async function POST(request: Request) {
  const authError = validateInternalToken(request);
  if (authError) return authError;

  let body: AppIntegrationKeysRequest;
  try {
    body = (await request.json()) as AppIntegrationKeysRequest;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.workspaceId) {
    return NextResponse.json(
      { success: false, error: "workspaceId is required" },
      { status: 400 },
    );
  }
  if (!body.appId) {
    return NextResponse.json(
      {
        success: false,
        error: "appId is required for app-scoped integration state",
      },
      { status: 400 },
    );
  }

  const requestedDomain = body.domain
    ? normalizeIntegrationDomain(body.domain)
    : null;
  const [currentAppGrants, workspaceGrants] = await Promise.all([
    listIntegrationsForAppReview({
      workspaceId: body.workspaceId,
      appId: body.appId,
    }),
    listIntegrationsForWorkspace(body.workspaceId),
  ]);
  const filtered = requestedDomain
    ? currentAppGrants.filter((grant) => grant.domain === requestedDomain)
    : currentAppGrants;
  const grants = filtered.map((grant) => serializeGrant(grant));

  return NextResponse.json({
    success: true,
    appId: body.appId,
    grants,
    integrations: grants,
    workspaceSummary: {
      appScopedGrantCount: workspaceGrants.length,
      connectedGrantCount: workspaceGrants.filter((grant) => grant.configured)
        .length,
      setupNeededGrantCount: workspaceGrants.filter((grant) =>
        integrationNeedsSetup(grant),
      ).length,
    },
  });
}
