import { createHmac, timingSafeEqual } from "node:crypto";
import { readRuntimeConfig } from "@/lib/config";
import {
  ACTIVE_WORKSPACE_COOKIE,
  NO_AUTH_SESSION_COOKIE,
} from "@/lib/auth/constants";
import type { HeaderReader } from "@/lib/auth/types";

type NoAuthSessionPayload = {
  v: 1;
  userId: string;
  iat: number;
};

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_MAX_AGE_MILLISECONDS = SESSION_MAX_AGE_SECONDS * 1000;
const SESSION_CLOCK_SKEW_MILLISECONDS = 60 * 1000;

function getSessionSecret(): string {
  const config = readRuntimeConfig();
  return config.noAuthSessionSecret;
}

function signPayload(payload: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
}

function secureCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function readCookieValue(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [rawName, ...rawValueParts] = cookie.trim().split("=");

    if (rawName !== name || rawValueParts.length === 0) {
      continue;
    }

    return decodeURIComponent(rawValueParts.join("="));
  }

  return null;
}

export function readCookieFromHeaders(
  headers: HeaderReader,
  name: string,
): string | null {
  return readCookieValue(headers.get("cookie"), name);
}

export function createNoAuthSessionToken(userId: string): string {
  const payload: NoAuthSessionPayload = {
    v: 1,
    userId,
    iat: Date.now(),
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function parseNoAuthSessionToken(
  token: string | null,
): NoAuthSessionPayload | null {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);

  if (!secureCompare(signature, expectedSignature)) {
    return null;
  }

  let parsed: unknown;

  try {
    const payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("v" in parsed) ||
    !("userId" in parsed)
  ) {
    return null;
  }

  const { v, userId, iat } = parsed as {
    v?: unknown;
    userId?: unknown;
    iat?: unknown;
  };

  if (v !== 1 || typeof userId !== "string" || !userId.trim()) {
    return null;
  }

  if (
    typeof iat !== "number" ||
    !Number.isFinite(iat) ||
    !Number.isInteger(iat) ||
    iat <= 0
  ) {
    return null;
  }

  const now = Date.now();

  if (iat > now + SESSION_CLOCK_SKEW_MILLISECONDS) {
    return null;
  }

  if (now - iat > SESSION_MAX_AGE_MILLISECONDS) {
    return null;
  }

  return {
    v: 1,
    userId,
    iat,
  };
}

function isSecureRequest(headers: HeaderReader, requestUrl: URL): boolean {
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (forwardedProto) {
    return forwardedProto === "https";
  }

  return requestUrl.protocol === "https:";
}

function buildCookieSecurityOptions(request: {
  headers: HeaderReader;
  url: string;
}) {
  const requestUrl = new URL(request.url);
  return {
    path: "/",
    sameSite: "lax" as const,
    secure: isSecureRequest(request.headers, requestUrl),
  };
}

export function buildNoAuthSessionCookie(request: {
  headers: HeaderReader;
  url: string;
  userId: string;
}) {
  return {
    name: NO_AUTH_SESSION_COOKIE,
    value: createNoAuthSessionToken(request.userId),
    maxAge: SESSION_MAX_AGE_SECONDS,
    httpOnly: true,
    ...buildCookieSecurityOptions(request),
  };
}

export function buildWorkspaceCookie(request: {
  headers: HeaderReader;
  url: string;
  workspaceId: string;
}) {
  return {
    name: ACTIVE_WORKSPACE_COOKIE,
    value: request.workspaceId,
    maxAge: SESSION_MAX_AGE_SECONDS,
    httpOnly: true,
    ...buildCookieSecurityOptions(request),
  };
}

export function buildClearedWorkspaceCookie(request: {
  headers: HeaderReader;
  url: string;
}) {
  return {
    name: ACTIVE_WORKSPACE_COOKIE,
    value: "",
    maxAge: 0,
    httpOnly: true,
    ...buildCookieSecurityOptions(request),
  };
}

export function readNoAuthSessionUserId(headers: HeaderReader): string | null {
  const token = readCookieFromHeaders(headers, NO_AUTH_SESSION_COOKIE);
  const parsed = parseNoAuthSessionToken(token);

  return parsed?.userId ?? null;
}
