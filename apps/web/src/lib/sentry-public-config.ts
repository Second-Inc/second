import type { ErrorEvent } from "@sentry/nextjs";

const DEFAULT_SENTRY_DSN =
  "https://e520b21c4c457cf44bc5f69717b6f3a0@o4510307894165504.ingest.us.sentry.io/4511401492217856";

type Env = Record<string, string | undefined>;

function readEnvValue(env: Env, keys: string[]): string {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return "";
}

export function readSentryDsn(env: Env = process.env): string {
  if (
    env.SECOND_SENTRY_DISABLED === "1" ||
    env.SECOND_ERROR_REPORTING_DISABLED === "1" ||
    env.SECOND_TELEMETRY_DISABLED === "1"
  ) {
    return "";
  }

  return (
    readEnvValue(env, [
      "SECOND_SENTRY_DSN",
      "SENTRY_DSN",
      "NEXT_PUBLIC_SENTRY_DSN",
    ]) || DEFAULT_SENTRY_DSN
  );
}

export function readSentryEnvironment(env: Env = process.env): string {
  return (
    readEnvValue(env, [
      "SENTRY_ENVIRONMENT",
      "SECOND_ENVIRONMENT",
      "VERCEL_ENV",
      "NODE_ENV",
    ]) || "development"
  );
}

export function readSentryRelease(env: Env = process.env): string | undefined {
  return (
    readEnvValue(env, [
      "SENTRY_RELEASE",
      "SECOND_RELEASE_VERSION",
      "VERCEL_GIT_COMMIT_SHA",
    ]) || undefined
  );
}

function scrubPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      if (/^[a-f0-9]{24}$/i.test(segment)) return ":objectId";
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":uuid";
      return segment;
    })
    .join("/");
}

export function sentryRouteShape(pathname: string): string {
  return scrubPath(pathname);
}

export function browserAllowsSentry(): boolean {
  if (typeof document === "undefined") return true;
  return (
    document
      .querySelector('meta[name="second-error-reporting"]')
      ?.getAttribute("content") !== "disabled"
  );
}

function scrubUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;

  try {
    const url = new URL(value);
    url.pathname = scrubPath(url.pathname);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return scrubPath(value.split("?")[0] ?? value);
  }
}

function scrubRequest(event: ErrorEvent): void {
  if (!event.request) return;

  const url = scrubUrl(event.request.url);
  if (url) event.request.url = url;

  delete event.request.cookies;
  delete event.request.data;

  if (!event.request.headers) return;

  for (const key of Object.keys(event.request.headers)) {
    const normalized = key.toLowerCase();
    if (
      normalized === "authorization" ||
      normalized === "cookie" ||
      normalized === "set-cookie" ||
      normalized.includes("token") ||
      normalized.includes("secret") ||
      normalized.includes("key")
    ) {
      delete event.request.headers[key];
    }
  }
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  scrubRequest(event);
  return event;
}
