import dns from "node:dns/promises";
import { isIP } from "node:net";
import { stableJsonStringify } from "@/lib/agents/agents-governance";
import {
  findConnectedAccountForUserProvider,
  findIntegrationGrantForTool,
  findOAuthProviderConfigForWorkspace,
  integrationNeedsSetup,
  loadAppAgentRunTriggerForTool,
  normalizeIntegrationAuthConfig,
  normalizeIntegrationKeySlug,
  scopesIncludeAll,
} from "@/lib/db";
import type {
  IntegrationAuthConfig,
  IntegrationGrantWithCredential,
  OAuthProviderConfigDocument,
} from "@/lib/db";
import { getValidOAuthAccessToken } from "@/lib/oauth/token-broker";
import { isVaultConfigured, readSecret } from "@/lib/vault";

const TOOL_EXECUTE_TIMEOUT = 30_000; // 30 seconds
const MAX_RESPONSE_SIZE = 1_024 * 1_024; // 1MB

export type ToolEndpoint = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: unknown;
};

export type CustomHttpActionSpec = {
  type?: "custom";
  name?: string;
  displayName?: string;
  description?: string;
  enabled?: boolean;
  endpoint: ToolEndpoint;
  integration: {
    name?: string;
    domain?: string;
    keySlug?: string;
    auth?: unknown;
  };
  mockData?: unknown;
  responseSchema?: unknown;
};

export type IntegrationActionResponseBody = {
  success: boolean;
  data?: unknown;
  error?: string;
  mock: boolean;
  mockReason?: string;
  statusCode?: number;
};

export type IntegrationActionAudit = {
  eventName:
    | "tool.custom.executed"
    | "tool.custom.denied"
    | "tool.custom.mocked"
    | "tool.custom.failed";
  outcome: "success" | "failure" | "denied";
  severity: "info" | "notice" | "warning" | "error";
  summary: string;
  metadata: Record<string, unknown>;
  integration?: IntegrationGrantWithCredential | null;
};

export type IntegrationActionExecutionResult = {
  status: number;
  body: IntegrationActionResponseBody;
  audit: IntegrationActionAudit;
};

export type OAuthExecutionIdentity =
  | { kind: "app_agent"; runId?: string }
  | { kind: "app_runtime"; userId: string };

export type OAuthTokenRefreshAuditInput = {
  userId: string;
  providerConfig: OAuthProviderConfigDocument;
  auth: Extract<IntegrationAuthConfig, { type: "oauth2" }>;
  integration: IntegrationGrantWithCredential | null;
  accountId: string;
  accountProviderKey: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeToolIntegration(value: unknown): {
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

export function oauthAuthsMatch(
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

export function approvedAgentsPayloadIncludesTool(input: {
  payload: unknown;
  toolName: string;
  toolSpec: CustomHttpActionSpec;
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

export function findApprovedAppTool(input: {
  payload: unknown;
  toolName: string;
}): CustomHttpActionSpec | null {
  if (!isRecord(input.payload) || !Array.isArray(input.payload.appTools)) {
    return null;
  }

  for (const tool of input.payload.appTools) {
    if (!isRecord(tool)) continue;
    if (tool.type !== "custom" || tool.enabled === false) continue;
    if (tool.name !== input.toolName) continue;
    if (!isRecord(tool.endpoint) || !isRecord(tool.integration)) continue;

    return {
      type: "custom",
      name: typeof tool.name === "string" ? tool.name : input.toolName,
      displayName: typeof tool.displayName === "string" ? tool.displayName : undefined,
      description: typeof tool.description === "string" ? tool.description : undefined,
      enabled: typeof tool.enabled === "boolean" ? tool.enabled : true,
      endpoint: {
        method: typeof tool.endpoint.method === "string" ? tool.endpoint.method : "",
        url: typeof tool.endpoint.url === "string" ? tool.endpoint.url : "",
        headers: isRecord(tool.endpoint.headers)
          ? (tool.endpoint.headers as Record<string, string>)
          : undefined,
        queryParams: isRecord(tool.endpoint.queryParams)
          ? (tool.endpoint.queryParams as Record<string, string>)
          : undefined,
        body: tool.endpoint.body,
      },
      integration: {
        name: typeof tool.integration.name === "string"
          ? tool.integration.name
          : undefined,
        domain: typeof tool.integration.domain === "string"
          ? tool.integration.domain
          : undefined,
        keySlug: typeof tool.integration.keySlug === "string"
          ? tool.integration.keySlug
          : undefined,
        auth: tool.integration.auth,
      },
      mockData: tool.mockData,
      responseSchema: tool.responseSchema,
    };
  }

  return null;
}

function pickMockData(toolSpec: CustomHttpActionSpec): unknown {
  if (Array.isArray(toolSpec.mockData)) {
    return toolSpec.mockData.length > 0
      ? toolSpec.mockData[Math.floor(Math.random() * toolSpec.mockData.length)]
      : { message: "No mock data is configured for this tool." };
  }

  return toolSpec.mockData ?? { message: "No mock data is configured for this tool." };
}

export function createIntegrationActionMockResult(input: {
  toolName: string;
  toolSpec: CustomHttpActionSpec;
  reason: string;
  integration?: IntegrationGrantWithCredential | null;
}): IntegrationActionExecutionResult {
  return {
    status: 200,
    body: {
      success: true,
      data: pickMockData(input.toolSpec),
      mock: true,
      mockReason: input.reason,
    },
    audit: {
      integration: input.integration,
      eventName: "tool.custom.mocked",
      outcome: "success",
      severity: "info",
      summary: `Used mock data for custom tool ${input.toolName}.`,
      metadata: { reason: input.reason, mock: true },
    },
  };
}

export function createIntegrationActionDeniedResult(input: {
  toolName: string;
  error: string;
  status: number;
  metadata?: Record<string, unknown>;
}): IntegrationActionExecutionResult {
  return {
    status: input.status,
    body: { success: false, error: input.error, mock: false },
    audit: {
      eventName: "tool.custom.denied",
      outcome: "denied",
      severity: "warning",
      summary: `Denied custom tool ${input.toolName}.`,
      metadata: {
        error: input.error,
        httpStatus: input.status,
        ...(input.metadata ?? {}),
      },
    },
  };
}

function createFailureResult(input: {
  toolName: string;
  error: string;
  status: number;
  metadata?: Record<string, unknown>;
  integration?: IntegrationGrantWithCredential | null;
}): IntegrationActionExecutionResult {
  return {
    status: input.status,
    body: { success: false, error: input.error, mock: false },
    audit: {
      integration: input.integration,
      eventName: "tool.custom.failed",
      outcome: "failure",
      severity: "error",
      summary: `Custom tool ${input.toolName} failed.`,
      metadata: {
        error: input.error,
        httpStatus: input.status,
        ...(input.metadata ?? {}),
      },
    },
  };
}

function missingInputResult(input: {
  toolName: string;
  missingPlaceholders: Set<string>;
}) {
  return createIntegrationActionDeniedResult({
    toolName: input.toolName,
    error: `Missing tool input value(s): ${[...input.missingPlaceholders].join(", ")}`,
    status: 400,
    metadata: {
      reason: "missing_input_placeholders",
      missingPlaceholders: [...input.missingPlaceholders],
    },
  });
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

async function resolveOAuthUserId(input: {
  workspaceId: string;
  appId: string;
  toolName: string;
  identity: OAuthExecutionIdentity;
}): Promise<
  | { ok: true; userId: string }
  | { ok: false; result: IntegrationActionExecutionResult }
> {
  if (input.identity.kind === "app_runtime") {
    return { ok: true, userId: input.identity.userId };
  }

  if (!input.identity.runId) {
    return {
      ok: false,
      result: createIntegrationActionDeniedResult({
        toolName: input.toolName,
        error: "OAuth custom tools require a server-created app-agent run ID.",
        status: 400,
        metadata: { reason: "missing_run_id" },
      }),
    };
  }

  const run = await loadAppAgentRunTriggerForTool({
    runId: input.identity.runId,
    workspaceId: input.workspaceId,
    appId: input.appId,
  });
  if (!run?.triggeredByUserId) {
    return {
      ok: false,
      result: createIntegrationActionDeniedResult({
        toolName: input.toolName,
        error: "OAuth custom tools require a run with a triggering user.",
        status: 403,
        metadata: { reason: "missing_triggering_user" },
      }),
    };
  }

  return { ok: true, userId: run.triggeredByUserId };
}

export async function executeIntegrationHttpAction(input: {
  workspaceId: string;
  appId: string;
  toolName: string;
  toolSpec: CustomHttpActionSpec;
  toolInput: Record<string, unknown>;
  oauthIdentity: OAuthExecutionIdentity;
  onOAuthTokenRefreshed?: (event: OAuthTokenRefreshAuditInput) => Promise<void>;
}): Promise<IntegrationActionExecutionResult> {
  const { workspaceId, appId, toolName, toolSpec } = input;
  const toolInput = input.toolInput ?? {};

  if (!toolSpec.endpoint || !toolSpec.integration?.domain) {
    return createIntegrationActionDeniedResult({
      toolName,
      error: "Custom tools require endpoint and integration.domain",
      status: 400,
      metadata: { reason: "invalid_tool_spec" },
    });
  }
  if (!toolSpec.endpoint.method?.trim() || !toolSpec.endpoint.url?.trim()) {
    return createIntegrationActionDeniedResult({
      toolName,
      error: "Custom tools require endpoint.method and endpoint.url",
      status: 400,
      metadata: { reason: "invalid_tool_endpoint" },
    });
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
    return createIntegrationActionMockResult({
      toolName,
      toolSpec,
      reason: "No app-scoped integration grant matched this tool domain and key.",
      integration,
    });
  }

  const grantAuth = integration?.auth ?? { type: "static_secret" as const };
  if (!isPublicUnauthenticated && !oauthAuthsMatch(requestedAuth, grantAuth)) {
    return createIntegrationActionDeniedResult({
      toolName,
      error: "Tool auth metadata does not match this app's integration grant.",
      status: 403,
      metadata: { reason: "integration_auth_mismatch", authType: requestedAuth.type },
    });
  }

  let secrets: Record<string, string> = {};
  let oauthAccessToken: string | null = null;

  if (grantAuth.type === "oauth2") {
    const oauthUser = await resolveOAuthUserId({
      workspaceId,
      appId,
      toolName,
      identity: input.oauthIdentity,
    });
    if (!oauthUser.ok) return oauthUser.result;

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
      return createIntegrationActionMockResult({
        toolName,
        toolSpec,
        reason: "OAuth provider is not configured for this app's approved auth metadata.",
        integration,
      });
    }

    const connectedAccount = await findConnectedAccountForUserProvider({
      workspaceId,
      userId: oauthUser.userId,
      providerConfigId: providerConfig._id,
    });
    if (!connectedAccount || connectedAccount.revokedAt) {
      return createIntegrationActionMockResult({
        toolName,
        toolSpec,
        reason: input.oauthIdentity.kind === "app_runtime"
          ? "The current user must connect this OAuth account before the tool can run."
          : "The triggering user must connect this OAuth account before the tool can run.",
        integration,
      });
    }
    if (
      !scopesIncludeAll({
        grantedScopes: connectedAccount.grantedScopes,
        requiredScopes: grantAuth.scopes,
      })
    ) {
      return createIntegrationActionMockResult({
        toolName,
        toolSpec,
        reason: "The connected OAuth account is missing required scopes. Reconnect the account.",
        integration,
      });
    }

    try {
      const tokenResult = await getValidOAuthAccessToken({
        workspaceId,
        userId: oauthUser.userId,
        providerConfig,
        auth: grantAuth,
      });
      oauthAccessToken = tokenResult.accessToken;
      if (tokenResult.refreshed) {
        await input.onOAuthTokenRefreshed?.({
          userId: oauthUser.userId,
          providerConfig,
          auth: grantAuth,
          integration,
          accountId: tokenResult.account._id,
          accountProviderKey: tokenResult.account.providerKey,
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "OAuth token refresh failed";
      return createFailureResult({
        toolName,
        error: message,
        status: 502,
        metadata: {
          reason: "oauth_token_broker_failed",
          authType: "oauth2",
          providerKey: grantAuth.providerKey,
          providerConfigId: providerConfig._id,
        },
        integration,
      });
    }
  } else if (!isPublicUnauthenticated) {
    if (!integration) {
      return createIntegrationActionDeniedResult({
        toolName,
        error: "Static custom tools require an app-scoped integration grant.",
        status: 403,
        metadata: { reason: "integration_missing" },
      });
    }
    if (integrationNeedsSetup(integration)) {
      return createIntegrationActionMockResult({
        toolName,
        toolSpec,
        reason: "This app's integration key is not configured for the requested permissions or secrets.",
        integration,
      });
    }
    try {
      secrets = await readIntegrationSecrets(integration);
      if (Object.keys(secrets).length === 0) {
        return createIntegrationActionMockResult({
          toolName,
          toolSpec,
          reason: "Integration is marked configured, but no secrets are available.",
          integration,
        });
      }
    } catch (err) {
      console.error("[integration-action] Failed to read secret:", err);
      return createFailureResult({
        toolName,
        error: "Failed to read secret",
        status: 500,
        integration,
      });
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
      return createIntegrationActionDeniedResult({
        toolName,
        error: "OAuth custom tools must not include token or secret placeholders. The broker injects the access token server-side.",
        status: 400,
        metadata: {
          reason: "oauth_token_placeholder_rejected",
          secretPlaceholders,
          tokenPlaceholders,
        },
      });
    }
    const headerKeys = Object.keys(endpoint.headers ?? {}).map((key) =>
      key.toLowerCase(),
    );
    if (headerKeys.includes("authorization")) {
      return createIntegrationActionDeniedResult({
        toolName,
        error: "OAuth custom tools must not declare their own Authorization header.",
        status: 400,
        metadata: { reason: "oauth_authorization_header_rejected" },
      });
    }
  }

  const inputPlaceholders = new Set<string>();
  collectInputPlaceholders(endpoint.url, inputPlaceholders);
  collectInputPlaceholders(endpoint.headers, inputPlaceholders);
  collectInputPlaceholders(endpoint.queryParams, inputPlaceholders);
  collectInputPlaceholders(endpoint.body, inputPlaceholders);

  if (hasProvidedToolInput(toolInput) && inputPlaceholders.size === 0) {
    return createIntegrationActionDeniedResult({
      toolName,
      error: "Tool input was provided, but this endpoint does not use any input placeholders. Add placeholders like {{symbol}} or {{query}} to the endpoint spec to avoid static bulk API calls.",
      status: 400,
      metadata: { reason: "static_bulk_endpoint_guard" },
    });
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
    return createIntegrationActionMockResult({
      toolName,
      toolSpec,
      reason: `Integration is missing configured secret(s): ${[...missingSecretPlaceholders].join(", ")}.`,
      integration,
    });
  }
  if (missingPlaceholders.size > 0) {
    return missingInputResult({ toolName, missingPlaceholders });
  }

  if (endpoint.queryParams) {
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      return createIntegrationActionDeniedResult({
        toolName,
        error: "Invalid URL",
        status: 400,
        metadata: { reason: "invalid_url" },
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
    return createIntegrationActionMockResult({
      toolName,
      toolSpec,
      reason: `Integration is missing configured secret(s): ${[...missingSecretPlaceholders].join(", ")}.`,
      integration,
    });
  }
  if (missingPlaceholders.size > 0) {
    return missingInputResult({ toolName, missingPlaceholders });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return createIntegrationActionDeniedResult({
      toolName,
      error: "Invalid URL",
      status: 400,
      metadata: { reason: "invalid_url" },
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
    return createIntegrationActionDeniedResult({
      toolName,
      error: `URL hostname "${parsedUrl.hostname}" does not match integration domain "${toolSpec.integration.domain}"`,
      status: 400,
      metadata: {
        reason: "domain_lock_failed",
        hostname: parsedUrl.hostname,
        integrationDomain: toolSpec.integration.domain,
      },
    });
  }

  if (process.env.NODE_ENV === "production") {
    if (parsedUrl.protocol !== "https:") {
      return createIntegrationActionDeniedResult({
        toolName,
        error: "Only HTTPS URLs are allowed in production",
        status: 400,
        metadata: { reason: "https_required", protocol: parsedUrl.protocol },
      });
    }
  } else if (
    parsedUrl.protocol !== "https:" &&
    !isLoopbackHostname(parsedUrl.hostname)
  ) {
    return createIntegrationActionDeniedResult({
      toolName,
      error: "Only HTTPS or localhost HTTP URLs are allowed",
      status: 400,
      metadata: {
        reason: "https_or_localhost_required",
        protocol: parsedUrl.protocol,
      },
    });
  }

  if (!(process.env.NODE_ENV !== "production" && isLoopbackHostname(parsedUrl.hostname))) {
    const resolvedIPs = await resolveHostnameIps(parsedUrl.hostname);
    for (const ip of resolvedIPs) {
      if (isPrivateIP(ip)) {
        return createIntegrationActionDeniedResult({
          toolName,
          error: "Requests to private/internal IPs are not allowed",
          status: 400,
          metadata: { reason: "private_ip_blocked", hostname: parsedUrl.hostname },
        });
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
      return createFailureResult({
        toolName,
        error: "OAuth token broker did not return an access token.",
        status: 502,
        metadata: { reason: "oauth_missing_access_token" },
        integration,
      });
    }
    headers.Authorization = `Bearer ${oauthAccessToken}`;
  }

  if (missingSecretPlaceholders.size > 0) {
    return createIntegrationActionMockResult({
      toolName,
      toolSpec,
      reason: `Integration is missing configured secret(s): ${[...missingSecretPlaceholders].join(", ")}.`,
      integration,
    });
  }
  if (missingPlaceholders.size > 0) {
    return missingInputResult({ toolName, missingPlaceholders });
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
      return createIntegrationActionMockResult({
        toolName,
        toolSpec,
        reason: `Integration is missing configured secret(s): ${[...missingSecretPlaceholders].join(", ")}.`,
        integration,
      });
    }
    if (missingPlaceholders.size > 0) {
      return missingInputResult({ toolName, missingPlaceholders });
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
      return createFailureResult({
        toolName,
        error: "Response too large",
        status: 502,
        metadata: {
          statusCode: response.status,
          responseSizeExceeded: true,
        },
        integration,
      });
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_SIZE) {
      return createFailureResult({
        toolName,
        error: "Response too large",
        status: 502,
        metadata: {
          statusCode: response.status,
          responseSizeExceeded: true,
        },
        integration,
      });
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return {
      status: 200,
      body: {
        success: response.ok,
        data,
        mock: false,
        statusCode: response.status,
      },
      audit: {
        integration,
        eventName: response.ok ? "tool.custom.executed" : "tool.custom.failed",
        outcome: response.ok ? "success" : "failure",
        severity: response.ok ? "info" : "warning",
        summary: response.ok
          ? `Executed custom tool ${toolName}.`
          : `Custom tool ${toolName} returned HTTP ${response.status}.`,
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
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return createFailureResult({
      toolName,
      error: message,
      status: 502,
      metadata: {
        method: endpoint.method.toUpperCase(),
        hostname: parsedUrl.hostname,
      },
      integration,
    });
  }
}
