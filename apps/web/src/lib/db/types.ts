import type {
  LoaderColorId,
  LoaderStyleId,
  ThemeMode,
} from "@/lib/user-preferences";
import type { OnboardingStepId } from "@/lib/onboarding";
import type { AgentRuntimeId } from "@/lib/agent/runtime-registry";
import type { WorkspaceAppRuntimeSettings } from "@/lib/workspace-app-runtime-settings";

export type WorkspaceRole = "owner" | "admin" | "member";

export type ResourceVisibility = "workspace" | "teams";

export type AuditEventCategory =
  | "auth"
  | "access"
  | "members"
  | "teams"
  | "apps"
  | "reviews"
  | "integrations"
  | "agents"
  | "tools"
  | "app_data"
  | "app_event"
  | "audit"
  | "library"
  | "system";

export type AuditEventSeverity =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical";

export type AuditEventOutcome =
  | "success"
  | "failure"
  | "denied"
  | "started"
  | "completed";

export type AuditActorKind = "user" | "system" | "agent" | "app" | "worker";

export type AuditSourceKind =
  | "web_server"
  | "worker"
  | "app_iframe"
  | "app_agent"
  | "builder_agent"
  | "workspace_agent"
  | "system";

export type AuditSourceTrust =
  | "server_trusted"
  | "internal_trusted"
  | "client_untrusted";

export type AuditTargetType =
  | "workspace"
  | "member"
  | "team"
  | "invitation"
  | "app"
  | "review"
  | "integration"
  | "oauth_provider_config"
  | "connected_account"
  | "agent"
  | "run"
  | "source_snapshot"
  | "tool"
  | "app_data_document"
  | "app_event"
  | "audit_export";

export type AuditRetentionPolicy =
  | "default"
  | "security"
  | "short_lived_dev";

export type AppPublishStatus =
  | "draft"
  | "review_requested"
  | "published"
  | "changes_requested";

export type WorkspaceSkillStatus = "published" | "draft" | "archived";

export type WorkspaceAgentStatus = "published" | "draft" | "archived";

export type WorkspaceAgentApprovalStatus =
  | "approved"
  | "stale"
  | "pending"
  | "none";

export type ReviewRequestStatus =
  | "pending"
  | "approved"
  | "changes_requested"
  | "superseded";

export type ReviewResourceType = "app";

export type AgentsJsonApprovalSource =
  | "build_chat"
  | "build_chat_mock"
  | "agents_page"
  | "review"
  | "publish";

export type UserDocument = {
  _id: string;
  email: string;
  emailNormalized: string;
  displayName: string;
  profileRole?: string | null;
  userContext?: string | null;
  onboardingStep?: OnboardingStepId | null;
  onboardingCompletedAt?: Date | null;
  preferences?: {
    loaderColor?: LoaderColorId;
    loaderStyle?: LoaderStyleId;
    loaderCustomColor?: string;
    themeMode?: ThemeMode;
  };
  createdAt: Date;
  updatedAt: Date;
};

export type WorkspaceDocument = {
  _id: string;
  name: string;
  slug: string;
  companyContext?: string | null;
  createdByUserId: string;
  appRuntimeSettings?: Partial<WorkspaceAppRuntimeSettings>;
  defaultTeamId?: string | null;
  externalOrganizationId?: string | null;
  externalOrganizationProvider?: "workos" | string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkspaceMembershipDocument = {
  _id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  externalOrganizationMembershipId?: string | null;
  externalOrganizationId?: string | null;
  externalProvider?: "workos" | string | null;
  invitedByUserId?: string | null;
  createdAt: Date;
  updatedAt?: Date;
};

export type WorkspaceTeamDocument = {
  _id: string;
  workspaceId: string;
  name: string;
  slug: string;
  isDefault: boolean;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkspaceTeamMembershipDocument = {
  _id: string;
  workspaceId: string;
  teamId: string;
  userId: string;
  createdAt: Date;
};

export type WorkspaceInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export type WorkspaceInvitationProvider = "local" | "workos" | "external";

export type WorkspaceInvitationDocument = {
  _id: string;
  workspaceId: string;
  email: string;
  emailNormalized: string;
  role: WorkspaceRole;
  teamIds: string[];
  status: WorkspaceInvitationStatus;
  provider: WorkspaceInvitationProvider;
  externalInvitationId?: string | null;
  externalOrganizationId?: string | null;
  invitedByUserId: string;
  invitedByUserName: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
};

export type AppDocument = {
  _id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  agentStatus?: "idle" | "running" | "done" | "error";
  /** Editable draft snapshot (source + compiled artifact) persisted on successful done_building */
  sourceFiles?: Record<string, string>;
  /** Last promoted snapshot served to published app viewers */
  publishedSourceFiles?: Record<string, string>;
  publishedSourceFilesUpdatedAt?: Date | null;
  /** Current editable draft source snapshot in app_source_snapshots. */
  draftSnapshotId?: string | null;
  draftSourceUpdatedAt?: Date | null;
  draftSourceSizeBytes?: number | null;
  draftSourceHash?: string | null;
  draftHasPreviewArtifact?: boolean | null;
  /** Current promoted published source snapshot in app_source_snapshots. */
  publishedSnapshotId?: string | null;
  publishedSourceSizeBytes?: number | null;
  publishedSourceHash?: string | null;
  publishedHasPreviewArtifact?: boolean | null;
  /** Exact draft agents.json revision approved for trusted runtime use */
  agentsJsonApprovalHash?: string | null;
  agentsJsonApprovedPayload?: unknown | null;
  agentsJsonApprovedByUserId?: string | null;
  agentsJsonApprovedByUserName?: string | null;
  agentsJsonApprovedAt?: Date | null;
  agentsJsonApprovalSource?: AgentsJsonApprovalSource | null;
  /** agents.json approval metadata promoted with the published snapshot */
  publishedAgentsJsonApprovalHash?: string | null;
  publishedAgentsJsonApprovedPayload?: unknown | null;
  publishedAgentsJsonApprovedByUserId?: string | null;
  publishedAgentsJsonApprovedByUserName?: string | null;
  publishedAgentsJsonApprovedAt?: Date | null;
  publishedAgentsJsonApprovalSource?: AgentsJsonApprovalSource | null;
  /** Full user prompt that created this app (may be longer than the app name) */
  prompt?: string;
  /** Agent runtime settings persisted from composer and carried across sessions. */
  runtimeId: AgentRuntimeId;
  runtimeModel: string;
  runtimeParams: Record<string, string>;
  collaboratorUserIds?: string[];
  visibility?: ResourceVisibility;
  teamIds?: string[];
  publishStatus?: AppPublishStatus;
  reviewRequestedByUserId?: string | null;
  reviewRequestedByUserName?: string | null;
  reviewRequestedAt?: Date | null;
  publishedByUserId?: string | null;
  publishedAt?: Date | null;
  changeRequestMessage?: string | null;
  changeRequestedByUserId?: string | null;
  changeRequestedAt?: Date | null;
};

export type AppSourceSnapshotKind = "draft" | "published";

export type AppSourceSnapshotDocument = {
  _id: string;
  workspaceId: string;
  appId: string;
  kind: AppSourceSnapshotKind;
  files: Record<string, string>;
  sizeBytes: number;
  fileCount: number;
  hash: string;
  hasPreviewArtifact: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ReviewRequestDocument = {
  _id: string;
  workspaceId: string;
  resourceType: ReviewResourceType;
  resourceId: string;
  resourceName: string;
  status: ReviewRequestStatus;
  requestedByUserId: string;
  requestedByUserName: string;
  requestedAt: Date;
  targetTeamIds: string[];
  reviewerUserId?: string | null;
  reviewerUserName?: string | null;
  reviewedAt?: Date | null;
  reviewMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ModelUsageRecord = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
};

export type RunUsage = {
  /** Sum of total_cost_usd from all query() calls in this run. */
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  /** Per-model breakdown — accumulated across all query() calls. */
  byModel: Record<string, ModelUsageRecord>;
};

export type ProviderSessionState = {
  runtimeId: AgentRuntimeId;
  sessionId: string | null;
  data?: string | null;
  format?: string;
  metadata?: Record<string, unknown>;
};

export type BuilderAttachmentReference = {
  id: string;
  name: string;
  path: string;
  size: number;
  contentType?: string;
};

export type AgentRunRecoveryContext = {
  type: "app_tool_failure";
  source?: "app_agent" | "app_runtime";
  appAgentRunId?: string;
  agentId?: string;
  agentName?: string | null;
  toolName?: string | null;
  reportedAt: Date;
};

export type AgentRunFailureCode =
  | "worker_stream_failed"
  | "claim_rejected"
  | "stale_stream_recovered"
  | "stale_input"
  | "user_stopped"
  | "worker_cancel_failed"
  | "persistence_failed"
  | "unknown";

export type AgentRunFailurePhase =
  | "claim"
  | "attach"
  | "worker_stream"
  | "persistence"
  | "client_stop"
  | "watchdog";

export type AgentRunFailure = {
  code: AgentRunFailureCode;
  phase: AgentRunFailurePhase;
  message: string;
  retryable: boolean;
  occurredAt: Date;
  reported?: {
    sentryEventId?: string;
    auditEventId?: string;
  };
};

export type AgentRunStreamLease = {
  id: string;
  startedAt: Date;
  heartbeatAt?: Date | null;
};

export type AgentRunDocument = {
  _id: string;
  appId: string;
  workspaceId: string;
  mode?: "builder" | "workspace_agent";
  selectedSkillRefs?: RunSkillReference[];
  workspaceAgentSnapshot?: WorkspaceAgentRunSnapshot | null;
  messages: unknown[];
  sessionState: ProviderSessionState | null;
  runtimeSessionStates?: Partial<Record<AgentRuntimeId, ProviderSessionState>>;
  attachments?: BuilderAttachmentReference[];
  pendingAttachments?: BuilderAttachmentReference[];
  activeStreamId: string | null;
  streamLease?: AgentRunStreamLease | null;
  failure?: AgentRunFailure | null;
  status: "pending" | "streaming" | "completed" | "failed";
  usage: RunUsage | null;
  /** Optional per-run prompt used to auto-start platform-created builder runs. */
  autoStartPrompt?: string | null;
  /** Compact metadata for platform recovery runs. Full details live in messages, not hot read models. */
  recoveryContext?: AgentRunRecoveryContext | null;
  createdAt: Date;
  updatedAt: Date;
};

export type IntegrationAccessLevel =
  | "read"
  | "write"
  | "delete_admin"
  | "mixed"
  | "unknown";

export type IntegrationAccessContract = {
  capabilityFingerprint: string;
  capabilityLabel: string;
  accessLevel: IntegrationAccessLevel;
  permissions: string[];
  secretNames: string[];
};

export type IntegrationCredentialBinding =
  | { mode: "none" }
  | { mode: "dedicated"; credentialId: string };

export type IntegrationAuthConfig =
  | {
      type: "static_secret";
    }
  | {
      type: "oauth2";
      providerKey: string;
      identity: "triggering_user";
      authorizationUrl: string;
      tokenUrl: string;
      scopes: string[];
      tokenAuthMethod?: "client_secret_post" | "client_secret_basic" | "none";
      authorizationParams?: Record<string, string>;
      tokenParams?: Record<string, string>;
      accessTokenPlacement?: {
        type: "bearer_authorization_header";
      };
    };

export type IntegrationDocument = {
  _id: string;
  workspaceId: string;
  appId: string;
  appName: string;
  name: string;
  domain: string;
  keySlug: string;
  keyName: string;
  keyPurpose?: string;
  setupGuide: string;
  faviconUrl: string;
  capabilityLabel: string;
  accessLevel: IntegrationAccessLevel;
  accessContract: IntegrationAccessContract;
  credentialBinding: IntegrationCredentialBinding;
  auth?: IntegrationAuthConfig;
  requestedByUserId: string;
  requestedByUserName: string;
  requestedAt: Date;
  permissionGroups?: IntegrationPermissionGroup[];
  /** Secret names/labels the integration setup expects, without secret values. */
  secretRequirements?: IntegrationSecretRequirement[];
  /** Latest setup instructions generated by the builder agent. */
  setupInstructions?: IntegrationSetupInstructions | null;
  visibility?: ResourceVisibility;
  teamIds?: string[];
  teamScopedKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type IntegrationCredentialDocument = {
  _id: string;
  workspaceId: string;
  name: string;
  domain: string;
  credentialName: string;
  configured: boolean;
  /** Secret name -> WorkOS Vault secret ID (production). */
  vaultSecretIds: Record<string, string>;
  /** Secret name -> value. Local development only, stored in plain text in MongoDB. */
  localSecrets: Record<string, string>;
  configuredPermissionGroups: IntegrationPermissionGroup[];
  configuredSecrets: string[];
  capabilityFingerprint: string;
  accessLevel: IntegrationAccessLevel;
  linkedGrantIds: string[];
  createdByUserId: string;
  createdByUserName: string;
  createdAt: Date;
  updatedAt: Date;
};

export type IntegrationGrantWithCredential = IntegrationDocument & {
  configured: boolean;
  configuredPermissionGroups: IntegrationPermissionGroup[];
  configuredSecrets: string[];
  credentialId: string | null;
  credentialName: string | null;
  vaultSecretIds: Record<string, string>;
  localSecrets: Record<string, string>;
};

export type OAuthTokenAuthMethod =
  | "client_secret_post"
  | "client_secret_basic"
  | "none";

export type OAuthProviderConfigDocument = {
  _id: string;
  workspaceId: string;
  providerKey: string;
  displayName: string;
  authorizationUrl: string;
  tokenUrl: string;
  tokenAuthMethod: OAuthTokenAuthMethod;
  defaultAuthorizationParams?: Record<string, string>;
  defaultTokenParams?: Record<string, string>;
  clientId: string | null;
  clientSecretRef: string | null;
  configured: boolean;
  createdByUserId: string;
  createdByUserName: string;
  configuredByUserId?: string | null;
  configuredByUserName?: string | null;
  configuredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ConnectedAccountSource =
  | "customer_oauth"
  | "local_direct"
  | "hosted_broker";

export type ConnectedAccountDocument = {
  _id: string;
  workspaceId: string;
  userId: string;
  providerConfigId: string;
  providerKey: string;
  source: ConnectedAccountSource;
  externalSubject?: string | null;
  accountEmail?: string | null;
  accountName?: string | null;
  grantedScopes: string[];
  refreshTokenRef?: string | null;
  accessTokenRef?: string | null;
  accessTokenExpiresAt?: Date | null;
  tokenType?: string | null;
  lastRefreshAt?: Date | null;
  lastRefreshError?: string | null;
  revokedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type IntegrationPermissionGroup = {
  name: string;
  description?: string;
  permissions: string[];
};

export type IntegrationSecretRequirement = {
  name: string;
  label?: string;
  description: string;
  required?: boolean;
};

export type IntegrationSetupStep = {
  title: string;
  description: string;
  url?: string;
};

export type IntegrationSetupLink = {
  label: string;
  url: string;
};

export type IntegrationSetupInstructions = {
  overview: string;
  steps: IntegrationSetupStep[];
  links?: IntegrationSetupLink[];
};

export type WorkspaceSkillDocument = {
  _id: string;
  workspaceId: string;
  slug: string;
  displayName: string;
  description: string;
  icon: string;
  tags: string[];
  visibility: ResourceVisibility;
  teamIds: string[];
  status: WorkspaceSkillStatus;
  createdByUserId: string;
  createdByName: string;
  currentRevisionId: string;
  currentRevisionNumber: number;
  currentRevisionHash: string;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkspaceSkillRevisionDocument = {
  _id: string;
  workspaceId: string;
  skillId: string;
  revisionNumber: number;
  bodyMarkdown: string;
  hash: string;
  createdByUserId: string;
  createdAt: Date;
};

export type WorkspaceAgentDocument = {
  _id: string;
  workspaceId: string;
  slug: string;
  avatarGradientSeed?: string | null;
  displayName: string;
  description: string;
  systemPrompt: string;
  visibility: ResourceVisibility;
  teamIds: string[];
  status: WorkspaceAgentStatus;
  approvalStatus: WorkspaceAgentApprovalStatus;
  selectedSkillIds: string[];
  selectedToolIds: string[];
  builtinTools: string[];
  model: string;
  createdByUserId: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
};

export type RunSkillReference = {
  skillId: string;
  revisionId: string;
  revisionNumber: number;
  revisionHash: string;
  slug: string;
  displayName: string;
  description: string;
};

export type WorkspaceAgentRunSnapshot = {
  agentId: string;
  slug: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  visibility: ResourceVisibility;
  teamIds: string[];
  approvalStatus: WorkspaceAgentApprovalStatus;
  selectedSkillRefs: RunSkillReference[];
  selectedToolIds: string[];
  builtinTools: string[];
  model: string;
  capturedAt: Date;
};

export type AppDataDocument = {
  _id: string;
  workspaceId: string;
  appId: string;
  collection: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type AppAgentRunDocument = {
  _id: string;
  appId: string;
  workspaceId: string;
  sourceVersion?: "draft" | "published";
  agentId: string;
  agentName: string;
  triggeredByUserId?: string;
  triggeredByUserEmail?: string;
  triggeredByUserName?: string;
  prompt: string;
  status: "pending" | "running" | "streaming" | "completed" | "failed";
  result: unknown | null;
  messages: unknown[];
  sessionState: ProviderSessionState | null;
  activeStreamId: string | null;
  usage: RunUsage | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AuditEventDocument = {
  _id: string;
  workspaceId: string;
  schemaVersion: 1;
  occurredAt: Date;
  observedAt: Date;
  eventName: string;
  category: AuditEventCategory;
  severity: AuditEventSeverity;
  outcome: AuditEventOutcome;
  actor: {
    kind: AuditActorKind;
    userId?: string;
    displayName?: string;
    email?: string;
    role?: WorkspaceRole;
    teamIds?: string[];
    agentId?: string;
    agentName?: string;
    appId?: string;
    appName?: string;
  };
  source: {
    kind: AuditSourceKind;
    trust: AuditSourceTrust;
    appId?: string;
    appName?: string;
    sourceVersion?: "draft" | "published";
    runId?: string;
    requestId?: string;
    traceId?: string;
    spanId?: string;
    ipHash?: string;
    userAgentHash?: string;
  };
  target: {
    type: AuditTargetType;
    id?: string;
    name?: string;
    parentType?: string;
    parentId?: string;
  };
  action: string;
  summary: string;
  metadata: Record<string, unknown>;
  changes?: {
    changedFields: string[];
    beforeHash?: string;
    afterHash?: string;
    redactedFields?: string[];
  };
  correlationId?: string;
  relatedIds?: {
    appId?: string;
    runId?: string;
    reviewRequestId?: string;
    integrationId?: string;
    agentRunId?: string;
    appDataDocumentId?: string;
  };
  retention: {
    policy: AuditRetentionPolicy;
    expiresAt?: Date | null;
    legalHold?: boolean;
  };
  createdAt: Date;
};
