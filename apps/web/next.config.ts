import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const appDir = path.dirname(fileURLToPath(import.meta.url));

function normalizeDevOrigin(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("*.")) {
    return trimmed.toLowerCase();
  }

  try {
    return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`)
      .hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

const allowedDevOrigins = Array.from(
  new Set(
    [
      "*.second.localhost",
      normalizeDevOrigin(process.env.SECOND_PUBLIC_URL),
      normalizeDevOrigin(process.env.PORTLESS_URL),
      ...(process.env.SECOND_DEV_ALLOWED_ORIGINS ?? "")
        .split(/[,\s]+/)
        .map(normalizeDevOrigin),
    ].filter((origin): origin is string => Boolean(origin)),
  ),
);

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins,
  turbopack: {
    root: appDir,
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "second-9r",
  project: process.env.SENTRY_PROJECT ?? "second-next",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
});
