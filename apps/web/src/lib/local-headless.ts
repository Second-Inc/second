import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { PUBLIC_URL, readRuntimeConfig } from "@/lib/config";
import {
  createWorkspaceWithOwner,
  findAppById,
  listMembershipsForUser,
  updateUserOnboarding,
  upsertUserByEmail,
} from "@/lib/db";
import type { AppDocument, UserDocument, WorkspaceMembershipDocument } from "@/lib/db/types";

const LOCAL_HEADLESS_EMAIL = "headless@second.local";
const LOCAL_HEADLESS_DISPLAY_NAME = "Headless Second";

type LocalHeadlessContext = {
  user: UserDocument;
  memberships: WorkspaceMembershipDocument[];
  workspaceId: string;
};

export type LocalHeadlessAppContext = LocalHeadlessContext & {
  app: AppDocument;
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function isLoopbackHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return (
    value === "localhost" ||
    value === "127.0.0.1" ||
    value === "[::1]" ||
    value === "::1"
  );
}

function secureTokenEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function localHeadlessToken(): string | null {
  const token = process.env.SECOND_LOCAL_CLI_TOKEN?.trim();
  return token && token.length >= 32 ? token : null;
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

function readQueryToken(request: Request): string | null {
  const token = new URL(request.url).searchParams.get("token")?.trim();
  return token || null;
}

function validateLocalHeadlessRuntime(request: Request): NextResponse | null {
  const config = readRuntimeConfig();
  if (config.authMode !== "none") return jsonError(403, "headless_requires_local_auth");
  if (process.env.SECOND_HEADLESS_ENABLED !== "1") {
    return jsonError(403, "headless_not_enabled");
  }
  if (process.env.SECOND_LOCAL_INSTALL !== "1") {
    return jsonError(403, "headless_requires_local_install");
  }

  const url = new URL(request.url);
  if (!isLoopbackHostname(url.hostname)) {
    return jsonError(403, "headless_requires_loopback");
  }

  return null;
}

function validateLocalHeadlessToken(token: string | null): NextResponse | null {
  const expected = localHeadlessToken();
  if (!expected) return jsonError(500, "headless_token_not_configured");
  if (!token || !secureTokenEquals(token, expected)) {
    return jsonError(401, "unauthorized");
  }
  return null;
}

export function validateLocalHeadlessRequest(request: Request): NextResponse | null {
  return (
    validateLocalHeadlessRuntime(request) ??
    validateLocalHeadlessToken(readBearerToken(request))
  );
}

export function validateLocalHeadlessLaunchRequest(
  request: Request,
): NextResponse | null {
  return (
    validateLocalHeadlessRuntime(request) ??
    validateLocalHeadlessToken(readQueryToken(request))
  );
}

export async function ensureLocalHeadlessContext(): Promise<LocalHeadlessContext> {
  const user = await upsertUserByEmail({
    email: LOCAL_HEADLESS_EMAIL,
    displayName: LOCAL_HEADLESS_DISPLAY_NAME,
    profileRole: "Builder",
  });
  await updateUserOnboarding({ userId: user._id, completed: true });

  let memberships = await listMembershipsForUser(user._id);
  let workspaceId = memberships[0]?.workspaceId;

  if (!workspaceId) {
    const workspace = await createWorkspaceWithOwner({
      name: "Second",
      userId: user._id,
    });
    workspaceId = workspace._id;
    memberships = await listMembershipsForUser(user._id);
  }

  return { user, memberships, workspaceId };
}

export async function findLocalHeadlessApp(
  appId: string,
): Promise<LocalHeadlessAppContext | null> {
  const context = await ensureLocalHeadlessContext();
  for (const membership of context.memberships) {
    const app = await findAppById({
      workspaceId: membership.workspaceId,
      appId,
    });
    if (app) {
      return {
        ...context,
        workspaceId: membership.workspaceId,
        app,
      };
    }
  }
  return null;
}

export function localHeadlessAppDir(appId: string): string | null {
  const root =
    process.env.SECOND_HEADLESS_WORKSPACES_DIR?.trim() ||
    process.env.WORKSPACES_DIR?.trim();
  return root ? join(root, appId) : null;
}

export function buildLocalHeadlessUrls(input: {
  workspaceId: string;
  appId: string;
}) {
  const appPath = `/headless/w/${input.workspaceId}/apps/${input.appId}`;
  const appUrl = new URL(appPath, PUBLIC_URL).toString();
  const integrationsUrl = new URL(
    `/w/${input.workspaceId}/settings/integrations`,
    PUBLIC_URL,
  );
  integrationsUrl.searchParams.set("appId", input.appId);
  integrationsUrl.searchParams.set("returnTo", appUrl);

  const launchUrl = new URL(
    `/api/local/headless/apps/${input.appId}/open`,
    PUBLIC_URL,
  );
  launchUrl.searchParams.set("workspaceId", input.workspaceId);
  const token = localHeadlessToken();
  if (token) launchUrl.searchParams.set("token", token);

  return {
    appUrl,
    launchUrl: launchUrl.toString(),
    integrationsUrl: integrationsUrl.toString(),
  };
}

export function buildLocalHeadlessAppPayload(input: {
  workspaceId: string;
  appId: string;
  appName: string;
}) {
  const urls = buildLocalHeadlessUrls(input);
  const appDir = localHeadlessAppDir(input.appId);
  return {
    workspaceId: input.workspaceId,
    appId: input.appId,
    appName: input.appName,
    appDir,
    runtimeUrl: PUBLIC_URL,
    appUrl: urls.appUrl,
    launchUrl: urls.launchUrl,
    integrationsUrl: urls.integrationsUrl,
    previewCommand: `npx --yes @second-inc/cli headless preview --app ${input.appId} --json`,
    statusCommand: `npx --yes @second-inc/cli headless status --app ${input.appId} --json`,
  };
}
