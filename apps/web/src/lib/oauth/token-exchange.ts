import type {
  IntegrationAuthConfig,
  OAuthProviderConfigDocument,
} from "@/lib/db/types";
import { assertPublicHttpsUrl } from "./url-guards";

const TOKEN_REQUEST_TIMEOUT = 15_000;
const TOKEN_REQUEST_RETRIES = 2;

export type OAuthTokenResponse = {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  tokenType?: string | null;
  scopes: string[];
  idToken?: string | null;
};

function parseScopeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((scope): scope is string => typeof scope === "string");
  }
  if (typeof value !== "string") return [];
  return value
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function readJsonField(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function normalizeTokenResponse(
  payload: unknown,
  fallbackScopes: string[],
): OAuthTokenResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("malformed_token_response");
  }
  const record = payload as Record<string, unknown>;
  const accessToken = readJsonField(record, "access_token", "accessToken");
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("missing_access_token");
  }

  const refreshToken = readJsonField(record, "refresh_token", "refreshToken");
  const expiresIn = readJsonField(record, "expires_in", "expiresIn");
  const tokenType = readJsonField(record, "token_type", "tokenType");
  const idToken = readJsonField(record, "id_token", "idToken");
  const scopes = parseScopeList(readJsonField(record, "scope", "scopes"));

  return {
    accessToken,
    refreshToken: typeof refreshToken === "string" && refreshToken
      ? refreshToken
      : null,
    expiresIn:
      typeof expiresIn === "number" && Number.isFinite(expiresIn)
        ? expiresIn
        : typeof expiresIn === "string"
          ? Number.parseInt(expiresIn, 10)
          : null,
    tokenType: typeof tokenType === "string" ? tokenType : null,
    scopes: scopes.length > 0 ? scopes : fallbackScopes,
    idToken: typeof idToken === "string" && idToken ? idToken : null,
  };
}

function buildBasicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTokenEndpoint(
  tokenUrl: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= TOKEN_REQUEST_RETRIES; attempt += 1) {
    try {
      const response = await fetch(tokenUrl, {
        ...init,
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT),
      });
      if (response.status >= 500 && attempt < TOKEN_REQUEST_RETRIES) {
        await response.text().catch(() => "");
        await sleep(100 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= TOKEN_REQUEST_RETRIES) break;
      await sleep(100 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("token_endpoint_failed");
}

async function postTokenRequest(input: {
  tokenUrl: string;
  params: URLSearchParams;
  clientId: string;
  clientSecret: string | null;
  tokenAuthMethod: OAuthProviderConfigDocument["tokenAuthMethod"];
  fallbackScopes: string[];
}): Promise<OAuthTokenResponse> {
  await assertPublicHttpsUrl({ url: input.tokenUrl });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (input.tokenAuthMethod === "client_secret_basic") {
    if (!input.clientSecret) throw new Error("missing_client_secret");
    headers.Authorization = `Basic ${buildBasicAuth(input.clientId, input.clientSecret)}`;
  } else {
    input.params.set("client_id", input.clientId);
    if (input.tokenAuthMethod !== "none") {
      if (!input.clientSecret) throw new Error("missing_client_secret");
      input.params.set("client_secret", input.clientSecret);
    }
  }

  const response = await fetchTokenEndpoint(input.tokenUrl, {
    method: "POST",
    headers,
    body: input.params,
    redirect: "manual",
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`token_endpoint_non_json_${response.status}`);
  }

  if (!response.ok) {
    const error =
      json && typeof json === "object" && !Array.isArray(json)
        ? (json as Record<string, unknown>).error
        : null;
    throw new Error(typeof error === "string" ? error : `token_endpoint_${response.status}`);
  }

  return normalizeTokenResponse(json, input.fallbackScopes);
}

export async function exchangeAuthorizationCode(input: {
  providerConfig: OAuthProviderConfigDocument;
  auth: Extract<IntegrationAuthConfig, { type: "oauth2" }>;
  clientSecret: string | null;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  for (const [key, value] of Object.entries(input.auth.tokenParams ?? {})) {
    params.set(key, value);
  }
  return postTokenRequest({
    tokenUrl: input.providerConfig.tokenUrl,
    params,
    clientId: input.providerConfig.clientId ?? "",
    clientSecret: input.clientSecret,
    tokenAuthMethod: input.providerConfig.tokenAuthMethod,
    fallbackScopes: input.auth.scopes,
  });
}

export async function refreshAccessToken(input: {
  providerConfig: OAuthProviderConfigDocument;
  auth: Extract<IntegrationAuthConfig, { type: "oauth2" }>;
  clientSecret: string | null;
  refreshToken: string;
}): Promise<OAuthTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
  for (const [key, value] of Object.entries(input.auth.tokenParams ?? {})) {
    params.set(key, value);
  }
  return postTokenRequest({
    tokenUrl: input.providerConfig.tokenUrl,
    params,
    clientId: input.providerConfig.clientId ?? "",
    clientSecret: input.clientSecret,
    tokenAuthMethod: input.providerConfig.tokenAuthMethod,
    fallbackScopes: input.auth.scopes,
  });
}

export function tokenExpiresAt(expiresIn: number | null | undefined): Date {
  const safeExpiresIn =
    typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn
      : 3600;
  return new Date(Date.now() + safeExpiresIn * 1000);
}

export function parseIdTokenClaims(idToken: string | null | undefined): {
  sub?: string;
  email?: string;
  name?: string;
} {
  if (!idToken) return {};
  const [, payload] = idToken.split(".");
  if (!payload) return {};
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as
      Record<string, unknown>;
    return {
      ...(typeof json.sub === "string" ? { sub: json.sub } : {}),
      ...(typeof json.email === "string" ? { email: json.email } : {}),
      ...(typeof json.name === "string" ? { name: json.name } : {}),
    };
  } catch {
    return {};
  }
}
