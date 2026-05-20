import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import {
  getConnectedAccountsCollection,
  getIntegrationCredentialsCollection,
  getIntegrationsCollection,
  getOAuthProviderConfigsCollection,
} from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import { integrationIconUrl } from "@/lib/integration-icons";
import {
  oauthRevocationUrlForProvider,
  revokeOAuthTokenAtProvider,
} from "@/lib/oauth/revocation";
import { deleteOAuthSecret } from "@/lib/oauth/secret-store";
import {
  isHttpsUrl,
  normalizeOAuthProviderKey,
  normalizeOAuthStringMap,
  normalizeOAuthTokenAuthMethod,
  upsertOAuthProviderConfigShell,
} from "./oauth-provider-configs";
import type {
  IntegrationAccessContract,
  IntegrationAccessLevel,
  IntegrationAuthConfig,
  IntegrationCredentialDocument,
  IntegrationGrantWithCredential,
  IntegrationDocument,
  IntegrationPermissionGroup,
  IntegrationSecretRequirement,
  IntegrationSetupInstructions,
  IntegrationSetupLink,
  IntegrationSetupStep,
  OAuthProviderConfigDocument,
} from "@/lib/db/types";

type IntegrationRequester = {
  appId: string;
  appName: string;
  requestedByUserId: string;
  requestedByUserName: string;
};

type IntegrationRequirementInput = {
  workspaceId: string;
  name: string;
  domain: string;
  keySlug?: string;
  keyName?: string;
  iconUrl?: string;
  faviconUrl?: string;
  capabilityLabel?: string;
  requester: IntegrationRequester;
  setupGuide?: string;
  permissionGroups?: IntegrationPermissionGroup[];
  secretRequirements?: IntegrationSecretRequirement[];
  setupInstructions?: IntegrationSetupInstructions | null;
  auth?: IntegrationAuthConfig;
};

type OAuthProviderCleanupResult = {
  providerKey: string;
  providerConfigId: string | null;
  deletedProviderConfig: boolean;
  deletedConnectedAccountCount: number;
  deletedSecretCount: number;
  providerRevocationAttemptCount: number;
  providerRevocationSuccessCount: number;
};

export type DeleteIntegrationResult = {
  deleted: boolean;
  oauthProviderCleanup?: OAuthProviderCleanupResult;
};

export type ResetIntegrationResult = {
  reset: boolean;
  oauthProviderCleanup?: OAuthProviderCleanupResult;
};

export type SyncedIntegrationRequirement = {
  id: string;
  name: string;
  domain: string;
  keySlug: string;
};

export type SyncIntegrationSetupInstructionsResult = {
  grants: SyncedIntegrationRequirement[];
  requestedCount: number;
  skippedCount: number;
  deletedStaleCount: number;
};

export type IntegrationSetupConfig = {
  integrations?: Array<{
    name?: string;
    domain?: string;
    keySlug?: string;
    keyName?: string;
    iconUrl?: string;
    faviconUrl?: string;
    capabilityLabel?: string;
    why?: string;
    overview?: string;
    permissionGroups?: unknown;
    secrets?: unknown;
    secretRequirements?: unknown;
    steps?: unknown;
    links?: unknown;
    setupInstructions?: unknown;
    auth?: unknown;
  }>;
};

export function normalizeIntegrationDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

export function normalizeIntegrationKeySlug(value?: string | null): string {
  const normalized = (value ?? "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "default";
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

async function deleteOAuthProviderConfigurationForWorkspace(input: {
  workspaceId: string;
  providerKey: string;
}): Promise<OAuthProviderCleanupResult | undefined> {
  const providerConfigsCollection = await getOAuthProviderConfigsCollection();
  const connectedAccountsCollection = await getConnectedAccountsCollection();
  const providerKey = normalizeOAuthProviderKey(input.providerKey);
  const providerConfig = await providerConfigsCollection.findOne({
    workspaceId: input.workspaceId,
    providerKey,
  });

  if (!providerConfig) return undefined;

  const connectedAccounts = await connectedAccountsCollection
    .find({
      workspaceId: input.workspaceId,
      providerConfigId: providerConfig._id,
    })
    .toArray();
  const secretRefs = [
    providerConfig.clientSecretRef,
    ...connectedAccounts.flatMap((account) => [
      account.refreshTokenRef,
      account.accessTokenRef,
    ]),
  ].filter((ref): ref is string => typeof ref === "string" && ref.length > 0);
  const providerRevocationRefs = oauthRevocationUrlForProvider(providerKey)
    ? connectedAccounts.flatMap((account) =>
        account.refreshTokenRef ? [account.refreshTokenRef] : [],
      )
    : [];
  const providerRevocationResults = await Promise.all(
    providerRevocationRefs.map((ref) =>
      revokeOAuthTokenAtProvider({
        providerKey,
        tokenRef: ref,
      }),
    ),
  );

  await Promise.all(
    secretRefs.map((ref) => deleteOAuthSecret(ref).catch(() => undefined)),
  );
  await connectedAccountsCollection.deleteMany({
    workspaceId: input.workspaceId,
    providerConfigId: providerConfig._id,
  });
  await providerConfigsCollection.deleteOne({
    _id: providerConfig._id,
    workspaceId: input.workspaceId,
  });

  return {
    providerKey,
    providerConfigId: providerConfig._id,
    deletedProviderConfig: true,
    deletedConnectedAccountCount: connectedAccounts.length,
    deletedSecretCount: secretRefs.length,
    providerRevocationAttemptCount: providerRevocationRefs.length,
    providerRevocationSuccessCount: providerRevocationResults.filter(Boolean)
      .length,
  };
}

async function resetOAuthProviderConfigurationForWorkspace(input: {
  workspaceId: string;
  providerKey: string;
}): Promise<OAuthProviderCleanupResult | undefined> {
  const providerConfigsCollection = await getOAuthProviderConfigsCollection();
  const connectedAccountsCollection = await getConnectedAccountsCollection();
  const providerKey = normalizeOAuthProviderKey(input.providerKey);
  const providerConfig = await providerConfigsCollection.findOne({
    workspaceId: input.workspaceId,
    providerKey,
  });

  if (!providerConfig) return undefined;

  const connectedAccounts = await connectedAccountsCollection
    .find({
      workspaceId: input.workspaceId,
      providerConfigId: providerConfig._id,
    })
    .toArray();
  const secretRefs = [
    providerConfig.clientSecretRef,
    ...connectedAccounts.flatMap((account) => [
      account.refreshTokenRef,
      account.accessTokenRef,
    ]),
  ].filter((ref): ref is string => typeof ref === "string" && ref.length > 0);
  const providerRevocationRefs = oauthRevocationUrlForProvider(providerKey)
    ? connectedAccounts.flatMap((account) =>
        account.refreshTokenRef ? [account.refreshTokenRef] : [],
      )
    : [];
  const providerRevocationResults = await Promise.all(
    providerRevocationRefs.map((ref) =>
      revokeOAuthTokenAtProvider({
        providerKey,
        tokenRef: ref,
      }),
    ),
  );

  await Promise.all(
    secretRefs.map((ref) => deleteOAuthSecret(ref).catch(() => undefined)),
  );
  await connectedAccountsCollection.deleteMany({
    workspaceId: input.workspaceId,
    providerConfigId: providerConfig._id,
  });
  await providerConfigsCollection.updateOne(
    { _id: providerConfig._id, workspaceId: input.workspaceId },
    {
      $set: {
        clientId: null,
        clientSecretRef: null,
        configured: false,
        configuredByUserId: null,
        configuredByUserName: null,
        configuredAt: null,
        updatedAt: new Date(),
      },
    },
  );

  return {
    providerKey,
    providerConfigId: providerConfig._id,
    deletedProviderConfig: false,
    deletedConnectedAccountCount: connectedAccounts.length,
    deletedSecretCount: secretRefs.length,
    providerRevocationAttemptCount: providerRevocationRefs.length,
    providerRevocationSuccessCount: providerRevocationResults.filter(Boolean)
      .length,
  };
}

async function deleteOAuthProviderConfigurationIfUnused(input: {
  workspaceId: string;
  providerKey: string;
}): Promise<OAuthProviderCleanupResult | undefined> {
  const grantsCollection = await getIntegrationsCollection();
  const remainingGrantCount = await grantsCollection.countDocuments({
    workspaceId: input.workspaceId,
    "auth.type": "oauth2",
    "auth.providerKey": normalizeOAuthProviderKey(input.providerKey),
  });

  if (remainingGrantCount > 0) return undefined;
  return deleteOAuthProviderConfigurationForWorkspace(input);
}

function normalizePermissionGroups(value: unknown): IntegrationPermissionGroup[] {
  if (!Array.isArray(value)) return [];

  const groups: IntegrationPermissionGroup[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;

    const permissions = Array.isArray(record.permissions)
      ? uniqueStrings(
          record.permissions.filter((p): p is string => typeof p === "string"),
        )
      : [];

    groups.push({
      name,
      ...(typeof record.description === "string" && record.description.trim()
        ? { description: record.description.trim() }
        : {}),
      permissions,
    });
  }

  return groups;
}

function normalizeSecretRequirements(value: unknown): IntegrationSecretRequirement[] {
  if (!Array.isArray(value)) return [];

  const secrets: IntegrationSecretRequirement[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const name = item.trim();
      if (!name) continue;
      secrets.push({
        name,
        description: `Paste the ${name} value for this integration.`,
        required: true,
      });
      continue;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;

    secrets.push({
      name,
      ...(typeof record.label === "string" && record.label.trim()
        ? { label: record.label.trim() }
        : {}),
      description:
        typeof record.description === "string" && record.description.trim()
          ? record.description.trim()
          : `Paste the ${name} value for this integration.`,
      required: typeof record.required === "boolean" ? record.required : true,
    });
  }

  const seen = new Set<string>();
  return secrets.filter((secret) => {
    const key = secret.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSetupSteps(value: unknown): IntegrationSetupStep[] {
  if (!Array.isArray(value)) return [];

  const steps: IntegrationSetupStep[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    if (!title || !description) continue;
    steps.push({
      title,
      description,
      ...(typeof record.url === "string" && record.url.trim()
        ? { url: record.url.trim() }
        : {}),
    });
  }

  return steps;
}

function normalizeSetupLinks(value: unknown): IntegrationSetupLink[] {
  if (!Array.isArray(value)) return [];

  const links: IntegrationSetupLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!label || !url) continue;
    links.push({ label, url });
  }

  return links;
}

function normalizeSetupInstructions(
  value: unknown,
  fallbackOverview?: string,
): IntegrationSetupInstructions | null {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const overview =
    (record && typeof record.overview === "string" && record.overview.trim()
      ? record.overview.trim()
      : fallbackOverview?.trim()) ?? "";
  const steps = normalizeSetupSteps(record?.steps);
  const links = normalizeSetupLinks(record?.links);

  if (!overview || steps.length === 0) return null;

  return {
    overview,
    steps,
    ...(links.length > 0 ? { links } : {}),
  };
}

function normalizeOAuthAuthConfig(value: unknown): IntegrationAuthConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.type !== "oauth2") return null;

  const providerKey =
    typeof record.providerKey === "string"
      ? normalizeOAuthProviderKey(record.providerKey)
      : "";
  const identity = record.identity === "triggering_user"
    ? "triggering_user"
    : null;
  const authorizationUrl =
    typeof record.authorizationUrl === "string"
      ? record.authorizationUrl.trim()
      : typeof record.authorize_url === "string"
        ? record.authorize_url.trim()
        : "";
  const tokenUrl =
    typeof record.tokenUrl === "string"
      ? record.tokenUrl.trim()
      : typeof record.token_url === "string"
        ? record.token_url.trim()
        : "";
  const scopes = Array.isArray(record.scopes)
    ? uniqueStrings(record.scopes.filter((scope): scope is string => typeof scope === "string"))
    : [];

  if (
    !providerKey ||
    identity !== "triggering_user" ||
    !isHttpsUrl(authorizationUrl) ||
    !isHttpsUrl(tokenUrl) ||
    scopes.length === 0
  ) {
    return null;
  }

  return {
    type: "oauth2",
    providerKey,
    identity,
    authorizationUrl,
    tokenUrl,
    scopes,
    tokenAuthMethod: normalizeOAuthTokenAuthMethod(record.tokenAuthMethod),
    ...(normalizeOAuthStringMap(record.authorizationParams)
      ? { authorizationParams: normalizeOAuthStringMap(record.authorizationParams) }
      : {}),
    ...(normalizeOAuthStringMap(record.tokenParams)
      ? { tokenParams: normalizeOAuthStringMap(record.tokenParams) }
      : {}),
    accessTokenPlacement: { type: "bearer_authorization_header" },
  };
}

export function normalizeIntegrationAuthConfig(
  value: unknown,
): IntegrationAuthConfig {
  return normalizeOAuthAuthConfig(value) ?? { type: "static_secret" };
}

function permissionKey(groupName: string, permission: string): string {
  return `${groupName.trim().toLowerCase()}::${permission.trim().toLowerCase()}`;
}

function inferAccessLevel(
  permissionGroups: IntegrationPermissionGroup[],
): IntegrationAccessLevel {
  const text = permissionGroups
    .flatMap((group) => [group.name, group.description ?? "", ...group.permissions])
    .join(" ")
    .toLowerCase();

  if (/\b(delete|admin|manage|permission|owner|destructive)\b/.test(text)) {
    return "delete_admin";
  }
  if (/\b(write|create|update|edit|send|post|comment|upload|mutate|mutation)\b/.test(text)) {
    return "write";
  }
  if (/\b(read|list|search|get|view|lookup|history|metadata)\b/.test(text)) {
    return "read";
  }
  return "unknown";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildAccessContract(input: {
  name: string;
  domain: string;
  capabilityLabel?: string;
  permissionGroups: IntegrationPermissionGroup[];
  secretRequirements: IntegrationSecretRequirement[];
  auth?: IntegrationAuthConfig;
}): IntegrationAccessContract {
  const accessLevel = inferAccessLevel(input.permissionGroups);
  const permissions = uniqueStrings(
    input.permissionGroups.flatMap((group) =>
      (group.permissions ?? []).map((permission) =>
        `${group.name.trim().toLowerCase()}:${permission.trim().toLowerCase()}`,
      ),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const secretNames = uniqueStrings(
    input.auth?.type === "oauth2"
      ? []
      : input.secretRequirements.map((secret) => secret.name),
  )
    .map((secret) => secret.toUpperCase())
    .sort((a, b) => a.localeCompare(b));
  const capabilityLabel =
    input.capabilityLabel?.trim() ||
    `${input.name} ${accessLevel === "unknown" ? "access" : accessLevel.replace("_", "/")}`;
  const fingerprintInput = {
    domain: normalizeIntegrationDomain(input.domain),
    accessLevel,
    permissions,
    secretNames,
    auth:
      input.auth?.type === "oauth2"
        ? {
            type: "oauth2",
            providerKey: input.auth.providerKey,
            authorizationUrl: input.auth.authorizationUrl,
            tokenUrl: input.auth.tokenUrl,
            scopes: input.auth.scopes,
          }
        : { type: "static_secret" },
  };

  return {
    capabilityFingerprint: createHash("sha256")
      .update(stableStringify(fingerprintInput))
      .digest("hex"),
    capabilityLabel,
    accessLevel,
    permissions,
    secretNames,
  };
}

function credentialIdFromGrant(
  grant: Pick<IntegrationDocument, "credentialBinding">,
): string | null {
  return grant.credentialBinding.mode === "dedicated"
    ? grant.credentialBinding.credentialId
    : null;
}

function joinGrant(
  grant: IntegrationDocument,
  credential: IntegrationCredentialDocument | null,
  oauthConfigured = false,
): IntegrationGrantWithCredential {
  return {
    ...grant,
    configured:
      grant.auth?.type === "oauth2"
        ? oauthConfigured
        : credential?.configured ?? false,
    configuredPermissionGroups: credential?.configuredPermissionGroups ?? [],
    configuredSecrets: credential?.configuredSecrets ?? [],
    credentialId: credential?._id ?? null,
    credentialName: credential?.credentialName ?? null,
    vaultSecretIds: credential?.vaultSecretIds ?? {},
    localSecrets: credential?.localSecrets ?? {},
  };
}

function oauthProviderConfigMatchesGrant(
  config: OAuthProviderConfigDocument | undefined,
  grant: IntegrationDocument,
): boolean {
  if (grant.auth?.type !== "oauth2" || !config?.configured) return false;
  return (
    config.authorizationUrl === grant.auth.authorizationUrl &&
    config.tokenUrl === grant.auth.tokenUrl &&
    config.tokenAuthMethod ===
      (grant.auth.tokenAuthMethod ?? "client_secret_post")
  );
}

async function joinGrantsWithCredentials(
  grants: IntegrationDocument[],
): Promise<IntegrationGrantWithCredential[]> {
  if (grants.length === 0) return [];

  const credentialIds = uniqueStrings(
    grants.flatMap((grant) => {
      const credentialId = credentialIdFromGrant(grant);
      return credentialId ? [credentialId] : [];
    }),
  );
  const credentialsCollection = await getIntegrationCredentialsCollection();
  const credentials = credentialIds.length
    ? await credentialsCollection
        .find({
          workspaceId: grants[0].workspaceId,
          _id: { $in: credentialIds },
        })
        .toArray()
    : [];
  const credentialById = new Map(
    credentials.map((credential) => [credential._id, credential]),
  );
  const oauthGrants = grants.filter((grant) => grant.auth?.type === "oauth2");
  const oauthConfiguredByGrantId = new Map<string, boolean>();

  if (oauthGrants.length > 0) {
    const workspaceIds = uniqueStrings(oauthGrants.map((grant) => grant.workspaceId));
    const providerKeys = uniqueStrings(
      oauthGrants.flatMap((grant) =>
        grant.auth?.type === "oauth2" ? [grant.auth.providerKey] : [],
      ),
    );
    const providerConfigsCollection = await getOAuthProviderConfigsCollection();
    const providerConfigs = await providerConfigsCollection
      .find({
        workspaceId: { $in: workspaceIds },
        providerKey: { $in: providerKeys },
      })
      .toArray();
    const providerConfigByWorkspaceKey = new Map(
      providerConfigs.map((config) => [
        `${config.workspaceId}:${config.providerKey}`,
        config,
      ]),
    );

    for (const grant of oauthGrants) {
      const auth = grant.auth;
      if (auth?.type !== "oauth2") continue;
      const config = providerConfigByWorkspaceKey.get(
        `${grant.workspaceId}:${auth.providerKey}`,
      );
      oauthConfiguredByGrantId.set(
        grant._id,
        oauthProviderConfigMatchesGrant(config, grant),
      );
    }
  }

  return grants.map((grant) => {
    const credentialId = credentialIdFromGrant(grant);
    return joinGrant(
      grant,
      credentialId ? credentialById.get(credentialId) ?? null : null,
      oauthConfiguredByGrantId.get(grant._id) ?? false,
    );
  });
}

export function integrationNeedsSetup(
  integration: Pick<
    IntegrationGrantWithCredential,
    | "configured"
    | "auth"
    | "permissionGroups"
    | "secretRequirements"
    | "configuredPermissionGroups"
    | "configuredSecrets"
>,
): boolean {
  if (integration.auth?.type === "oauth2") return !integration.configured;
  if (!integration.configured) return true;

  const configuredPermissions = new Set<string>();
  for (const group of integration.configuredPermissionGroups ?? []) {
    for (const permission of group.permissions ?? []) {
      configuredPermissions.add(permissionKey(group.name, permission));
    }
  }

  for (const group of integration.permissionGroups ?? []) {
    for (const permission of group.permissions ?? []) {
      if (!configuredPermissions.has(permissionKey(group.name, permission))) {
        return true;
      }
    }
  }

  const configuredSecrets = new Set(
    (integration.configuredSecrets ?? []).map((secret) =>
      secret.trim().toLowerCase(),
    ),
  );

  return (integration.secretRequirements ?? [])
    .filter((secret) => secret.required !== false)
    .some((secret) => !configuredSecrets.has(secret.name.trim().toLowerCase()));
}

async function upsertIntegrationRequirement(
  input: IntegrationRequirementInput,
): Promise<string> {
  const collection = await getIntegrationsCollection();
  const now = new Date();
  const domain = normalizeIntegrationDomain(input.domain);
  const keySlug = normalizeIntegrationKeySlug(input.keySlug);
  const existing = await collection.findOne({
    workspaceId: input.workspaceId,
    appId: input.requester.appId,
    domain,
    keySlug,
  });
  const permissionGroups = input.permissionGroups ?? existing?.permissionGroups ?? [];
  const secretRequirements =
    input.secretRequirements ?? existing?.secretRequirements ?? [];
  const accessContract = buildAccessContract({
    name: input.name,
    domain,
    capabilityLabel: input.capabilityLabel,
    permissionGroups,
    secretRequirements,
    auth: input.auth,
  });
  const grantId = existing?._id ?? new ObjectId().toHexString();
  const auth = input.auth ?? existing?.auth ?? { type: "static_secret" as const };
  const faviconUrl = integrationIconUrl({
    name: input.name,
    domain,
    iconUrl: input.iconUrl,
    faviconUrl: input.faviconUrl,
    auth: auth.type === "oauth2" ? auth : undefined,
  });

  await collection.updateOne(
    {
      workspaceId: input.workspaceId,
      appId: input.requester.appId,
      domain,
      keySlug,
    },
    {
      $set: {
        name: input.name,
        appName: input.requester.appName,
        setupGuide: input.setupGuide ?? existing?.setupGuide ?? "",
        keyName:
          input.keyName?.trim() ||
          existing?.keyName ||
          `${input.name} key for ${input.requester.appName}`,
        capabilityLabel: accessContract.capabilityLabel,
        accessLevel: accessContract.accessLevel,
        accessContract,
        auth,
        faviconUrl,
        requestedByUserId: input.requester.requestedByUserId,
        requestedByUserName: input.requester.requestedByUserName,
        permissionGroups,
        secretRequirements,
        setupInstructions:
          input.setupInstructions !== undefined
            ? input.setupInstructions
            : existing?.setupInstructions ?? null,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: grantId,
        workspaceId: input.workspaceId,
        appId: input.requester.appId,
        domain,
        keySlug,
        credentialBinding: { mode: "none" },
        requestedAt: now,
        visibility: "workspace",
        teamIds: [],
        teamScopedKey: null,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  publishWorkspaceEvent({
    type: "integration.changed",
    workspaceId: input.workspaceId,
    scope: "integrations",
    appId: input.requester.appId,
    integrationId: grantId,
    keySlug,
  });

  return grantId;
}

export async function listIntegrationsForWorkspace(
  workspaceId: string,
): Promise<IntegrationGrantWithCredential[]> {
  const collection = await getIntegrationsCollection();
  const grants = await collection
    .find({ workspaceId, appId: { $exists: true } })
    .sort({ appName: 1, name: 1, keySlug: 1 })
    .toArray();
  return joinGrantsWithCredentials(grants);
}

export async function listIntegrationsForAppReview(input: {
  workspaceId: string;
  appId: string;
}): Promise<IntegrationGrantWithCredential[]> {
  const collection = await getIntegrationsCollection();
  const grants = await collection
    .find({
      workspaceId: input.workspaceId,
      appId: input.appId,
    })
    .sort({ name: 1, keySlug: 1 })
    .toArray();
  return joinGrantsWithCredentials(grants);
}

export async function findIntegrationGrantForTool(input: {
  workspaceId: string;
  appId: string;
  domain: string;
  keySlug?: string | null;
}): Promise<IntegrationGrantWithCredential | null> {
  const collection = await getIntegrationsCollection();
  const grant = await collection.findOne({
    workspaceId: input.workspaceId,
    appId: input.appId,
    domain: normalizeIntegrationDomain(input.domain),
    keySlug: normalizeIntegrationKeySlug(input.keySlug),
  });
  if (!grant) return null;
  const [joined] = await joinGrantsWithCredentials([grant]);
  return joined ?? null;
}

export async function findIntegrationById(
  integrationId: string,
  workspaceId: string,
): Promise<IntegrationGrantWithCredential | null> {
  const collection = await getIntegrationsCollection();
  const grant = await collection.findOne({ _id: integrationId, workspaceId });
  if (!grant) return null;
  const [joined] = await joinGrantsWithCredentials([grant]);
  return joined ?? null;
}

export async function updateIntegrationSecrets(input: {
  workspaceId: string;
  integrationId: string;
  actor?: { userId: string; userName: string };
  update: {
    vaultSecretIds?: Record<string, string>;
    localSecrets?: Record<string, string>;
    configured: boolean;
    configuredPermissionGroups?: IntegrationPermissionGroup[];
    configuredSecrets?: string[];
  };
}): Promise<void> {
  const grantsCollection = await getIntegrationsCollection();
  const credentialsCollection = await getIntegrationCredentialsCollection();
  const grant = await grantsCollection.findOne({
    _id: input.integrationId,
    workspaceId: input.workspaceId,
  });
  if (!grant) return;

  const now = new Date();
  const credentialId =
    grant.credentialBinding.mode === "dedicated"
      ? grant.credentialBinding.credentialId
      : `credential_${grant._id}`;
  const existingCredential = await credentialsCollection.findOne({
    _id: credentialId,
    workspaceId: input.workspaceId,
  });

  const vaultSecretIds =
    input.update.vaultSecretIds ?? existingCredential?.vaultSecretIds ?? {};
  const localSecrets =
    input.update.localSecrets ?? existingCredential?.localSecrets ?? {};
  const configuredSecrets =
    input.update.configuredSecrets ??
    uniqueStrings([
      ...Object.keys(vaultSecretIds),
      ...Object.keys(localSecrets),
    ]);

  await credentialsCollection.updateOne(
    { _id: credentialId, workspaceId: input.workspaceId },
    {
      $set: {
        name: grant.name,
        domain: grant.domain,
        credentialName: grant.keyName,
        configured: input.update.configured,
        vaultSecretIds,
        localSecrets,
        configuredPermissionGroups:
          input.update.configuredPermissionGroups ?? grant.permissionGroups ?? [],
        configuredSecrets,
        capabilityFingerprint: grant.accessContract.capabilityFingerprint,
        accessLevel: grant.accessLevel,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: credentialId,
        workspaceId: input.workspaceId,
        createdByUserId:
          input.actor?.userId || grant.requestedByUserId || "system",
        createdByUserName:
          input.actor?.userName || grant.requestedByUserName || "Second",
        createdAt: now,
      },
      $addToSet: { linkedGrantIds: grant._id },
    },
    { upsert: true },
  );

  await grantsCollection.updateOne(
    { _id: grant._id, workspaceId: input.workspaceId },
    {
      $set: {
        credentialBinding: { mode: "dedicated", credentialId },
        updatedAt: now,
      },
    },
  );

  publishWorkspaceEvent({
    type: "integration.changed",
    workspaceId: input.workspaceId,
    scope: "integrations",
    appId: grant.appId,
    integrationId: grant._id,
    credentialId,
    keySlug: grant.keySlug,
  });
}

export async function resetIntegrationConfiguration(input: {
  workspaceId: string;
  integrationId: string;
}): Promise<ResetIntegrationResult> {
  const grantsCollection = await getIntegrationsCollection();
  const credentialsCollection = await getIntegrationCredentialsCollection();
  const grant = await grantsCollection.findOne({
    _id: input.integrationId,
    workspaceId: input.workspaceId,
  });
  if (!grant) return { reset: false };

  if (grant.auth?.type === "oauth2") {
    const oauthProviderCleanup = await resetOAuthProviderConfigurationForWorkspace({
      workspaceId: input.workspaceId,
      providerKey: grant.auth.providerKey,
    });

    await grantsCollection.updateOne(
      { _id: input.integrationId, workspaceId: input.workspaceId },
      { $set: { updatedAt: new Date() } },
    );

    publishWorkspaceEvent({
      type: "integration.changed",
      workspaceId: input.workspaceId,
      scope: "integrations",
      appId: grant.appId,
      integrationId: grant._id,
      keySlug: grant.keySlug,
    });

    return {
      reset: true,
      oauthProviderCleanup,
    };
  }

  const credentialId = credentialIdFromGrant(grant);
  if (credentialId) {
    await credentialsCollection.updateOne(
      { _id: credentialId, workspaceId: input.workspaceId },
      {
        $set: {
          configured: false,
          vaultSecretIds: {},
          localSecrets: {},
          configuredPermissionGroups: [],
          configuredSecrets: [],
          updatedAt: new Date(),
        },
      },
    );
  }

  await grantsCollection.updateOne(
    { _id: input.integrationId, workspaceId: input.workspaceId },
    { $set: { updatedAt: new Date() } },
  );

  publishWorkspaceEvent({
    type: "integration.changed",
    workspaceId: input.workspaceId,
    scope: "integrations",
    appId: grant.appId,
    integrationId: grant._id,
    credentialId,
    keySlug: grant.keySlug,
  });

  return { reset: true };
}

export async function deleteIntegration(input: {
  workspaceId: string;
  integrationId: string;
}): Promise<DeleteIntegrationResult> {
  const grantsCollection = await getIntegrationsCollection();
  const credentialsCollection = await getIntegrationCredentialsCollection();
  const grant = await grantsCollection.findOne({
    _id: input.integrationId,
    workspaceId: input.workspaceId,
  });
  if (!grant) return { deleted: false };

  const credentialId = credentialIdFromGrant(grant);
  if (credentialId) {
    const credential = await credentialsCollection.findOne({
      _id: credentialId,
      workspaceId: input.workspaceId,
    });
    if ((credential?.linkedGrantIds ?? []).length <= 1) {
      await credentialsCollection.deleteOne({
        _id: credentialId,
        workspaceId: input.workspaceId,
      });
    } else {
      await credentialsCollection.updateOne(
        { _id: credentialId, workspaceId: input.workspaceId },
        {
          $pull: { linkedGrantIds: grant._id },
          $set: { updatedAt: new Date() },
        },
      );
    }
  }

  const result = await grantsCollection.deleteOne({
    _id: input.integrationId,
    workspaceId: input.workspaceId,
  });
  if (result.deletedCount === 0) return { deleted: false };

  const oauthProviderCleanup =
    grant.auth?.type === "oauth2"
      ? await deleteOAuthProviderConfigurationIfUnused({
          workspaceId: input.workspaceId,
          providerKey: grant.auth.providerKey,
        })
      : undefined;

  if (result.deletedCount > 0) {
    publishWorkspaceEvent({
      type: "integration.changed",
      workspaceId: input.workspaceId,
      scope: "integrations",
      appId: grant.appId,
      integrationId: grant._id,
      credentialId,
      keySlug: grant.keySlug,
    });
  }

  return {
    deleted: true,
    oauthProviderCleanup,
  };
}

export async function syncIntegrationSetupInstructions(input: {
  workspaceId: string;
  setupConfig: IntegrationSetupConfig;
  requester: IntegrationRequester;
}): Promise<SyncIntegrationSetupInstructionsResult> {
  const setupItems = input.setupConfig?.integrations ?? [];
  const activeGrantIds: string[] = [];
  const grants: SyncedIntegrationRequirement[] = [];
  let skippedCount = 0;

  for (const item of setupItems) {
    if (!item?.domain) {
      skippedCount += 1;
      continue;
    }
    const domain = normalizeIntegrationDomain(item.domain);
    const name = item.name?.trim() || domain;
    const keySlug = normalizeIntegrationKeySlug(item.keySlug);
    const permissionGroups = normalizePermissionGroups(item.permissionGroups);
    const secretRequirements = normalizeSecretRequirements(
      item.secretRequirements ?? item.secrets,
    );
    const auth = normalizeOAuthAuthConfig(item.auth);
    if (item.auth && !auth) {
      skippedCount += 1;
      continue;
    }
    if (auth?.type === "oauth2") {
      await deleteOAuthProviderConfigurationIfUnused({
        workspaceId: input.workspaceId,
        providerKey: auth.providerKey,
      });
    }
    const setupInstructions =
      normalizeSetupInstructions(item.setupInstructions) ??
      normalizeSetupInstructions(
        {
          overview: item.overview ?? item.why,
          steps: item.steps,
          links: item.links,
        },
        item.overview ?? item.why,
      );

    const grantId = await upsertIntegrationRequirement({
      workspaceId: input.workspaceId,
      name,
      domain,
      keySlug: item.keySlug,
      keyName: item.keyName,
      iconUrl: item.iconUrl,
      faviconUrl: item.faviconUrl,
      capabilityLabel: item.capabilityLabel,
      requester: input.requester,
      permissionGroups,
      secretRequirements: auth?.type === "oauth2" ? [] : secretRequirements,
      setupInstructions,
      auth: auth ?? { type: "static_secret" },
    });
    grants.push({ id: grantId, name, domain, keySlug });
    if (auth?.type === "oauth2") {
      await upsertOAuthProviderConfigShell({
        workspaceId: input.workspaceId,
        providerKey: auth.providerKey,
        displayName: name,
        authorizationUrl: auth.authorizationUrl,
        tokenUrl: auth.tokenUrl,
        tokenAuthMethod: auth.tokenAuthMethod,
        defaultAuthorizationParams: auth.authorizationParams,
        defaultTokenParams: auth.tokenParams,
        createdByUserId: input.requester.requestedByUserId,
        createdByUserName: input.requester.requestedByUserName,
      });
    }
    activeGrantIds.push(grantId);
  }

  const collection = await getIntegrationsCollection();
  const staleGrants = await collection
    .find({
      workspaceId: input.workspaceId,
      appId: input.requester.appId,
      _id: { $nin: activeGrantIds },
    })
    .toArray();

  for (const staleGrant of staleGrants) {
    await deleteIntegration({
      workspaceId: input.workspaceId,
      integrationId: staleGrant._id,
    });
  }

  return {
    grants,
    requestedCount: setupItems.length,
    skippedCount,
    deletedStaleCount: staleGrants.length,
  };
}

export async function syncIntegrationSetupInstructionsFromJson(input: {
  workspaceId: string;
  setupJsonRaw: string;
  requester: IntegrationRequester;
}): Promise<void> {
  let parsed: IntegrationSetupConfig;
  try {
    parsed = JSON.parse(input.setupJsonRaw) as IntegrationSetupConfig;
  } catch {
    return;
  }

  await syncIntegrationSetupInstructions({
    workspaceId: input.workspaceId,
    setupConfig: parsed,
    requester: input.requester,
  });
}
