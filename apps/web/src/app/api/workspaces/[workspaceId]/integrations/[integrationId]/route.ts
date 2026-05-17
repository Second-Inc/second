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
  deleteIntegration,
  findIntegrationById,
  resetIntegrationConfiguration,
  updateIntegrationSecrets,
} from "@/lib/db";
import {
  deleteSecret,
  isVaultConfigured,
  storeSecret,
  updateSecret,
} from "@/lib/vault";

type IntegrationRouteContext = {
  params: Promise<{
    workspaceId: string;
    integrationId: string;
  }>;
};

function sanitizeSecrets(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const name = key.trim();
    if (!name || typeof rawValue !== "string") continue;
    if (rawValue.length === 0) continue;
    result[name] = rawValue;
  }
  return result;
}

function configuredSecretNames(secrets: Record<string, string>): string[] {
  return Object.keys(secrets).filter((name) => secrets[name]?.length > 0);
}

function existingConfiguredSecretNames(input: {
  vaultSecretIds?: Record<string, string>;
  localSecrets?: Record<string, string>;
}): string[] {
  return [
    ...new Set([
      ...Object.keys(input.vaultSecretIds ?? {}),
      ...Object.keys(input.localSecrets ?? {}),
    ]),
  ];
}

function missingRequiredSecretNames(
  requiredNames: string[],
  configuredNames: string[],
): string[] {
  const configured = new Set(configuredNames.map((name) => name.toLowerCase()));
  return requiredNames.filter((name) => !configured.has(name.toLowerCase()));
}

function credentialSecretVaultName(input: {
  integrationId: string;
  credentialId?: string | null;
  secretName: string;
}): string {
  return `integration_credential_${input.credentialId ?? `credential_${input.integrationId}`}_${input.secretName}`;
}

export async function PATCH(
  request: Request,
  context: IntegrationRouteContext,
) {
  const { workspaceId, integrationId } = await context.params;

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
      action: "integration_configure",
      summary:
        "Denied integration configuration because actor lacks integrations:manage.",
      target: { type: "integration", id: integrationId },
    });
    return NextResponse.json(
      { error: "integration_setup_forbidden" },
      { status: 403 },
    );
  }

  const integration = await findIntegrationById(
    integrationId,
    workspaceContext.workspaceId,
  );
  if (!integration) {
    return NextResponse.json(
      { error: "integration_not_found" },
      { status: 404 },
    );
  }

  const body = (await request.json()) as { secrets?: Record<string, string> };
  const submittedSecrets = sanitizeSecrets(body.secrets);
  const requiredSecretNames = (integration.secretRequirements ?? [])
    .filter((secret) => secret.required !== false)
    .map((secret) => secret.name);

  if (
    requiredSecretNames.length > 0 &&
    Object.keys(submittedSecrets).length === 0 &&
    existingConfiguredSecretNames(integration).length === 0
  ) {
    return NextResponse.json(
      { error: "at least one secret is required" },
      { status: 400 },
    );
  }

  if (isVaultConfigured()) {
    const vaultSecretIds = { ...(integration.vaultSecretIds ?? {}) };
    for (const [name, value] of Object.entries(submittedSecrets)) {
      if (vaultSecretIds[name]) {
        await updateSecret(vaultSecretIds[name], value);
      } else {
        vaultSecretIds[name] = await storeSecret(
          credentialSecretVaultName({
            integrationId: integration._id,
            credentialId: integration.credentialId,
            secretName: name,
          }),
          value,
          workspaceContext.workspaceId,
        );
      }
    }

    const configuredSecrets = configuredSecretNames(vaultSecretIds);
    const missingRequiredSecrets = missingRequiredSecretNames(
      requiredSecretNames,
      configuredSecrets,
    );
    if (missingRequiredSecrets.length > 0) {
      return NextResponse.json(
        {
          error: `missing required secret(s): ${missingRequiredSecrets.join(", ")}`,
        },
        { status: 400 },
      );
    }

    await updateIntegrationSecrets({
      workspaceId: workspaceContext.workspaceId,
      integrationId,
      update: {
        vaultSecretIds,
        localSecrets: {},
        configured: true,
        configuredPermissionGroups: integration.permissionGroups ?? [],
        configuredSecrets,
      },
      actor: {
        userId: workspaceContext.user._id,
        userName: workspaceContext.user.displayName,
      },
    });
  } else {
    const localSecrets = {
      ...(integration.localSecrets ?? {}),
      ...submittedSecrets,
    };

    const configuredSecrets = configuredSecretNames(localSecrets);
    const missingRequiredSecrets = missingRequiredSecretNames(
      requiredSecretNames,
      configuredSecrets,
    );
    if (missingRequiredSecrets.length > 0) {
      return NextResponse.json(
        {
          error: `missing required secret(s): ${missingRequiredSecrets.join(", ")}`,
        },
        { status: 400 },
      );
    }

    await updateIntegrationSecrets({
      workspaceId: workspaceContext.workspaceId,
      integrationId,
      update: {
        localSecrets,
        configured: true,
        configuredPermissionGroups: integration.permissionGroups ?? [],
        configuredSecrets,
      },
      actor: {
        userId: workspaceContext.user._id,
        userName: workspaceContext.user.displayName,
      },
    });
  }

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "integration.secret_rotated",
    category: "integrations",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request),
    target: {
      type: "integration",
      id: integration._id,
      name: integration.name,
    },
    action: "secret_rotated",
    summary: `Configured or rotated secrets for ${integration.name}.`,
    metadata: {
      domain: integration.domain,
      submittedSecretNames: Object.keys(submittedSecrets),
      configuredPermissionGroupNames: (integration.permissionGroups ?? []).map(
        (group) => group.name,
      ),
      appId: integration.appId,
      keySlug: integration.keySlug,
      credentialId: integration.credentialId ?? `credential_${integration._id}`,
    },
    changes: {
      changedFields: ["configuredSecrets", "configuredPermissionGroups"],
    },
    relatedIds: { integrationId: integration._id },
  });

  return NextResponse.json({ ok: true, configured: true });
}

export async function DELETE(
  request: Request,
  context: IntegrationRouteContext,
) {
  const { workspaceId, integrationId } = await context.params;

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
      action: "integration_delete",
      summary:
        "Denied integration deletion because actor lacks integrations:manage.",
      target: { type: "integration", id: integrationId },
    });
    return NextResponse.json(
      { error: "integration_setup_forbidden" },
      { status: 403 },
    );
  }

  const integration = await findIntegrationById(
    integrationId,
    workspaceContext.workspaceId,
  );
  if (!integration) {
    return NextResponse.json(
      { error: "integration_not_found" },
      { status: 404 },
    );
  }

  if (isVaultConfigured()) {
    for (const vaultSecretId of Object.values(integration.vaultSecretIds ?? {})) {
      try {
        await deleteSecret(vaultSecretId);
      } catch {
        // Best effort — continue with deletion
      }
    }
  }

  const deletion = await deleteIntegration({
    workspaceId: workspaceContext.workspaceId,
    integrationId,
  });
  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "integration.deleted",
    category: "integrations",
    severity: "warning",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request),
    target: {
      type: "integration",
      id: integration._id,
      name: integration.name,
    },
    action: "deleted",
    summary: `Deleted integration ${integration.name}.`,
    metadata: {
      domain: integration.domain,
      configured: integration.configured,
      appId: integration.appId,
      keySlug: integration.keySlug,
      credentialId: integration.credentialId,
      oauthProviderKey:
        integration.auth?.type === "oauth2" ? integration.auth.providerKey : null,
      oauthProviderDeleted:
        deletion.oauthProviderCleanup?.deletedProviderConfig ?? false,
      oauthProviderConfigId:
        deletion.oauthProviderCleanup?.providerConfigId ?? null,
      connectedAccountsRevoked:
        deletion.oauthProviderCleanup?.deletedConnectedAccountCount ?? 0,
      oauthSecretRefsDeleted:
        deletion.oauthProviderCleanup?.deletedSecretCount ?? 0,
      providerTokenRevocationAttempts:
        deletion.oauthProviderCleanup?.providerRevocationAttemptCount ?? 0,
      providerTokenRevocationSuccesses:
        deletion.oauthProviderCleanup?.providerRevocationSuccessCount ?? 0,
    },
    relatedIds: { integrationId: integration._id },
  });
  return NextResponse.json({ ok: true });
}

export async function POST(
  request: Request,
  context: IntegrationRouteContext,
) {
  const { workspaceId, integrationId } = await context.params;

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
      action: "integration_reset",
      summary:
        "Denied integration reset because actor lacks integrations:manage.",
      target: { type: "integration", id: integrationId },
    });
    return NextResponse.json(
      { error: "integration_setup_forbidden" },
      { status: 403 },
    );
  }

  const integration = await findIntegrationById(
    integrationId,
    workspaceContext.workspaceId,
  );
  if (!integration) {
    return NextResponse.json(
      { error: "integration_not_found" },
      { status: 404 },
    );
  }

  if (isVaultConfigured()) {
    for (const vaultSecretId of Object.values(integration.vaultSecretIds ?? {})) {
      try {
        await deleteSecret(vaultSecretId);
      } catch {
        // Best effort — reset the integration state even if vault cleanup fails.
      }
    }
  }

  const reset = await resetIntegrationConfiguration({
    workspaceId: workspaceContext.workspaceId,
    integrationId,
  });
  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "integration.reset",
    category: "integrations",
    severity: "warning",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request),
    target: {
      type: "integration",
      id: integration._id,
      name: integration.name,
    },
    action: "reset",
    summary: `Reset integration ${integration.name}.`,
    metadata: {
      domain: integration.domain,
      configuredSecretNames: existingConfiguredSecretNames(integration),
      appId: integration.appId,
      keySlug: integration.keySlug,
      credentialId: integration.credentialId,
      oauthProviderKey:
        integration.auth?.type === "oauth2" ? integration.auth.providerKey : null,
      oauthProviderConfigId:
        reset.oauthProviderCleanup?.providerConfigId ?? null,
      connectedAccountsRevoked:
        reset.oauthProviderCleanup?.deletedConnectedAccountCount ?? 0,
      oauthSecretRefsDeleted:
        reset.oauthProviderCleanup?.deletedSecretCount ?? 0,
      providerTokenRevocationAttempts:
        reset.oauthProviderCleanup?.providerRevocationAttemptCount ?? 0,
      providerTokenRevocationSuccesses:
        reset.oauthProviderCleanup?.providerRevocationSuccessCount ?? 0,
    },
    changes: {
      changedFields:
        integration.auth?.type === "oauth2"
          ? ["oauthProviderConfig", "connectedAccounts"]
          : ["configured", "configuredSecrets", "configuredPermissionGroups"],
    },
    relatedIds: { integrationId: integration._id },
  });
  return NextResponse.json({ ok: true, configured: false });
}
