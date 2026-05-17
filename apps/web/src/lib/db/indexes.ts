import {
  getAgentRunsCollection,
  getAppAgentRunsCollection,
  getAppDataCollection,
  getAppSourceSnapshotsCollection,
  getAppsCollection,
  getAuditEventsCollection,
  getConnectedAccountsCollection,
  getIntegrationCredentialsCollection,
  getIntegrationsCollection,
  getOAuthProviderConfigsCollection,
  getReviewRequestsCollection,
  getUsersCollection,
  getWorkspaceInvitationsCollection,
  getWorkspaceAgentsCollection,
  getWorkspaceMembershipsCollection,
  getWorkspaceSkillRevisionsCollection,
  getWorkspaceSkillsCollection,
  getWorkspaceTeamMembershipsCollection,
  getWorkspaceTeamsCollection,
  getWorkspacesCollection,
} from "./collections";
import { getMongoDatabase } from "./client";

const WORKSPACES_EXTERNAL_ORGANIZATION_INDEX =
  "workspaces_external_organization";
const LEGACY_INTEGRATIONS_WORKSPACE_DOMAIN_INDEX =
  "integrations_workspace_domain_unique";
const LEGACY_INTEGRATIONS_REQUESTS_APP_INDEX =
  "integrations_workspace_requests_app";

function isMongoNamespaceNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const mongoError = error as { code?: unknown; codeName?: unknown };

  return (
    mongoError.code === 26 || mongoError.codeName === "NamespaceNotFound"
  );
}

async function ensureUniqueWorkspacesExternalOrganizationIndex(): Promise<void> {
  const workspacesCollection = await getWorkspacesCollection();
  let existingIndexes: Awaited<
    ReturnType<typeof workspacesCollection.indexes>
  >;

  try {
    existingIndexes = await workspacesCollection.indexes();
  } catch (error) {
    if (!isMongoNamespaceNotFoundError(error)) {
      throw error;
    }

    existingIndexes = [];
  }

  const existingIndex = existingIndexes.find(
    (index) => index.name === WORKSPACES_EXTERNAL_ORGANIZATION_INDEX,
  );

  if (existingIndex && existingIndex.unique !== true) {
    await workspacesCollection.dropIndex(WORKSPACES_EXTERNAL_ORGANIZATION_INDEX);
  }

  await workspacesCollection.createIndex(
    { externalOrganizationProvider: 1, externalOrganizationId: 1 },
    {
      name: WORKSPACES_EXTERNAL_ORGANIZATION_INDEX,
      sparse: true,
      unique: true,
    },
  );
}

async function dropIndexIfPresent(input: {
  collection: Awaited<ReturnType<typeof getIntegrationsCollection>>;
  indexName: string;
}): Promise<void> {
  let existingIndexes: Awaited<ReturnType<typeof input.collection.indexes>>;

  try {
    existingIndexes = await input.collection.indexes();
  } catch (error) {
    if (!isMongoNamespaceNotFoundError(error)) {
      throw error;
    }

    existingIndexes = [];
  }

  if (existingIndexes.some((index) => index.name === input.indexName)) {
    await input.collection.dropIndex(input.indexName);
  }
}

function normalizeWorkspaceSlugForIndex(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function backfillWorkspaceSlugsForUniqueIndex(
  workspacesCollection: Awaited<ReturnType<typeof getWorkspacesCollection>>,
): Promise<void> {
  const workspaces = await workspacesCollection
    .find(
      {},
      {
        projection: { _id: 1, name: 1, slug: 1 },
        sort: { createdAt: 1, _id: 1 },
      },
    )
    .toArray();

  if (workspaces.length === 0) return;

  const workspaceIds = new Set(
    workspaces
      .map((workspace) => String(workspace._id ?? ""))
      .filter((id) => id.length > 0),
  );
  const usedSlugs = new Set<string>();
  const updates = [];

  for (const workspace of workspaces) {
    const workspaceId = String(workspace._id ?? "");
    const currentSlug =
      typeof workspace.slug === "string"
        ? normalizeWorkspaceSlugForIndex(workspace.slug)
        : "";

    if (
      currentSlug &&
      !usedSlugs.has(currentSlug) &&
      (!workspaceIds.has(currentSlug) || currentSlug === workspaceId)
    ) {
      usedSlugs.add(currentSlug);
      continue;
    }

    const base =
      normalizeWorkspaceSlugForIndex(workspace.slug) ||
      normalizeWorkspaceSlugForIndex(workspace.name) ||
      normalizeWorkspaceSlugForIndex(workspaceId) ||
      "workspace";
    let slug = base;
    let suffix = 2;

    while (
      usedSlugs.has(slug) ||
      (workspaceIds.has(slug) && slug !== workspaceId)
    ) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }

    usedSlugs.add(slug);
    updates.push({
      updateOne: {
        filter: { _id: workspace._id },
        update: { $set: { slug, updatedAt: new Date() } },
      },
    });
  }

  if (updates.length > 0) {
    await workspacesCollection.bulkWrite(updates, { ordered: false });
  }
}

export async function ensureDatabaseIndexes(): Promise<void> {
  const [
    appsCollection,
    usersCollection,
    workspaceMembershipsCollection,
    integrationsCollection,
    integrationCredentialsCollection,
    oauthProviderConfigsCollection,
    connectedAccountsCollection,
    reviewRequestsCollection,
    appAgentRunsCollection,
    appDataCollection,
    appSourceSnapshotsCollection,
    agentRunsCollection,
    auditEventsCollection,
    workspaceInvitationsCollection,
    workspaceSkillsCollection,
    workspaceSkillRevisionsCollection,
    workspaceAgentsCollection,
    workspaceTeamsCollection,
    workspaceTeamMembershipsCollection,
    workspacesCollection,
    builderAttachmentFilesCollection,
  ] = await Promise.all([
    getAppsCollection(),
    getUsersCollection(),
    getWorkspaceMembershipsCollection(),
    getIntegrationsCollection(),
    getIntegrationCredentialsCollection(),
    getOAuthProviderConfigsCollection(),
    getConnectedAccountsCollection(),
    getReviewRequestsCollection(),
    getAppAgentRunsCollection(),
    getAppDataCollection(),
    getAppSourceSnapshotsCollection(),
    getAgentRunsCollection(),
    getAuditEventsCollection(),
    getWorkspaceInvitationsCollection(),
    getWorkspaceSkillsCollection(),
    getWorkspaceSkillRevisionsCollection(),
    getWorkspaceAgentsCollection(),
    getWorkspaceTeamsCollection(),
    getWorkspaceTeamMembershipsCollection(),
    getWorkspacesCollection(),
    getMongoDatabase().then((db) => db.collection("builder_attachments.files")),
  ]);

  await Promise.all([
    dropIndexIfPresent({
      collection: integrationsCollection,
      indexName: LEGACY_INTEGRATIONS_WORKSPACE_DOMAIN_INDEX,
    }),
    dropIndexIfPresent({
      collection: integrationsCollection,
      indexName: LEGACY_INTEGRATIONS_REQUESTS_APP_INDEX,
    }),
  ]);

  await backfillWorkspaceSlugsForUniqueIndex(workspacesCollection);

  await Promise.all([
    workspacesCollection.createIndex(
      { slug: 1 },
      { name: "workspaces_slug_unique", unique: true },
    ),
    appsCollection.createIndex(
      { workspaceId: 1, createdAt: -1 },
      { name: "apps_workspace_created_at" },
    ),
    appsCollection.createIndex(
      { workspaceId: 1, publishStatus: 1, createdAt: -1 },
      { name: "apps_workspace_publish_status_created" },
    ),
    appsCollection.createIndex(
      { workspaceId: 1, teamIds: 1, publishStatus: 1 },
      { name: "apps_workspace_team_publish_status" },
    ),
    appsCollection.createIndex(
      { workspaceId: 1, collaboratorUserIds: 1 },
      { name: "apps_workspace_collaborators" },
    ),
    reviewRequestsCollection.createIndex(
      { workspaceId: 1, status: 1, updatedAt: -1 },
      { name: "review_requests_workspace_status_updated" },
    ),
    reviewRequestsCollection.createIndex(
      { workspaceId: 1, resourceType: 1, resourceId: 1, status: 1 },
      { name: "review_requests_workspace_resource_status" },
    ),
    workspaceMembershipsCollection.createIndex(
      { workspaceId: 1, userId: 1 },
      {
        name: "workspace_memberships_workspace_user_unique",
        unique: true,
      },
    ),
    workspaceMembershipsCollection.createIndex(
      { userId: 1, workspaceId: 1 },
      { name: "workspace_memberships_user_workspace" },
    ),
    workspaceMembershipsCollection.createIndex(
      { workspaceId: 1, createdAt: 1 },
      { name: "workspace_memberships_workspace_created" },
    ),
    workspaceInvitationsCollection.createIndex(
      { workspaceId: 1, emailNormalized: 1, status: 1 },
      { name: "workspace_invitations_workspace_email_status" },
    ),
    workspaceInvitationsCollection.createIndex(
      { externalInvitationId: 1 },
      {
        name: "workspace_invitations_external_invitation",
        sparse: true,
      },
    ),
    workspaceTeamsCollection.createIndex(
      { workspaceId: 1, slug: 1 },
      { name: "workspace_teams_workspace_slug_unique", unique: true },
    ),
    workspaceTeamsCollection.createIndex(
      { workspaceId: 1, isDefault: 1 },
      { name: "workspace_teams_workspace_default" },
    ),
    workspaceTeamsCollection.createIndex(
      { workspaceId: 1, isDefault: -1, name: 1 },
      { name: "workspace_teams_workspace_default_name" },
    ),
    workspaceTeamMembershipsCollection.createIndex(
      { workspaceId: 1, teamId: 1, userId: 1 },
      {
        name: "workspace_team_memberships_team_user_unique",
        unique: true,
      },
    ),
    workspaceTeamMembershipsCollection.createIndex(
      { workspaceId: 1, userId: 1 },
      { name: "workspace_team_memberships_workspace_user" },
    ),
    usersCollection.createIndex(
      { emailNormalized: 1 },
      { name: "users_email_normalized_unique", unique: true },
    ),
    integrationsCollection.createIndex(
      { workspaceId: 1, appId: 1, domain: 1, keySlug: 1 },
      { name: "integrations_workspace_app_domain_key_unique", unique: true },
    ),
    integrationsCollection.createIndex(
      { workspaceId: 1, appId: 1, updatedAt: -1 },
      { name: "integrations_workspace_app_updated" },
    ),
    integrationsCollection.createIndex(
      { workspaceId: 1, domain: 1 },
      { name: "integrations_workspace_domain" },
    ),
    integrationsCollection.createIndex(
      { workspaceId: 1, updatedAt: -1 },
      { name: "integrations_workspace_updated" },
    ),
    integrationCredentialsCollection.createIndex(
      { workspaceId: 1, domain: 1, capabilityFingerprint: 1 },
      { name: "integration_credentials_workspace_domain_fingerprint" },
    ),
    integrationCredentialsCollection.createIndex(
      { workspaceId: 1, linkedGrantIds: 1 },
      { name: "integration_credentials_workspace_linked_grants" },
    ),
    oauthProviderConfigsCollection.createIndex(
      { workspaceId: 1, providerKey: 1 },
      {
        name: "oauth_provider_configs_workspace_provider_unique",
        unique: true,
      },
    ),
    oauthProviderConfigsCollection.createIndex(
      { workspaceId: 1, updatedAt: -1 },
      { name: "oauth_provider_configs_workspace_updated" },
    ),
    connectedAccountsCollection.createIndex(
      { workspaceId: 1, userId: 1, providerConfigId: 1 },
      {
        name: "connected_accounts_workspace_user_provider_unique",
        unique: true,
      },
    ),
    connectedAccountsCollection.createIndex(
      { workspaceId: 1, providerKey: 1, userId: 1 },
      { name: "connected_accounts_workspace_provider_user" },
    ),
    connectedAccountsCollection.createIndex(
      { workspaceId: 1, userId: 1, updatedAt: -1 },
      { name: "connected_accounts_workspace_user_updated" },
    ),
    appAgentRunsCollection.createIndex(
      { appId: 1, createdAt: -1 },
      { name: "app_agent_runs_app_created" },
    ),
    appAgentRunsCollection.createIndex(
      { workspaceId: 1, status: 1 },
      { name: "app_agent_runs_workspace_status" },
    ),
    appDataCollection.createIndex(
      { workspaceId: 1, appId: 1, collection: 1, updatedAt: -1 },
      { name: "app_data_workspace_app_collection" },
    ),
    appDataCollection.createIndex(
      { workspaceId: 1, appId: 1, collection: 1, _id: 1 },
      { name: "app_data_workspace_app_collection_doc" },
    ),
    appSourceSnapshotsCollection.createIndex(
      { workspaceId: 1, appId: 1, kind: 1 },
      { name: "app_source_snapshots_workspace_app_kind_unique", unique: true },
    ),
    appSourceSnapshotsCollection.createIndex(
      { workspaceId: 1, appId: 1, updatedAt: -1 },
      { name: "app_source_snapshots_workspace_app_updated" },
    ),
    builderAttachmentFilesCollection.createIndex(
      {
        "metadata.workspaceId": 1,
        "metadata.appId": 1,
        "metadata.attachmentId": 1,
        uploadDate: -1,
      },
      { name: "builder_attachments_workspace_app_attachment" },
    ),
    agentRunsCollection.createIndex(
      { workspaceId: 1, appId: 1, createdAt: -1 },
      { name: "agent_runs_workspace_app_created" },
    ),
    agentRunsCollection.createIndex(
      { workspaceId: 1, mode: 1, createdAt: -1 },
      { name: "agent_runs_workspace_mode_created" },
    ),
    workspaceSkillsCollection.createIndex(
      { workspaceId: 1, slug: 1 },
      { name: "workspace_skills_workspace_slug_unique", unique: true },
    ),
    workspaceSkillsCollection.createIndex(
      { workspaceId: 1, status: 1, updatedAt: -1 },
      { name: "workspace_skills_workspace_status_updated" },
    ),
    workspaceSkillsCollection.createIndex(
      { workspaceId: 1, teamIds: 1, status: 1 },
      { name: "workspace_skills_workspace_team_status" },
    ),
    workspaceSkillRevisionsCollection.createIndex(
      { workspaceId: 1, skillId: 1, revisionNumber: -1 },
      { name: "workspace_skill_revisions_workspace_skill_number" },
    ),
    workspaceSkillRevisionsCollection.createIndex(
      { workspaceId: 1, _id: 1, skillId: 1 },
      { name: "workspace_skill_revisions_workspace_id_skill" },
    ),
    workspaceAgentsCollection.createIndex(
      { workspaceId: 1, slug: 1 },
      { name: "workspace_agents_workspace_slug_unique", unique: true },
    ),
    workspaceAgentsCollection.createIndex(
      { workspaceId: 1, status: 1, updatedAt: -1 },
      { name: "workspace_agents_workspace_status_updated" },
    ),
    workspaceAgentsCollection.createIndex(
      { workspaceId: 1, teamIds: 1, status: 1 },
      { name: "workspace_agents_workspace_team_status" },
    ),
    workspaceAgentsCollection.createIndex(
      { workspaceId: 1, selectedSkillIds: 1 },
      { name: "workspace_agents_workspace_selected_skills" },
    ),
    auditEventsCollection.createIndex(
      { workspaceId: 1, occurredAt: -1, _id: -1 },
      { name: "audit_events_workspace_occurred" },
    ),
    auditEventsCollection.createIndex(
      { workspaceId: 1, category: 1, occurredAt: -1 },
      { name: "audit_events_workspace_category_occurred" },
    ),
    auditEventsCollection.createIndex(
      { workspaceId: 1, eventName: 1, occurredAt: -1 },
      { name: "audit_events_workspace_event_occurred" },
    ),
    auditEventsCollection.createIndex(
      { workspaceId: 1, "actor.userId": 1, occurredAt: -1 },
      { name: "audit_events_workspace_actor_occurred" },
    ),
    auditEventsCollection.createIndex(
      { workspaceId: 1, "target.type": 1, "target.id": 1, occurredAt: -1 },
      { name: "audit_events_workspace_target_occurred" },
    ),
    auditEventsCollection.createIndex(
      { workspaceId: 1, "source.appId": 1, occurredAt: -1 },
      { name: "audit_events_workspace_source_app_occurred" },
    ),
    auditEventsCollection.createIndex(
      { workspaceId: 1, correlationId: 1, occurredAt: -1 },
      { name: "audit_events_workspace_correlation_occurred" },
    ),
  ]);

  await ensureUniqueWorkspacesExternalOrganizationIndex();
}
