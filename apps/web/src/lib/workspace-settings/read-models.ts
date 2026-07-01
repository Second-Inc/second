import {
  hasWorkspacePermission,
  listWorkspacePermissions,
} from "@/lib/auth";
import type { WorkspaceContext } from "@/lib/auth/guard";
import {
  DEFAULT_WORKSPACE_TEAM_SLUG,
  findDefaultWorkspaceTeam,
  getWorkspaceAppRuntimeSettings,
  getSourceControlConnection,
  listConnectedAccountsForUser,
  listIntegrationsForWorkspace,
  listOAuthProviderConfigsForWorkspace,
  listWorkspaceInvitations,
  listWorkspaceMemberProfiles,
  listWorkspaceMembersWithUsers,
  listWorkspaceTeamMembershipsForWorkspace,
  listWorkspaceTeams,
} from "@/lib/db";
import { loadWorkspaceInvitationProvider } from "@/lib/invitations";
import { readPublicUrlFromEnv } from "@/lib/config/public-url";
import type {
  ConnectedAccountDocument,
  IntegrationAuthConfig,
  IntegrationGrantWithCredential,
  OAuthProviderConfigDocument,
} from "@/lib/db/types";
import { serializeSourceControlConnection } from "@/lib/db";
import {
  isLocalSecondInstall,
  sourceControlRuntimeLabel,
  sourceControlSecretStorageLabel,
} from "@/lib/source-control/runtime";
import type { PerfTrace } from "@/lib/perf/trace";

type SettingsTrace = Pick<PerfTrace, "log" | "time">;

function timeReadModelStep<T>(
  trace: SettingsTrace | undefined,
  event: string,
  fn: () => Promise<T>,
): Promise<T> {
  return trace ? trace.time(event, fn) : fn();
}

function serializeTeam(team: Awaited<ReturnType<typeof listWorkspaceTeams>>[number]) {
  return {
    id: team._id,
    name: team.name,
    slug: team.slug,
    isDefault: team.isDefault,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}

function serializeInvitation(
  invitation: Awaited<ReturnType<typeof listWorkspaceInvitations>>[number],
) {
  return {
    id: invitation._id,
    email: invitation.email,
    role: invitation.role,
    teamIds: invitation.teamIds,
    status: invitation.status,
    provider: invitation.provider,
    invitedByUserId: invitation.invitedByUserId,
    invitedByUserName: invitation.invitedByUserName,
    createdAt: invitation.createdAt.toISOString(),
    updatedAt: invitation.updatedAt.toISOString(),
    expiresAt: invitation.expiresAt?.toISOString() ?? null,
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
  };
}

function hostFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function buildOAuthRedirectUri(requestOrigin?: string): string {
  const origin = process.env.SECOND_PUBLIC_URL?.trim()
    ? readPublicUrlFromEnv()
    : requestOrigin?.trim() || readPublicUrlFromEnv();
  return `${origin}/api/oauth/callback`;
}

function hasScopes(input: { granted: string[]; required: string[] }): boolean {
  const granted = new Set(input.granted.map((scope) => scope.toLowerCase()));
  return input.required.every((scope) => granted.has(scope.toLowerCase()));
}

function missingScopes(input: { granted: string[]; required: string[] }): string[] {
  const granted = new Set(input.granted.map((scope) => scope.toLowerCase()));
  return input.required.filter((scope) => !granted.has(scope.toLowerCase()));
}

function oauthConfigMatchesGrant(
  config: OAuthProviderConfigDocument | null,
  auth: Extract<IntegrationAuthConfig, { type: "oauth2" }>,
): boolean {
  return Boolean(
    config &&
      config.authorizationUrl === auth.authorizationUrl &&
      config.tokenUrl === auth.tokenUrl &&
      config.tokenAuthMethod === (auth.tokenAuthMethod ?? "client_secret_post"),
  );
}

function serializeIntegrationGrant(
  i: IntegrationGrantWithCredential,
  options: {
    providerConfig?: OAuthProviderConfigDocument | null;
    connectedAccount?: ConnectedAccountDocument | null;
    redirectUri: string;
  },
) {
  const auth = i.auth ?? { type: "static_secret" as const };
  const oauth =
    auth.type === "oauth2"
      ? (() => {
          const config = options.providerConfig ?? null;
          const account = options.connectedAccount ?? null;
          const configMatches = oauthConfigMatchesGrant(config, auth);
          const missing = account
            ? missingScopes({
                granted: account.grantedScopes ?? [],
                required: auth.scopes,
              })
            : auth.scopes;
          const accountReady = Boolean(
            account &&
              !account.revokedAt &&
              hasScopes({
                granted: account.grantedScopes ?? [],
                required: auth.scopes,
              }),
          );
          return {
            providerKey: auth.providerKey,
            identity: auth.identity,
            scopes: auth.scopes,
            authorizationUrl: auth.authorizationUrl,
            tokenUrl: auth.tokenUrl,
            tokenAuthMethod: auth.tokenAuthMethod ?? "client_secret_post",
            authorizationHost: hostFromUrl(auth.authorizationUrl),
            tokenHost: hostFromUrl(auth.tokenUrl),
            providerConfigId: config?._id ?? null,
            providerDisplayName: config?.displayName ?? i.name,
            providerConfigured: Boolean(config?.configured),
            providerConfigMatchesGrant: configMatches,
            redirectUri: options.redirectUri,
            currentUserConnectedAccount: account
              ? {
                  id: account._id,
                  accountEmail: account.accountEmail ?? null,
                  accountName: account.accountName ?? null,
                  grantedScopes: account.grantedScopes ?? [],
                  missingScopes: missing,
                  revokedAt: account.revokedAt?.toISOString() ?? null,
                  lastRefreshError: account.lastRefreshError ?? null,
                  updatedAt: account.updatedAt.toISOString(),
                }
              : null,
            currentUserConnected: accountReady,
            missingScopes: missing,
          };
        })()
      : null;
  const oauthConfigured = oauth
    ? Boolean(
        oauth.providerConfigured &&
          oauth.providerConfigMatchesGrant &&
          oauth.currentUserConnected,
      )
    : null;
  const configured = oauth ? Boolean(oauthConfigured) : i.configured;

  return {
    id: i._id,
    appId: i.appId,
    appName: i.appName,
    name: i.name,
    provider: i.name,
    domain: i.domain,
    keySlug: i.keySlug,
    keyName: i.keyName,
    capabilityLabel: i.capabilityLabel,
    accessLevel: i.accessLevel,
    authType: auth.type,
    auth,
    oauth,
    configured,
    adminConfigured: oauth ? oauth.providerConfigured : i.configured,
    userConnected: oauth ? oauth.currentUserConnected : null,
    status: configured ? "connected" : "setup_needed",
    credentialName: i.credentialName,
    credentialId: i.credentialId,
    isShared: false,
    sharedWithAppNames: [],
    faviconUrl: i.faviconUrl,
    setupGuide: i.setupGuide,
    permissionGroups: i.permissionGroups ?? [],
    secretRequirements: i.secretRequirements ?? [],
    configuredPermissionGroups: i.configuredPermissionGroups ?? [],
    configuredSecrets: i.configuredSecrets,
    setupInstructions: i.setupInstructions ?? null,
    reuseSuggestions: [],
    requestedByUserId: i.requestedByUserId,
    requestedByUserName: i.requestedByUserName,
    requestedAt: i.requestedAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
}

export async function loadMembersSettingsReadModel(
  workspaceContext: WorkspaceContext,
  options: { trace?: SettingsTrace } = {},
) {
  const [defaultTeam, members] = await Promise.all([
    timeReadModelStep(options.trace, "settings.members.db.default_team", () =>
      findDefaultWorkspaceTeam(workspaceContext.workspaceId),
    ),
    timeReadModelStep(options.trace, "settings.members.db.members_with_users", () =>
      listWorkspaceMembersWithUsers(workspaceContext.workspaceId, {
        time: (event, fn) => timeReadModelStep(options.trace, event, fn),
      }),
    ),
  ]);
  options.trace?.log("settings.members.read_model.loaded", {
    members: members.length,
    hasDefaultTeam: Boolean(defaultTeam),
    teamMemberships: members.reduce(
      (count, member) => count + member.teamIds.length,
      0,
    ),
  });
  const normalizedMembers = members.map((member) => {
    const teamIds = new Set(member.teamIds);

    return {
      id: member.membership._id,
      userId: member.membership.userId,
      displayName: member.user?.displayName ?? "Unknown user",
      email: member.user?.email ?? "",
      role: member.membership.role,
      teamIds: [...teamIds],
      createdAt: member.membership.createdAt.toISOString(),
      updatedAt:
        member.membership.updatedAt?.toISOString() ??
        member.membership.createdAt.toISOString(),
    };
  });

  return {
    currentUser: {
      userId: workspaceContext.user._id,
      role: workspaceContext.membership.role,
      permissions: listWorkspacePermissions(workspaceContext.membership),
      teamIds:
        normalizedMembers.find(
          (member) => member.userId === workspaceContext.user._id,
        )?.teamIds ?? [],
    },
    defaultTeam: defaultTeam
      ? {
          id: defaultTeam._id,
          name: defaultTeam.name,
          slug: defaultTeam.slug,
        }
      : null,
    invitationCapability: loadWorkspaceInvitationProvider().getCapability(),
    members: normalizedMembers,
  };
}

export async function loadMembersSettingsInvitations(
  workspaceContext: WorkspaceContext,
  options: { trace?: SettingsTrace } = {},
) {
  if (!hasWorkspacePermission(workspaceContext.membership, "members:invite")) {
    return [];
  }

  const invitations = await timeReadModelStep(
    options.trace,
    "settings.members.db.invitations",
    () => listWorkspaceInvitations(workspaceContext.workspaceId),
  );
  options.trace?.log("settings.members.invitations.loaded", {
    invitations: invitations.length,
  });
  return invitations.map((invitation) => serializeInvitation(invitation));
}

export async function loadTeamsSettingsReadModel(
  workspaceContext: WorkspaceContext,
  options: { trace?: SettingsTrace } = {},
) {
  const [teams, members, teamMemberships] = await Promise.all([
    timeReadModelStep(options.trace, "settings.teams.db.teams", () =>
      listWorkspaceTeams(workspaceContext.workspaceId),
    ),
    timeReadModelStep(options.trace, "settings.teams.db.member_profiles", () =>
      listWorkspaceMemberProfiles(workspaceContext.workspaceId, {
        time: (event, fn) => timeReadModelStep(options.trace, event, fn),
      }),
    ),
    timeReadModelStep(options.trace, "settings.teams.db.team_memberships", () =>
      listWorkspaceTeamMembershipsForWorkspace(workspaceContext.workspaceId),
    ),
  ]);
  options.trace?.log("settings.teams.read_model.loaded", {
    teams: teams.length,
    members: members.length,
    teamMemberships: teamMemberships.length,
  });
  const defaultTeam =
    teams.find((team) => team.isDefault) ??
    teams.find((team) => team.slug === DEFAULT_WORKSPACE_TEAM_SLUG) ??
    null;
  const teamIdsByUserId = new Map<string, string[]>();

  for (const membership of teamMemberships) {
    const teamIds = teamIdsByUserId.get(membership.userId) ?? [];
    teamIds.push(membership.teamId);
    teamIdsByUserId.set(membership.userId, teamIds);
  }

  return {
    currentUser: {
      userId: workspaceContext.user._id,
      role: workspaceContext.membership.role,
      permissions: listWorkspacePermissions(workspaceContext.membership),
    },
    defaultTeam: defaultTeam ? serializeTeam(defaultTeam) : null,
    teams: teams.map(serializeTeam),
    members: members.map((member) => ({
      id: member.membership._id,
      userId: member.membership.userId,
      displayName: member.user?.displayName ?? "Unknown user",
      email: member.user?.email ?? "",
      role: member.membership.role,
      teamIds: teamIdsByUserId.get(member.membership.userId) ?? [],
    })),
  };
}

export async function loadIntegrationsSettingsReadModel(
  workspaceContext: WorkspaceContext,
  options: { requestOrigin?: string } = {},
) {
  const [integrations, providerConfigs, connectedAccounts] = await Promise.all([
    listIntegrationsForWorkspace(workspaceContext.workspaceId),
    listOAuthProviderConfigsForWorkspace(workspaceContext.workspaceId),
    listConnectedAccountsForUser({
      workspaceId: workspaceContext.workspaceId,
      userId: workspaceContext.user._id,
    }),
  ]);
  const providerConfigByKey = new Map(
    providerConfigs.map((config) => [config.providerKey, config]),
  );
  const connectedAccountByProviderConfigId = new Map(
    connectedAccounts.map((account) => [account.providerConfigId, account]),
  );
  const redirectUri = buildOAuthRedirectUri(options.requestOrigin);
  const serialized = integrations.map((integration) => {
    const auth = integration.auth;
    const providerConfig =
      auth?.type === "oauth2"
        ? providerConfigByKey.get(auth.providerKey) ?? null
        : null;
    return serializeIntegrationGrant(integration, {
      providerConfig,
      connectedAccount: providerConfig
        ? connectedAccountByProviderConfigId.get(providerConfig._id) ?? null
        : null,
      redirectUri,
    });
  });
  const appsById = new Map<
    string,
    {
      appId: string;
      appName: string;
      keys: typeof serialized;
    }
  >();

  for (const integration of serialized) {
    const app = appsById.get(integration.appId) ?? {
      appId: integration.appId,
      appName: integration.appName,
      keys: [],
    };
    app.keys.push(integration);
    appsById.set(integration.appId, app);
  }

  return {
    canManage: hasWorkspacePermission(
      workspaceContext.membership,
      "integrations:manage",
    ),
    apps: [...appsById.values()].sort((a, b) =>
      a.appName.localeCompare(b.appName),
    ),
    integrations: serialized,
    summary: {
      total: serialized.length,
      connected: serialized.filter((integration) => integration.configured).length,
      setupNeeded: serialized.filter((integration) => !integration.configured)
        .length,
    },
  };
}

export async function loadAppRuntimeSettingsReadModel(
  workspaceContext: WorkspaceContext,
) {
  const settings = await getWorkspaceAppRuntimeSettings(
    workspaceContext.workspaceId,
  );

  return {
    canManage: hasWorkspacePermission(
      workspaceContext.membership,
      "workspace:manage",
    ),
    settings,
  };
}

export async function loadSourceControlSettingsReadModel(
  workspaceContext: WorkspaceContext,
) {
  const connection = await getSourceControlConnection({
    workspaceId: workspaceContext.workspaceId,
    provider: "github",
  });

  return {
    canManage: hasWorkspacePermission(
      workspaceContext.membership,
      "workspace:manage",
    ),
    runtime: {
      mode: sourceControlRuntimeLabel(),
      localInstall: isLocalSecondInstall(),
      secretStorage: sourceControlSecretStorageLabel(),
    },
    providers: [
      {
        provider: "github" as const,
        name: "GitHub",
        enabled: true,
        status: connection?.status ?? "not_configured",
      },
      {
        provider: "gitlab" as const,
        name: "GitLab",
        enabled: false,
        status: "coming_later" as const,
      },
      {
        provider: "bitbucket" as const,
        name: "Bitbucket",
        enabled: false,
        status: "coming_later" as const,
      },
    ],
    connection: serializeSourceControlConnection(connection),
  };
}

export type MembersSettingsReadModel = Awaited<
  ReturnType<typeof loadMembersSettingsReadModel>
>;
export type MembersSettingsInvitation = Awaited<
  ReturnType<typeof loadMembersSettingsInvitations>
>[number];
export type TeamsSettingsReadModel = Awaited<
  ReturnType<typeof loadTeamsSettingsReadModel>
>;
export type IntegrationsSettingsReadModel = Awaited<
  ReturnType<typeof loadIntegrationsSettingsReadModel>
>;
export type AppRuntimeSettingsReadModel = Awaited<
  ReturnType<typeof loadAppRuntimeSettingsReadModel>
>;
export type SourceControlSettingsReadModel = Awaited<
  ReturnType<typeof loadSourceControlSettingsReadModel>
>;
