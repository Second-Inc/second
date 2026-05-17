import * as Sentry from "@sentry/nextjs";
import { formatMongoTarget, readRuntimeConfig } from "./lib/config";

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  const { ensureDatabaseIndexes } = await import("./lib/db/indexes");
  const config = readRuntimeConfig();

  if (config.authMode === "external") {
    throw new Error(
      "[runtime-config] SECOND_AUTH_MODE=external requires an external/private auth extension, which is not included in this OSS build.",
    );
  }

  await ensureDatabaseIndexes();

  console.info(
    `[startup] Runtime config loaded (SECOND_AUTH_MODE=${config.authMode}, MONGODB_URI=${formatMongoTarget(config.mongodbUri)})`,
  );
  console.info("[startup] MongoDB indexes are ready.");
}

export const onRequestError = Sentry.captureRequestError;
