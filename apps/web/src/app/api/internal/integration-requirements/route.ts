import { NextResponse } from "next/server";
import { validateInternalToken } from "@/lib/auth/internal-auth";
import { recordAuditEvent } from "@/lib/audit/record";
import {
  findAppById,
  syncIntegrationSetupInstructions,
} from "@/lib/db";
import type { IntegrationSetupConfig } from "@/lib/db/repositories/integrations";

type IntegrationRequirementsRequest = {
  workspaceId: string;
  appId: string;
  appName?: string;
  requestedByUserId?: string;
  requestedByUserName?: string;
  setupConfig?: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
    return NextResponse.json(
      { success: false, error: "setupConfig is required" },
      { status: 400 },
    );
  }

  await syncIntegrationSetupInstructions({
    workspaceId,
    setupConfig: setupConfig as IntegrationSetupConfig,
    requester,
  });

  const integrations = Array.isArray(setupConfig.integrations)
    ? setupConfig.integrations
    : [];
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

  return NextResponse.json({ success: true });
}
