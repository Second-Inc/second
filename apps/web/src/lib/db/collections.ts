import type { Collection, Document } from "mongodb";
import { getMongoDatabase } from "./client";
import type {
  AgentRunDocument,
  AppAgentRunDocument,
  AppDataDocument,
  AppDocument,
  AppSourceSnapshotDocument,
  AuditEventDocument,
  ConnectedAccountDocument,
  IntegrationCredentialDocument,
  IntegrationDocument,
  OAuthProviderConfigDocument,
  ReviewRequestDocument,
  UserDocument,
  WorkspaceAgentDocument,
  WorkspaceDocument,
  WorkspaceInvitationDocument,
  WorkspaceMembershipDocument,
  WorkspaceSkillDocument,
  WorkspaceSkillRevisionDocument,
  WorkspaceTeamDocument,
  WorkspaceTeamMembershipDocument,
} from "./types";

const COLLECTIONS = {
  users: "users",
  workspaces: "workspaces",
  workspaceMemberships: "workspace_memberships",
  workspaceTeams: "workspace_teams",
  workspaceTeamMemberships: "workspace_team_memberships",
  workspaceInvitations: "workspace_invitations",
  apps: "apps",
  reviewRequests: "review_requests",
  agentRuns: "agent_runs",
  integrations: "integrations",
  integrationCredentials: "integration_credentials",
  oauthProviderConfigs: "oauth_provider_configs",
  connectedAccounts: "connected_accounts",
  appAgentRuns: "app_agent_runs",
  appData: "app_data",
  appSourceSnapshots: "app_source_snapshots",
  auditEvents: "audit_events",
  workspaceSkills: "workspace_skills",
  workspaceSkillRevisions: "workspace_skill_revisions",
  workspaceAgents: "workspace_agents",
} as const;

async function getCollection<T extends Document>(
  name: string,
): Promise<Collection<T>> {
  const db = await getMongoDatabase();
  return db.collection<T>(name);
}

export async function getUsersCollection(): Promise<Collection<UserDocument>> {
  return getCollection<UserDocument>(COLLECTIONS.users);
}

export async function getWorkspacesCollection(): Promise<Collection<WorkspaceDocument>> {
  return getCollection<WorkspaceDocument>(COLLECTIONS.workspaces);
}

export async function getWorkspaceMembershipsCollection(): Promise<
  Collection<WorkspaceMembershipDocument>
> {
  return getCollection<WorkspaceMembershipDocument>(
    COLLECTIONS.workspaceMemberships,
  );
}

export async function getWorkspaceTeamsCollection(): Promise<
  Collection<WorkspaceTeamDocument>
> {
  return getCollection<WorkspaceTeamDocument>(COLLECTIONS.workspaceTeams);
}

export async function getWorkspaceTeamMembershipsCollection(): Promise<
  Collection<WorkspaceTeamMembershipDocument>
> {
  return getCollection<WorkspaceTeamMembershipDocument>(
    COLLECTIONS.workspaceTeamMemberships,
  );
}

export async function getWorkspaceInvitationsCollection(): Promise<
  Collection<WorkspaceInvitationDocument>
> {
  return getCollection<WorkspaceInvitationDocument>(
    COLLECTIONS.workspaceInvitations,
  );
}

export async function getAppsCollection(): Promise<Collection<AppDocument>> {
  return getCollection<AppDocument>(COLLECTIONS.apps);
}

export async function getAppSourceSnapshotsCollection(): Promise<
  Collection<AppSourceSnapshotDocument>
> {
  return getCollection<AppSourceSnapshotDocument>(
    COLLECTIONS.appSourceSnapshots,
  );
}

export async function getReviewRequestsCollection(): Promise<
  Collection<ReviewRequestDocument>
> {
  return getCollection<ReviewRequestDocument>(COLLECTIONS.reviewRequests);
}

export async function getAgentRunsCollection(): Promise<Collection<AgentRunDocument>> {
  return getCollection<AgentRunDocument>(COLLECTIONS.agentRuns);
}

export async function getIntegrationsCollection(): Promise<Collection<IntegrationDocument>> {
  return getCollection<IntegrationDocument>(COLLECTIONS.integrations);
}

export async function getIntegrationCredentialsCollection(): Promise<
  Collection<IntegrationCredentialDocument>
> {
  return getCollection<IntegrationCredentialDocument>(
    COLLECTIONS.integrationCredentials,
  );
}

export async function getOAuthProviderConfigsCollection(): Promise<
  Collection<OAuthProviderConfigDocument>
> {
  return getCollection<OAuthProviderConfigDocument>(
    COLLECTIONS.oauthProviderConfigs,
  );
}

export async function getConnectedAccountsCollection(): Promise<
  Collection<ConnectedAccountDocument>
> {
  return getCollection<ConnectedAccountDocument>(COLLECTIONS.connectedAccounts);
}

export async function getAppAgentRunsCollection(): Promise<Collection<AppAgentRunDocument>> {
  return getCollection<AppAgentRunDocument>(COLLECTIONS.appAgentRuns);
}

export async function getAppDataCollection(): Promise<Collection<AppDataDocument>> {
  return getCollection<AppDataDocument>(COLLECTIONS.appData);
}

export async function getAuditEventsCollection(): Promise<
  Collection<AuditEventDocument>
> {
  return getCollection<AuditEventDocument>(COLLECTIONS.auditEvents);
}

export async function getWorkspaceSkillsCollection(): Promise<
  Collection<WorkspaceSkillDocument>
> {
  return getCollection<WorkspaceSkillDocument>(COLLECTIONS.workspaceSkills);
}

export async function getWorkspaceSkillRevisionsCollection(): Promise<
  Collection<WorkspaceSkillRevisionDocument>
> {
  return getCollection<WorkspaceSkillRevisionDocument>(
    COLLECTIONS.workspaceSkillRevisions,
  );
}

export async function getWorkspaceAgentsCollection(): Promise<
  Collection<WorkspaceAgentDocument>
> {
  return getCollection<WorkspaceAgentDocument>(COLLECTIONS.workspaceAgents);
}
