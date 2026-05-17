import dns from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { validateInternalToken } from "@/lib/auth/internal-auth";
import { recordAuditEvent } from "@/lib/audit/record";
import {
  getDraftAgentsJsonApproval,
  stableJsonStringify,
} from "@/lib/agents/agents-governance";
import {
  findConnectedAccountForUserProvider,
  findAppById,
  findIntegrationGrantForTool,
  findOAuthProviderConfigForWorkspace,
  getAppSourceFilesForVersion,
  integrationNeedsSetup,
  loadAppAgentRunTriggerForTool,
  normalizeIntegrationAuthConfig,
  normalizeIntegrationKeySlug,
  scopesIncludeAll,
} from "@/lib/db";
import type { IntegrationAuthConfig, IntegrationGrantWithCredential } from "@/lib/db";
import { getValidOAuthAccessToken } from "@/lib/oauth/token-broker";
import { isVaultConfigured, readSecret } from "@/lib/vault";

const TOOL_EXECUTE_TIMEOUT = 30_000; // 30 seconds
const MAX_RESPONSE_SIZE = 1_024 * 1_024; // 1MB

type ToolEndpoint = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: unknown;
};

type ToolExecuteRequest = {
  workspaceId: string;
  appId: string;
  runId?: string;
  sourceVersion?: "draft" | "published";
  agentId?: string;
  toolName: string;
  toolSpec: {
    endpoint: ToolEndpoint;
    integration: { domain: string; keySlug?: string; auth?: unknown };
    mockData: unknown[];
  };
  toolInput: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolIntegration(value: unknown): {
  name?: string;
  domain?: string;
  keySlug: string;
  auth: IntegrationAuthConfig;
} | null {
  if (!isRecord(value)) return null;
  return {
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.domain === "string" ? { domain: value.domain } : {}),
    keySlug: normalizeIntegrationKeySlug(
      typeof value.keySlug === "string" ? value.keySlug : undefined,
    ),
    auth: normalizeIntegrationAuthConfig(value.auth),
  };
}

function oauthAuthsMatch(
  left: IntegrationAuthConfig,
  right: IntegrationAuthConfig,
): boolean {
  if (left.type !== right.type) return false;
  if (left.type !== "oauth2" || right.type !== "oauth2") return true;
  return stableJsonStringify({
    providerKey: left.providerKey,
    identity: left.identity,
    authorizationUrl: left.authorizationUrl,
    tokenUrl: left.tokenUrl,
    scopes: [...left.scopes].sort(),
    tokenAuthMethod: left.tokenAuthMethod ?? "client_secret_post",
    authorizationParams: left.authorizationParams ?? {},
    tokenParams: left.tokenParams ?? {},
  }) === stableJsonStringify({
    providerKey: right.providerKey,
    identity: right.identity,
    authorizationUrl: right.authorizationUrl,
    tokenUrl: right.tokenUrl,
    scopes: [...right.scopes].sort(),
    tokenAuthMethod: right.tokenAuthMethod ?? "client_secret_post",
    authorizationParams: right.authorizationParams ?? {},
    tokenParams: right.tokenParams ?? {},
  });
}

function approvedAgentsPayloadIncludesTool(input: {
  payload: unknown;
  toolName: string;
  toolSpec: ToolExecuteRequest["toolSpec"];
  agentId?: string;
}): boolean {
  const requestedAgentId = input.agentId?.trim();
  if (!requestedAgentId) return false;
  if (!isRecord(input.payload) || !Array.isArray(input.payload.agents)) {
    return false;
  }

  for (const agent of input.payload.agents) {
    if (!isRecord(agent) || !Array.isArray(agent.tools)) continue;
    if (agent.id !== requestedAgentId) continue;
    for (const tool of agent.tools) {
      if (!isRecord(tool)) continue;
      if (tool.type !== "custom" || tool.enabled === false) continue;
      if (tool.name !== input.toolName) continue;

      const approvedSpec = {
        endpoint: tool.endpoint ?? null,
        integration: normalizeToolIntegration(tool.integration),
      };
      const requestedSpec = {
        endpoint: input.toolSpec.endpoint,
        integration: normalizeToolIntegration(input.toolSpec.integration),
      };

      if (stableJsonStringify(approvedSpec) === stableJsonStringify(requestedSpec)) {
        return true;
      }
    }
  }

  return false;
}

function pickMockData(toolSpec: ToolExecuteRequest["toolSpec"]): unknown {
  const mockData = Array.isArray(toolSpec.mockData) ? toolSpec.mockData : [];
  return mockData.length > 0
    ? mockData[Math.floor(Math.random() * mockData.length)]
    : { message: "No mock data is configured for this tool." };
}

function mockResponse(
  toolSpec: ToolExecuteRequest["toolSpec"],
  reason: string,
) {
  return NextResponse.json({
    success: true,
    data: pickMockData(toolSpec),
    mock: true,
    mockReason: reason,
  });
}

async function recordToolAuditEvent(input: {
  body: ToolExecuteRequest;
  appName?: string;
  eventName: "tool.custom.executed" | "tool.custom.denied" | "tool.custom.mocked" | "tool.custom.failed";
  outcome: "success" | "failure" | "denied";
  severity?: "info" | "notice" | "warning" | "error";
  summary: string;
  metadata?: Record<string, unknown>;
  integration?: IntegrationGrantWithCredential | null;
}) {
  await recordAuditEvent({
    workspaceId: input.body.workspaceId,
    eventName: input.eventName,
    category: "tools",
    severity: input.severity ?? "info",
    outcome: input.outcome,
    actor: {
      kind: "agent",
      agentId: input.body.agentId,
      agentName: input.body.agentId,
    },
    source: {
      kind: "app_agent",
      trust: "internal_trusted",
      appId: input.body.appId,
      appName: input.appName,
      sourceVersion: input.body.sourceVersion ?? "published",
      runId: input.body.runId,
    },
    target: {
      type: "tool",
      id: input.body.toolName,
      name: input.body.toolName,
      parentType: "app",
      parentId: input.body.appId,
    },
    action: input.eventName.split(".").at(-1) ?? "executed",
    summary: input.summary,
    metadata: {
      toolName: input.body.toolName,
      integrationDomain: input.body.toolSpec?.integration?.domain,
      integrationKeySlug: normalizeIntegrationKeySlug(
        input.body.toolSpec?.integration?.keySlug,
      ),
      integrationId: input.integration?._id,
      integrationName: input.integration?.name,
      appId: input.integration?.appId,
      credentialId: input.integration?.credentialId,
      sourceVersion: input.body.sourceVersion ?? "published",
      runId: input.body.runId,
      ...input.metadata,
    },
    relatedIds: {
      appId: input.body.appId,
      agentRunId: input.body.runId,
      integrationId: input.integration?._id,
    },
  });
}

function missingInputResponse(missingPlaceholders: Set<string>) {
  return NextResponse.json(
    {
      success: false,
      error: `Missing tool input value(s): ${[...missingPlaceholders].join(", ")}`,
      mock: false,
    },
    { status: 400 },
  );
}

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

function readToolInputValue(
  toolInput: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split(".");
  let current: unknown = toolInput;

  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function stringifyTemplateValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function isSecretPlaceholderName(name: string): boolean {
  return name.startsWith("secrets.") && name.length > "secrets.".length;
}

function isSecretLikePlaceholderName(name: string): boolean {
  if (isSecretPlaceholderName(name)) return false;
  return /(^|[_.-])(api[_-]?key|key|secret|token|password|bearer|auth)([_.-]|$)/i.test(
    name,
  );
}

function endpointDeclaresAuthorizationHeader(endpoint: ToolEndpoint): boolean {
  return Object.keys(endpoint.headers ?? {}).some(
    (name) => name.toLowerCase() === "authorization",
  );
}

function isPublicUnauthenticatedToolSpec(input: {
  endpoint: ToolEndpoint;
  integrationAuth: unknown;
}): boolean {
  const auth = isRecord(input.integrationAuth) ? input.integrationAuth : null;
  if (auth && auth.type !== "none") return false;
  if (endpointDeclaresAuthorizationHeader(input.endpoint)) return false;

  const templateNames = new Set<string>();
  collectAllTemplateNames(input.endpoint, templateNames);
  return (
    ![...templateNames].some(isSecretPlaceholderName) &&
    ![...templateNames].some(isSecretLikePlaceholderName)
  );
}

function readNamedSecret(
  secrets: Record<string, string>,
  placeholderName: string,
): string | null {
  if (!isSecretPlaceholderName(placeholderName)) return null;
  const secretName = placeholderName.slice("secrets.".length);
  return secrets[secretName] ?? null;
}

async function readIntegrationSecrets(
  integration: IntegrationGrantWithCredential,
): Promise<Record<string, string>> {
  if (isVaultConfigured()) {
    const secrets: Record<string, string> = {};
    for (const [name, vaultSecretId] of Object.entries(
      integration.vaultSecretIds ?? {},
    )) {
      secrets[name] = await readSecret(vaultSecretId);
    }
    return secrets;
  }

  return integration.localSecrets ?? {};
}

function substituteTemplate(
  template: string,
  secrets: Record<string, string>,
  toolInput: Record<string, unknown>,
  missingPlaceholders: Set<string>,
  missingSecretPlaceholders: Set<string>,
): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (placeholder, name: string) => {
      if (isSecretPlaceholderName(name)) {
        const value = readNamedSecret(secrets, name);
        if (value === null) {
          missingSecretPlaceholders.add(name.slice("secrets.".length));
          return placeholder;
        }
        return value;
      }

      const value = stringifyTemplateValue(readToolInputValue(toolInput, name));
      if (value === null) {
        missingPlaceholders.add(name);
        return placeholder;
      }

      return value;
    },
  );
}

function substituteTemplatesInHeaders(
  headers: Record<string, string>,
  secrets: Record<string, string>,
  toolInput: Record<string, unknown>,
  missingPlaceholders: Set<string>,
  missingSecretPlaceholders: Set<string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = substituteTemplate(
      value,
      secrets,
      toolInput,
      missingPlaceholders,
      missingSecretPlaceholders,
    );
  }
  return result;
}

function substituteTemplatesInBody(
  body: unknown,
  secrets: Record<string, string>,
  toolInput: Record<string, unknown>,
  missingPlaceholders: Set<string>,
  missingSecretPlaceholders: Set<string>,
): unknown {
  if (typeof body === "string") {
    return substituteTemplate(
      body,
      secrets,
      toolInput,
      missingPlaceholders,
      missingSecretPlaceholders,
    );
  }

  if (Array.isArray(body)) {
    return body.map((value) =>
      substituteTemplatesInBody(
        value,
        secrets,
        toolInput,
        missingPlaceholders,
        missingSecretPlaceholders,
      ),
    );
  }

  if (body && typeof body === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      result[key] = substituteTemplatesInBody(
        value,
        secrets,
        toolInput,
        missingPlaceholders,
        missingSecretPlaceholders,
      );
    }
    return result;
  }

  return body;
}

function collectInputPlaceholders(
  value: unknown,
  placeholders: Set<string>,
): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) {
      const name = match[1];
      if (name && !isSecretPlaceholderName(name)) placeholders.add(name);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectInputPlaceholders(item, placeholders);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectInputPlaceholders(item, placeholders);
    }
  }
}

function collectAllTemplateNames(value: unknown, names: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) {
      if (match[1]) names.add(match[1]);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectAllTemplateNames(item, names);
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectAllTemplateNames(item, names);
  }
}

function hasProvidedToolInput(toolInput: Record<string, unknown>): boolean {
  return Object.values(toolInput).some((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  });
}

function isLoopbackHostname(hostname: string): boolean {
  return /^(localhost|127\.0\.0\.1|::1)$/i.test(hostname);
}

function isPrivateIP(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (
    normalized.startsWith("10.") ||
    normalized.startsWith("127.") ||
    normalized.startsWith("192.168.") ||
    normalized.startsWith("169.254.") ||
    normalized === "0.0.0.0"
  ) {
    return true;
  }

  if (normalized.startsWith("172.")) {
    const secondOctet = Number.parseInt(normalized.split(".")[1] ?? "", 10);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }

  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    normalized.startsWith("::ffff:169.254.")
  ) {
    return true;
  }

  if (normalized.startsWith("::ffff:172.")) {
    const secondOctet = Number.parseInt(
      normalized.split(".")[1]?.split(":").pop() ?? "",
      10,
    );
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }

  return false;
}

async function resolveHostnameIps(hostname: string): Promise<string[]> {
  if (isIP(hostname)) {
    return [hostname];
  }

  const [ipv4, ipv6] = await Promise.all([
    dns.resolve4(hostname).catch(() => [] as string[]),
    dns.resolve6(hostname).catch(() => [] as string[]),
  ]);

  return [...ipv4, ...ipv6];
}

export async function POST(request: Request) {
  const authError = validateInternalToken(request);
  if (authError) return authError;

  const body = (await request.json()) as ToolExecuteRequest;
  const { workspaceId, appId, toolSpec } = body;
  const toolInput = body.toolInput ?? {};

  if (!workspaceId || !appId || !body.agentId || !body.toolName || !toolSpec) {
    return NextResponse.json(
      {
        success: false,
        error: "workspaceId, appId, agentId, toolName, and toolSpec are required",
        mock: false,
      },
      { status: 400 },
    );
  }

  const app = await findAppById({ workspaceId, appId });
  if (!app) {
    return NextResponse.json(
      {
        success: false,
        error: "App was not found for approved agents.json enforcement.",
        mock: false,
      },
      { status: 403 },
    );
  }
  const auditedApp = app;

  async function auditedMockResponse(
    reason: string,
    integration?: IntegrationGrantWithCredential | null,
  ) {
    await recordToolAuditEvent({
      body,
      appName: auditedApp.name,
      integration,
      eventName: "tool.custom.mocked",
      outcome: "success",
      severity: "info",
      summary: `Used mock data for custom tool ${body.toolName}.`,
      metadata: { reason, mock: true },
    });
    return mockResponse(toolSpec, reason);
  }

  async function auditedDeniedResponse(
    error: string,
    status: number,
    metadata: Record<string, unknown> = {},
  ) {
    await recordToolAuditEvent({
      body,
      appName: auditedApp.name,
      eventName: "tool.custom.denied",
      outcome: "denied",
      severity: "warning",
      summary: `Denied custom tool ${body.toolName}.`,
      metadata: { error, httpStatus: status, ...metadata },
    });
    return NextResponse.json(
      { success: false, error, mock: false },
      { status },
    );
  }

  async function auditedFailureResponse(
    error: string,
    status: number,
    metadata: Record<string, unknown> = {},
    integration?: IntegrationGrantWithCredential | null,
  ) {
    await recordToolAuditEvent({
      body,
      appName: auditedApp.name,
      integration,
      eventName: "tool.custom.failed",
      outcome: "failure",
      severity: "error",
      summary: `Custom tool ${body.toolName} failed.`,
      metadata: { error, httpStatus: status, ...metadata },
    });
    return NextResponse.json(
      { success: false, error, mock: false },
      { status },
    );
  }

  if (body.sourceVersion === "draft") {
    const sourceFiles = await getAppSourceFilesForVersion({
      workspaceId,
      appId,
      version: "draft",
    });
    const approval = getDraftAgentsJsonApproval({
      app,
      sourceFiles,
    });
    const approvedTool =
      !!app.agentsJsonApprovedPayload &&
      approvedAgentsPayloadIncludesTool({
        payload: app.agentsJsonApprovedPayload,
        agentId: body.agentId,
        toolName: body.toolName,
        toolSpec,
      });
    if (!approval?.approved || !approvedTool) {
      return auditedDeniedResponse(
        "Draft agents.json must be approved before live tools can run.",
        403,
        { reason: "draft_agents_config_unapproved" },
      );
    }
    if (app.agentsJsonApprovalSource === "build_chat_mock") {
      return auditedMockResponse(
        "Draft agents.json was approved for mock-data development. Real data from integrations requires review by a workspace admin or owner.",
      );
    }
  } else {
    if (
      !app.publishedAgentsJsonApprovedPayload ||
      !approvedAgentsPayloadIncludesTool({
        payload: app.publishedAgentsJsonApprovedPayload,
        agentId: body.agentId,
        toolName: body.toolName,
        toolSpec,
      })
    ) {
      return auditedDeniedResponse(
        "Tool is not part of the published approved agents.json.",
        403,
        { reason: "published_agents_config_missing_tool" },
      );
    }
  }

  if (!toolSpec.endpoint || !toolSpec.integration?.domain) {
    return auditedDeniedResponse(
      "Custom tools require endpoint and integration.domain",
      400,
      { reason: "invalid_tool_spec" },
    );
  }

  const keySlug = normalizeIntegrationKeySlug(toolSpec.integration.keySlug);
  const requestedAuth = normalizeIntegrationAuthConfig(toolSpec.integration.auth);
  const isPublicUnauthenticated = isPublicUnauthenticatedToolSpec({
    endpoint: toolSpec.endpoint,
    integrationAuth: toolSpec.integration.auth,
  });
  const integration = isPublicUnauthenticated
    ? null
    : await findIntegrationGrantForTool({
        workspaceId,
        appId,
        domain: toolSpec.integration.domain,
        keySlug,
      });

  if (!isPublicUnauthenticated && !integration) {
    return auditedMockResponse(
      "No app-scoped integration grant matched this tool domain and key.",
      integration,
    );
  }

  const grantAuth = integration?.auth ?? { type: "static_secret" as const };
  if (!isPublicUnauthenticated && !oauthAuthsMatch(requestedAuth, grantAuth)) {
    return auditedDeniedResponse(
      "Tool auth metadata does not match this app's integration grant.",
      403,
      { reason: "integration_auth_mismatch", authType: requestedAuth.type },
    );
  }

  let secrets: Record<string, string> = {};
  let oauthAccessToken: string | null = null;

  if (grantAuth.type === "oauth2") {
    if (!body.runId) {
      return auditedDeniedResponse(
        "OAuth custom tools require a server-created app-agent run ID.",
        400,
        { reason: "missing_run_id" },
      );
    }

    const run = await loadAppAgentRunTriggerForTool({
      runId: body.runId,
      workspaceId,
      appId,
    });
    if (!run?.triggeredByUserId) {
      return auditedDeniedResponse(
        "OAuth custom tools require a run with a triggering user.",
        403,
        { reason: "missing_triggering_user" },
      );
    }

    const providerConfig = await findOAuthProviderConfigForWorkspace({
      workspaceId,
      providerKey: grantAuth.providerKey,
    });
    if (
      !providerConfig ||
      !providerConfig.configured ||
      providerConfig.authorizationUrl !== grantAuth.authorizationUrl ||
      providerConfig.tokenUrl !== grantAuth.tokenUrl ||
      providerConfig.tokenAuthMethod !==
        (grantAuth.tokenAuthMethod ?? "client_secret_post")
    ) {
      return auditedMockResponse(
        "OAuth provider is not configured for this app's approved auth metadata.",
        integration,
      );
    }

    const connectedAccount = await findConnectedAccountForUserProvider({
      workspaceId,
      userId: run.triggeredByUserId,
      providerConfigId: providerConfig._id,
    });
    if (!connectedAccount || connectedAccount.revokedAt) {
      return auditedMockResponse(
        "The triggering user must connect this OAuth account before the tool can run.",
        integration,
      );
    }
    if (
      !scopesIncludeAll({
        grantedScopes: connectedAccount.grantedScopes,
        requiredScopes: grantAuth.scopes,
      })
    ) {
      return auditedMockResponse(
        "The connected OAuth account is missing required scopes. Reconnect the account.",
        integration,
      );
    }

    try {
      const tokenResult = await getValidOAuthAccessToken({
        workspaceId,
        userId: run.triggeredByUserId,
        providerConfig,
        auth: grantAuth,
      });
      oauthAccessToken = tokenResult.accessToken;
      if (tokenResult.refreshed) {
        await recordAuditEvent({
          workspaceId,
          eventName: "oauth.token_refreshed",
          category: "integrations",
          severity: "info",
          outcome: "success",
          actor: {
            kind: "agent",
            agentId: body.agentId,
            agentName: body.agentId,
          },
          source: {
            kind: "app_agent",
            trust: "internal_trusted",
            appId,
            appName: auditedApp.name,
            sourceVersion: body.sourceVersion ?? "published",
            runId: body.runId,
          },
          target: {
            type: "connected_account",
            id: tokenResult.account._id,
            name: tokenResult.account.providerKey,
            parentType: "oauth_provider_config",
            parentId: providerConfig._id,
          },
          action: "token_refreshed",
          summary: `Refreshed OAuth access token for ${providerConfig.displayName}.`,
          metadata: {
            providerKey: grantAuth.providerKey,
            providerConfigId: providerConfig._id,
            integrationId: integration?._id,
            toolName: body.toolName,
            runId: body.runId,
          },
          relatedIds: {
            appId,
            agentRunId: body.runId,
            integrationId: integration?._id,
          },
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "OAuth token refresh failed";
      return auditedFailureResponse(
        message,
        502,
        {
          reason: "oauth_token_broker_failed",
          authType: "oauth2",
          providerKey: grantAuth.providerKey,
          providerConfigId: providerConfig._id,
        },
        integration,
      );
    }
  } else if (!isPublicUnauthenticated) {
    if (!integration) {
      return auditedDeniedResponse(
        "Static custom tools require an app-scoped integration grant.",
        403,
        { reason: "integration_missing" },
      );
    }
    if (integrationNeedsSetup(integration)) {
      return auditedMockResponse(
        "This app's integration key is not configured for the requested permissions or secrets.",
        integration,
      );
    }
    try {
      secrets = await readIntegrationSecrets(integration);
      if (Object.keys(secrets).length === 0) {
        return auditedMockResponse(
          "Integration is marked configured, but no secrets are available.",
          integration,
        );
      }
    } catch (err) {
      console.error("[tool-execute] Failed to read secret:", err);
      return auditedFailureResponse("Failed to read secret", 500, {}, integration);
    }
  }

  const endpoint = toolSpec.endpoint;
  if (grantAuth.type === "oauth2") {
    const allTemplateNames = new Set<string>();
    collectAllTemplateNames(endpoint, allTemplateNames);
    const secretPlaceholders = [...allTemplateNames].filter(
      isSecretPlaceholderName,
    );
    const tokenPlaceholders = [...allTemplateNames].filter((name) =>
      /(^|[_.-])(oauth|access[_-]?token|refresh[_-]?token|bearer|token|secret)([_.-]|$)/i.test(
        name,
      ),
    );
    if (secretPlaceholders.length > 0 || tokenPlaceholders.length > 0) {
      return auditedDeniedResponse(
        "OAuth custom tools must not include token or secret placeholders. The broker injects the access token server-side.",
        400,
        {
          reason: "oauth_token_placeholder_rejected",
          secretPlaceholders,
          tokenPlaceholders,
        },
      );
    }
    const headerKeys = Object.keys(endpoint.headers ?? {}).map((key) =>
      key.toLowerCase(),
    );
    if (headerKeys.includes("authorization")) {
      return auditedDeniedResponse(
        "OAuth custom tools must not declare their own Authorization header.",
        400,
        { reason: "oauth_authorization_header_rejected" },
      );
    }
  }

  const inputPlaceholders = new Set<string>();
  collectInputPlaceholders(endpoint.url, inputPlaceholders);
  collectInputPlaceholders(endpoint.headers, inputPlaceholders);
  collectInputPlaceholders(endpoint.queryParams, inputPlaceholders);
  collectInputPlaceholders(endpoint.body, inputPlaceholders);

  if (hasProvidedToolInput(toolInput) && inputPlaceholders.size === 0) {
    return auditedDeniedResponse(
      "Tool input was provided, but this endpoint does not use any input placeholders. Add placeholders like {{symbol}} or {{query}} to the endpoint spec to avoid static bulk API calls.",
      400,
      { reason: "static_bulk_endpoint_guard" },
    );
  }

  const missingPlaceholders = new Set<string>();
  const missingSecretPlaceholders = new Set<string>();
  let url = substituteTemplate(
    endpoint.url,
    secrets,
    toolInput,
    missingPlaceholders,
    missingSecretPlaceholders,
  );
  if (missingSecretPlaceholders.size > 0) {
    return auditedMockResponse(
      `Integration is missing configured secret(s): ${[...missingSecretPlaceholders].join(", ")}.`,
      integration,
    );
  }
  if (missingPlaceholders.size > 0) {
    return missingInputResponse(missingPlaceholders);
  }

  if (endpoint.queryParams) {
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      return auditedDeniedResponse("Invalid URL", 400, {
        reason: "invalid_url",
      });
    }

    for (const [key, value] of Object.entries(endpoint.queryParams)) {
      urlObj.searchParams.set(
        key,
        substituteTemplate(
          value,
          secrets,
          toolInput,
          missingPlaceholders,
          missingSecretPlaceholders,
        ),
      );
    }
    url = urlObj.toString();
  }

  if (missingSecretPlaceholders.size > 0) {
    return auditedMockResponse(
      `Integration is missing configured secret(s): ${[...missingSecretPlaceholders].join(", ")}.`,
      integration,
    );
  }
  if (missingPlaceholders.size > 0) {
    return missingInputResponse(missingPlaceholders);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return auditedDeniedResponse("Invalid URL", 400, {
      reason: "invalid_url",
    });
  }

  const integrationDomain = normalizeDomain(toolSpec.integration.domain);
  const resolvedHostname = parsedUrl.hostname.toLowerCase();

  if (
    !integrationDomain ||
    (
      resolvedHostname !== integrationDomain &&
      !resolvedHostname.endsWith(`.${integrationDomain}`)
    )
  ) {
    return auditedDeniedResponse(
      `URL hostname "${parsedUrl.hostname}" does not match integration domain "${toolSpec.integration.domain}"`,
      400,
      {
        reason: "domain_lock_failed",
        hostname: parsedUrl.hostname,
        integrationDomain: toolSpec.integration.domain,
      },
    );
  }

  if (process.env.NODE_ENV === "production") {
    if (parsedUrl.protocol !== "https:") {
      return auditedDeniedResponse(
        "Only HTTPS URLs are allowed in production",
        400,
        { reason: "https_required", protocol: parsedUrl.protocol },
      );
    }
  } else if (
    parsedUrl.protocol !== "https:" &&
    !isLoopbackHostname(parsedUrl.hostname)
  ) {
    return auditedDeniedResponse(
      "Only HTTPS or localhost HTTP URLs are allowed",
      400,
      { reason: "https_or_localhost_required", protocol: parsedUrl.protocol },
    );
  }

  if (!(process.env.NODE_ENV !== "production" && isLoopbackHostname(parsedUrl.hostname))) {
    const resolvedIPs = await resolveHostnameIps(parsedUrl.hostname);
    for (const ip of resolvedIPs) {
      if (isPrivateIP(ip)) {
        return auditedDeniedResponse(
          "Requests to private/internal IPs are not allowed",
          400,
          { reason: "private_ip_blocked", hostname: parsedUrl.hostname },
        );
      }
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(endpoint.headers
      ? substituteTemplatesInHeaders(
          endpoint.headers,
          secrets,
          toolInput,
          missingPlaceholders,
          missingSecretPlaceholders,
        )
      : {}),
  };
  if (grantAuth.type === "oauth2") {
    if (!oauthAccessToken) {
      return auditedFailureResponse(
        "OAuth token broker did not return an access token.",
        502,
        { reason: "oauth_missing_access_token" },
        integration,
      );
    }
    headers.Authorization = `Bearer ${oauthAccessToken}`;
  }

  if (missingSecretPlaceholders.size > 0) {
    return auditedMockResponse(
      `Integration is missing configured secret(s): ${[...missingSecretPlaceholders].join(", ")}.`,
      integration,
    );
  }
  if (missingPlaceholders.size > 0) {
    return missingInputResponse(missingPlaceholders);
  }

  const fetchInit: RequestInit = {
    method: endpoint.method.toUpperCase(),
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(TOOL_EXECUTE_TIMEOUT),
  };

  if (
    endpoint.body &&
    ["POST", "PUT", "PATCH"].includes(endpoint.method.toUpperCase())
  ) {
    const substitutedBody = substituteTemplatesInBody(
      endpoint.body,
      secrets,
      toolInput,
      missingPlaceholders,
      missingSecretPlaceholders,
    );
    if (missingSecretPlaceholders.size > 0) {
      return auditedMockResponse(
        `Integration is missing configured secret(s): ${[...missingSecretPlaceholders].join(", ")}.`,
        integration,
      );
    }
    if (missingPlaceholders.size > 0) {
      return missingInputResponse(missingPlaceholders);
    }
    fetchInit.body =
      typeof substitutedBody === "string"
        ? substitutedBody
        : JSON.stringify(substitutedBody);
  }

  try {
    const response = await fetch(url, fetchInit);

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      return auditedFailureResponse(
        "Response too large",
        502,
        {
          statusCode: response.status,
          responseSizeExceeded: true,
        },
        integration,
      );
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_SIZE) {
      return auditedFailureResponse(
        "Response too large",
        502,
        {
          statusCode: response.status,
          responseSizeExceeded: true,
        },
        integration,
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    await recordToolAuditEvent({
      body,
      appName: app.name,
      integration,
      eventName: response.ok ? "tool.custom.executed" : "tool.custom.failed",
      outcome: response.ok ? "success" : "failure",
      severity: response.ok ? "info" : "warning",
      summary: response.ok
        ? `Executed custom tool ${body.toolName}.`
        : `Custom tool ${body.toolName} returned HTTP ${response.status}.`,
      metadata: {
        method: endpoint.method.toUpperCase(),
        hostname: parsedUrl.hostname,
        statusCode: response.status,
        mock: false,
        authType: isPublicUnauthenticated ? "none" : grantAuth.type,
        ...(grantAuth.type === "oauth2"
          ? { providerKey: grantAuth.providerKey }
          : {}),
      },
    });

    return NextResponse.json({
      success: response.ok,
      data,
      mock: false,
      statusCode: response.status,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Request failed";
    return auditedFailureResponse(
      message,
      502,
      {
        method: endpoint.method.toUpperCase(),
        hostname: parsedUrl.hostname,
      },
      integration,
    );
  }
}
