import { readPublicUrlFromEnv } from "./public-url";

const AUTH_MODES = ["none", "external"] as const;
const MIN_NO_AUTH_SESSION_SECRET_LENGTH = 32;

export type SecondAuthMode = (typeof AUTH_MODES)[number];

export type RuntimeConfig = Readonly<{
  authMode: SecondAuthMode;
  mongodbUri: string;
  noAuthSessionSecret: string;
  publicUrl: string;
}>;

let cachedRuntimeConfig: RuntimeConfig | undefined;

function generateNoAuthSessionSecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

type GlobalWithNoAuthSecret = typeof globalThis & {
  __secondNoAuthSessionSecret?: string;
};

const globalWithNoAuthSecret = globalThis as GlobalWithNoAuthSecret;
const generatedNoAuthSessionSecret =
  globalWithNoAuthSecret.__secondNoAuthSessionSecret ??
  generateNoAuthSessionSecret();

globalWithNoAuthSecret.__secondNoAuthSessionSecret =
  generatedNoAuthSessionSecret;

function throwConfigError(message: string): never {
  throw new Error(`[runtime-config] ${message}`);
}

function readRequiredEnv(
  env: NodeJS.ProcessEnv,
  envKey: keyof NodeJS.ProcessEnv,
): string {
  const value = env[envKey]?.trim();

  if (!value) {
    throwConfigError(`${String(envKey)} is required.`);
  }

  return value;
}

function parseAuthMode(env: NodeJS.ProcessEnv): SecondAuthMode {
  const value = readRequiredEnv(env, "SECOND_AUTH_MODE");

  if (AUTH_MODES.includes(value as SecondAuthMode)) {
    return value as SecondAuthMode;
  }

  throwConfigError(
    `SECOND_AUTH_MODE must be one of ${AUTH_MODES.map((mode) => `"${mode}"`).join(", ")}. Received "${value}".`,
  );
}

function parseMongoDbUri(env: NodeJS.ProcessEnv): string {
  const value = readRequiredEnv(env, "MONGODB_URI");

  if (
    !value.startsWith("mongodb://") &&
    !value.startsWith("mongodb+srv://")
  ) {
    throwConfigError(
      `MONGODB_URI must start with "mongodb://" or "mongodb+srv://". Received "${value}".`,
    );
  }

  try {
    new URL(value);
  } catch {
    throwConfigError(`MONGODB_URI is not a valid URI. Received "${value}".`);
  }

  return value;
}

const BUILD_PHASE_DEFAULTS: RuntimeConfig = Object.freeze({
  authMode: "none",
  mongodbUri: "mongodb://localhost:27017/second",
  noAuthSessionSecret: generatedNoAuthSessionSecret,
  publicUrl: "http://localhost:3000",
});

function parseNoAuthSessionSecret(env: NodeJS.ProcessEnv): string {
  const configured = env.SECOND_NO_AUTH_SESSION_SECRET?.trim();

  if (!configured) {
    return generatedNoAuthSessionSecret;
  }

  if (configured.length < MIN_NO_AUTH_SESSION_SECRET_LENGTH) {
    throwConfigError(
      `SECOND_NO_AUTH_SESSION_SECRET must be at least ${MIN_NO_AUTH_SESSION_SECRET_LENGTH} characters.`,
    );
  }

  return configured;
}

export function readRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  // During `next build`, pages are prerendered without runtime env vars.
  // Return safe defaults so the build succeeds — these are never served.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return BUILD_PHASE_DEFAULTS;
  }

  if (env === process.env && cachedRuntimeConfig) {
    return cachedRuntimeConfig;
  }

  const authMode = parseAuthMode(env);
  const publicUrl = readPublicUrlFromEnv(env, { required: true });

  if (env.NODE_ENV === "production" && !env.INTERNAL_API_TOKEN?.trim()) {
    throwConfigError("INTERNAL_API_TOKEN must be set in production deployments.");
  }

  const runtimeConfig: RuntimeConfig = Object.freeze({
    authMode,
    mongodbUri: parseMongoDbUri(env),
    noAuthSessionSecret: parseNoAuthSessionSecret(env),
    publicUrl,
  });

  if (env === process.env) {
    cachedRuntimeConfig = runtimeConfig;
  }

  return runtimeConfig;
}

export function formatMongoTarget(mongodbUri: string): string {
  try {
    const url = new URL(mongodbUri);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";

    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "<invalid-mongodb-uri>";
  }
}
