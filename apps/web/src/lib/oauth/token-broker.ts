import {
  findConnectedAccountForUserProvider,
  markConnectedAccountRefreshError,
  markConnectedAccountRevoked,
  readOAuthProviderClientSecret,
  updateConnectedAccountTokenCache,
} from "@/lib/db";
import type {
  ConnectedAccountDocument,
  IntegrationAuthConfig,
  OAuthProviderConfigDocument,
} from "@/lib/db/types";
import {
  deleteOAuthSecret,
  readOAuthSecret,
  upsertOAuthSecret,
} from "@/lib/oauth/secret-store";
import {
  refreshAccessToken,
  tokenExpiresAt,
} from "@/lib/oauth/token-exchange";
import { withOAuthRefreshLock } from "./refresh-lock";

const TOKEN_EXPIRY_SKEW_MS = 60_000;

export type OAuthTokenBrokerResult = {
  accessToken: string;
  account: ConnectedAccountDocument;
  refreshed: boolean;
};

function cacheStillValid(account: ConnectedAccountDocument): boolean {
  return Boolean(
    account.accessTokenRef &&
      account.accessTokenExpiresAt &&
      account.accessTokenExpiresAt.getTime() - Date.now() > TOKEN_EXPIRY_SKEW_MS,
  );
}

async function readCachedToken(
  account: ConnectedAccountDocument,
): Promise<string | null> {
  if (!cacheStillValid(account) || !account.accessTokenRef) return null;
  return readOAuthSecret(account.accessTokenRef);
}

export async function getValidOAuthAccessToken(input: {
  workspaceId: string;
  userId: string;
  providerConfig: OAuthProviderConfigDocument;
  auth: Extract<IntegrationAuthConfig, { type: "oauth2" }>;
}): Promise<OAuthTokenBrokerResult> {
  const account = await findConnectedAccountForUserProvider({
    workspaceId: input.workspaceId,
    userId: input.userId,
    providerConfigId: input.providerConfig._id,
  });
  if (!account) throw new Error("oauth_account_not_connected");
  if (account.revokedAt) throw new Error("oauth_account_reconnect_required");

  const cached = await readCachedToken(account);
  if (cached) {
    return { accessToken: cached, account, refreshed: false };
  }

  const lockKey = `${input.workspaceId}:${input.userId}:${input.providerConfig._id}`;
  return withOAuthRefreshLock(
    lockKey,
    async () => {
      const latest = await findConnectedAccountForUserProvider({
        workspaceId: input.workspaceId,
        userId: input.userId,
        providerConfigId: input.providerConfig._id,
      });
      if (!latest) throw new Error("oauth_account_not_connected");
      if (latest.revokedAt) throw new Error("oauth_account_reconnect_required");

      const latestCached = await readCachedToken(latest);
      if (latestCached) {
        return {
          accessToken: latestCached,
          account: latest,
          refreshed: false,
        };
      }

      if (!latest.refreshTokenRef) {
        await markConnectedAccountRevoked({
          workspaceId: input.workspaceId,
          accountId: latest._id,
          reason: "missing_refresh_token",
        });
        throw new Error("oauth_account_reconnect_required");
      }

      try {
        const [refreshToken, clientSecret] = await Promise.all([
          readOAuthSecret(latest.refreshTokenRef),
          readOAuthProviderClientSecret(input.providerConfig),
        ]);
        const tokenResponse = await refreshAccessToken({
          providerConfig: input.providerConfig,
          auth: input.auth,
          clientSecret,
          refreshToken,
        });
        const refreshTokenRef = tokenResponse.refreshToken
          ? await upsertOAuthSecret({
              workspaceId: input.workspaceId,
              name: `oauth_refresh_token_${input.providerConfig._id}_${input.userId}`,
              value: tokenResponse.refreshToken,
              existingRef: latest.refreshTokenRef,
            })
          : latest.refreshTokenRef;
        const accessTokenRef = await upsertOAuthSecret({
          workspaceId: input.workspaceId,
          name: `oauth_access_token_${input.providerConfig._id}_${input.userId}`,
          value: tokenResponse.accessToken,
          existingRef: latest.accessTokenRef,
        });
        await updateConnectedAccountTokenCache({
          workspaceId: input.workspaceId,
          accountId: latest._id,
          accessTokenRef,
          accessTokenExpiresAt: tokenExpiresAt(tokenResponse.expiresIn),
          tokenType: tokenResponse.tokenType ?? latest.tokenType ?? "Bearer",
          refreshTokenRef,
        });
        const updated = await findConnectedAccountForUserProvider({
          workspaceId: input.workspaceId,
          userId: input.userId,
          providerConfigId: input.providerConfig._id,
        });
        return {
          accessToken: tokenResponse.accessToken,
          account: updated ?? latest,
          refreshed: true,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "oauth_refresh_failed";
        if (/invalid_grant|refresh.*revoked|reconnect/i.test(message)) {
          await Promise.all([
            deleteOAuthSecret(latest.refreshTokenRef).catch(() => undefined),
            deleteOAuthSecret(latest.accessTokenRef).catch(() => undefined),
          ]);
          await markConnectedAccountRevoked({
            workspaceId: input.workspaceId,
            accountId: latest._id,
            reason: message,
          });
        } else {
          await markConnectedAccountRefreshError({
            workspaceId: input.workspaceId,
            accountId: latest._id,
            error: message,
          });
        }
        throw error;
      }
    },
    async () => {
      const latest = await findConnectedAccountForUserProvider({
        workspaceId: input.workspaceId,
        userId: input.userId,
        providerConfigId: input.providerConfig._id,
      });
      if (!latest || latest.revokedAt) return null;
      const token = await readCachedToken(latest).catch(() => null);
      return token
        ? { accessToken: token, account: latest, refreshed: false }
        : null;
    },
  );
}
