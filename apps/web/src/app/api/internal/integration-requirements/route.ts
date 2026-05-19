import { NextResponse } from "next/server";
import { validateInternalToken } from "@/lib/auth/internal-auth";
import { recordAuditEvent } from "@/lib/audit/record";
import {
  findAppById,
  syncIntegrationSetupInstructions,
} from "@/lib/db";
import {
  normalizeIntegrationDomain,
  normalizeIntegrationKeySlug,
  type IntegrationSetupConfig,
  type SyncedIntegrationRequirement,
} from "@/lib/db/repositories/integrations";
import {
  reportIntegrationSetupTelemetry,
  type IntegrationSetupTelemetryIntegration,
} from "@/lib/integration-setup-telemetry";

type IntegrationRequirementsRequest = {
  workspaceId: string;
  appId: string;
  appName?: string;
  runId?: string;
  requestedByUserId?: string;
  requestedByUserName?: string;
  setupConfig?: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function integrationTelemetryItems(
  setupConfig: Record<string, unknown>,
): IntegrationSetupTelemetryIntegration[] {
  return (Array.isArray(setupConfig.integrations) ? setupConfig.integrations : [])
    .map((item): IntegrationSetupTelemetryIntegration | null => {
      const record = asObject(item);
      if (!record || typeof record.domain !== "string" || !record.domain.trim()) {
        return null;
      }
      return {
        name:
          typeof record.name === "string" && record.name.trim()
            ? record.name.trim()
            : record.domain.trim(),
        domain: normalizeIntegrationDomain(record.domain),
        keySlug: normalizeIntegrationKeySlug(
          typeof record.keySlug === "string" ? record.keySlug : undefined,
        ),
      };
    })
    .filter((item): item is IntegrationSetupTelemetryIntegration => Boolean(item));
}

function missingExpectedIntegrations(
  expected: IntegrationSetupTelemetryIntegration[],
  persisted: SyncedIntegrationRequirement[],
): IntegrationSetupTelemetryIntegration[] {
  const persistedKeys = new Set(
    persisted.map((grant) => `${grant.domain}|${grant.keySlug}`),
  );
  return expected.filter((item) => {
    if (!item.domain || !item.keySlug) return true;
    return !persistedKeys.has(`${item.domain}|${item.keySlug}`);
  });
}

function persistedTelemetryItems(
  grants: SyncedIntegrationRequirement[],
): IntegrationSetupTelemetryIntegration[] {
  return grants.map((grant) => ({
    id: grant.id,
    name: grant.name,
    domain: grant.domain,
    keySlug: grant.keySlug,
  }));
}

export async function POST(request: Request) {
  const authError = validateInternalToken(request);
  if (authError) return authError;

  let body: IntegrationRequirementsRequest;
  try {
    body = (await request.json()) as IntegrationRequirementsRequest;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { workspaceId, appId } = body;
  if (!workspaceId || !appId) {
    return NextResponse.json(
      { success: false, error: "workspaceId and appId are required" },
      { status: 400 },
    );
  }

  const app = await findAppById({ workspaceId, appId });
  if (!app) {
    await reportIntegrationSetupTelemetry({
      status: "failed",
      source: "web_route",
      reason: "app_not_found",
      workspaceId,
      appId,
      runId: body.runId,
      route: "/api/internal/integration-requirements",
      errorMessage: "Integration setup sync failed because the app was not found.",
    });
    return NextResponse.json(
      { success: false, error: "app_not_found" },
      { status: 404 },
    );
  }

  const requester = {
    appId,
    appName: body.appName?.trim() || app.name,
    requestedByUserId: body.requestedByUserId?.trim() || "builder_agent",
    requestedByUserName: body.requestedByUserName?.trim() || "Builder agent",
  };

  const setupConfig = asObject(body.setupConfig);
  if (!setupConfig) {
    await reportIntegrationSetupTelemetry({
      status: "failed",
      source: "web_route",
      reason: "missing_setup_config",
      workspaceId,
      appId,
      runId: body.runId,
      route: "/api/internal/integration-requirements",
      errorMessage: "Integration setup sync failed because setupConfig was missing.",
    });
    return NextResponse.json(
      { success: false, error: "setupConfig is required" },
      { status: 400 },
    );
  }

  const integrations = Array.isArray(setupConfig.integrations)
    ? setupConfig.integrations
    : [];
  const expectedIntegrations = integrationTelemetryItems(setupConfig);
  let syncResult: Awaited<ReturnType<typeof syncIntegrationSetupInstructions>> | null = null;

  try {
    syncResult = await syncIntegrationSetupInstructions({
      workspaceId,
      setupConfig: setupConfig as IntegrationSetupConfig,
      requester,
    });

    const missingIntegrations = missingExpectedIntegrations(
      expectedIntegrations,
      syncResult.grants,
    );
    if (syncResult.skippedCount > 0 || missingIntegrations.length > 0) {
      await reportIntegrationSetupTelemetry({
        status: "verification_failed",
        source: "web_route",
        reason: syncResult.skippedCount > 0
          ? "setup_items_skipped"
          : "missing_persisted_grants",
        workspaceId,
        appId,
        runId: body.runId,
        route: "/api/internal/integration-requirements",
        expectedIntegrations,
        persistedIntegrations: persistedTelemetryItems(syncResult.grants),
        requestedCount: syncResult.requestedCount,
        syncedCount: syncResult.grants.length,
        skippedCount: syncResult.skippedCount,
        deletedStaleCount: syncResult.deletedStaleCount,
        errorMessage:
          "Integration setup sync did not persist every requested integration requirement.",
      });
      return NextResponse.json(
        {
          success: false,
          error: "integration_sync_incomplete",
          grants: syncResult.grants,
          syncedCount: syncResult.grants.length,
          requestedCount: syncResult.requestedCount,
          skippedCount: syncResult.skippedCount,
          deletedStaleCount: syncResult.deletedStaleCount,
        },
        { status: 500 },
      );
    }

    await Promise.all(
      integrations.map(async (item) => {
        const record = asObject(item);
        if (!record) return;
        const name =
          typeof record.name === "string" && record.name.trim()
            ? record.name.trim()
            : "Integration";
        const domain =
          typeof record.domain === "string" && record.domain.trim()
            ? record.domain.trim()
            : undefined;
        const secretItems = record.secrets ?? record.secretRequirements;
        const auth = asObject(record.auth);

        await recordAuditEvent({
          workspaceId,
          eventName: "integration.requested",
          category: "integrations",
          severity: "info",
          outcome: "success",
          actor: {
            kind: "worker",
            userId: body.requestedByUserId,
            displayName: body.requestedByUserName,
          },
          source: {
            kind: "builder_agent",
            trust: "internal_trusted",
            appId,
            appName: body.appName?.trim() || app.name,
          },
          target: {
            type: "integration",
            name,
            parentType: "app",
            parentId: appId,
          },
          action: "requested",
          summary: `Builder requested integration setup for ${name}.`,
          metadata: {
            domain,
            keySlug:
              typeof record.keySlug === "string" && record.keySlug.trim()
                ? record.keySlug.trim()
                : "default",
            permissionGroupNames: Array.isArray(record.permissionGroups)
              ? record.permissionGroups
                  .map((group) => asObject(group)?.name)
                  .filter((value): value is string => typeof value === "string")
              : [],
            secretNames: Array.isArray(secretItems)
              ? secretItems
                  .map((secret) => asObject(secret)?.name)
                  .filter((value): value is string => typeof value === "string")
              : [],
            authType: auth?.type === "oauth2" ? "oauth2" : "static_secret",
            providerKey:
              auth?.type === "oauth2" && typeof auth.providerKey === "string"
                ? auth.providerKey
                : undefined,
            oauthScopes:
              auth?.type === "oauth2" && Array.isArray(auth.scopes)
                ? auth.scopes.filter((scope): scope is string => typeof scope === "string")
                : undefined,
          },
          relatedIds: { appId },
        });
      }),
    );

    await reportIntegrationSetupTelemetry({
      status: "succeeded",
      source: "web_route",
      reason: "persisted",
      workspaceId,
      appId,
      runId: body.runId,
      route: "/api/internal/integration-requirements",
      expectedIntegrations,
      persistedIntegrations: persistedTelemetryItems(syncResult.grants),
      requestedCount: syncResult.requestedCount,
      syncedCount: syncResult.grants.length,
      skippedCount: syncResult.skippedCount,
      deletedStaleCount: syncResult.deletedStaleCount,
    });

    return NextResponse.json({
      success: true,
      grants: syncResult.grants,
      syncedCount: syncResult.grants.length,
      requestedCount: syncResult.requestedCount,
      skippedCount: syncResult.skippedCount,
      deletedStaleCount: syncResult.deletedStaleCount,
    });
  } catch (error) {
    await reportIntegrationSetupTelemetry({
      status: "failed",
      source: "web_route",
      reason: "web_route_exception",
      workspaceId,
      appId,
      runId: body.runId,
      route: "/api/internal/integration-requirements",
      error,
      expectedIntegrations,
      persistedIntegrations: syncResult ? persistedTelemetryItems(syncResult.grants) : [],
      requestedCount: syncResult?.requestedCount ?? expectedIntegrations.length,
      syncedCount: syncResult?.grants.length ?? 0,
      skippedCount: syncResult?.skippedCount ?? null,
      deletedStaleCount: syncResult?.deletedStaleCount ?? null,
    });
    return NextResponse.json(
      { success: false, error: "integration_sync_failed" },
      { status: 500 },
    );
  }
}
