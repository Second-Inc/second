import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import { revokeConnectedAccountForUser } from "@/lib/db";
import { revokeOAuthTokenAtProvider } from "@/lib/oauth/revocation";
import { deleteOAuthSecret } from "@/lib/oauth/secret-store";

type ConnectedAccountRouteContext = {
  params: Promise<{
    workspaceId: string;
    accountId: string;
  }>;
};

export async function DELETE(
  request: Request,
  context: ConnectedAccountRouteContext,
) {
  const { workspaceId, accountId } = await context.params;

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const account = await revokeConnectedAccountForUser({
    workspaceId: workspaceContext.workspaceId,
    userId: workspaceContext.user._id,
    accountId,
  });
  if (!account) {
    return NextResponse.json(
      { error: "connected_account_not_found" },
      { status: 404 },
    );
  }

  const providerTokenRevoked = await revokeOAuthTokenAtProvider({
    providerKey: account.providerKey,
    tokenRef: account.refreshTokenRef,
  });

  await Promise.all([
    deleteOAuthSecret(account.refreshTokenRef).catch(() => undefined),
    deleteOAuthSecret(account.accessTokenRef).catch(() => undefined),
  ]);

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "oauth.revoked",
    category: "integrations",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request),
    target: {
      type: "connected_account",
      id: account._id,
      name: account.providerKey,
    },
    action: "revoked",
    summary: `Revoked connected ${account.providerKey} account.`,
    metadata: {
      providerKey: account.providerKey,
      providerConfigId: account.providerConfigId,
      hadRefreshToken: Boolean(account.refreshTokenRef),
      hadAccessTokenCache: Boolean(account.accessTokenRef),
      providerTokenRevoked,
    },
  });

  return NextResponse.json({ ok: true });
}
