import { createHash } from "node:crypto";
import type { AppDocument } from "@/lib/db/types";

const AGENTS_JSON_APPROVAL_SCHEMA_VERSION = 1;
const SUPPORTED_AGENTS_JSON_APPROVAL_SCHEMA_VERSIONS = [
  AGENTS_JSON_APPROVAL_SCHEMA_VERSION,
] as const;

type AgentsJsonApprovalSchemaVersion =
  (typeof SUPPORTED_AGENTS_JSON_APPROVAL_SCHEMA_VERSIONS)[number];

export type AgentsJsonSnapshot = {
  hash: string;
  payload: unknown;
  canonicalJson: string;
  schemaVersion: AgentsJsonApprovalSchemaVersion;
};

export class InvalidAgentsJsonError extends Error {
  constructor(message = "Invalid agents.json") {
    super(message);
    this.name = "InvalidAgentsJsonError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item !== undefined) {
        result[key] = canonicalizeJsonValue(item);
      }
    }
    return result;
  }

  return value;
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}

function normalizeAgentForApprovalV1(agent: unknown): unknown {
  if (!isRecord(agent)) return agent;

  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(agent)) {
    if (
      (key === "tools" || key === "dataCollections") &&
      Array.isArray(item) &&
      item.length === 0
    ) {
      continue;
    }
    normalized[key] = item;
  }

  return normalized;
}

function normalizeAgentsJsonPayloadForApprovalV1(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "agents" && Array.isArray(item)) {
      if (item.length > 0) {
        normalized.agents = item.map(normalizeAgentForApprovalV1);
      }
      continue;
    }

    if (key === "appTools" && Array.isArray(item)) {
      if (item.length > 0) {
        normalized.appTools = item;
      }
      continue;
    }

    normalized[key] = item;
  }

  return normalized;
}

export function normalizeAgentsJsonPayloadForApproval(value: unknown): unknown {
  return normalizeAgentsJsonPayloadForApprovalV1(value);
}

function validateAgentsJsonPayload(value: unknown): void {
  if (!isRecord(value)) {
    throw new InvalidAgentsJsonError(
      "agents.json must contain a non-empty agents or appTools array",
    );
  }

  const hasAgents = Array.isArray(value.agents) && value.agents.length > 0;
  const hasAppTools = Array.isArray(value.appTools) && value.appTools.length > 0;
  if (!hasAgents && !hasAppTools) {
    throw new InvalidAgentsJsonError(
      "agents.json must contain a non-empty agents or appTools array",
    );
  }
}

function isSupportedApprovalSchemaVersion(
  version: number,
): version is AgentsJsonApprovalSchemaVersion {
  return SUPPORTED_AGENTS_JSON_APPROVAL_SCHEMA_VERSIONS.includes(
    version as AgentsJsonApprovalSchemaVersion,
  );
}

function parseApprovalSchemaVersion(
  hash: string | null | undefined,
): AgentsJsonApprovalSchemaVersion | null {
  const match = hash?.match(/^v(\d+):/);
  if (!match) return null;

  const version = Number(match[1]);
  return isSupportedApprovalSchemaVersion(version) ? version : null;
}

function resolveApprovalSchemaVersionForHash(
  hash: string | null | undefined,
): AgentsJsonApprovalSchemaVersion {
  return parseApprovalSchemaVersion(hash) ?? AGENTS_JSON_APPROVAL_SCHEMA_VERSION;
}

function normalizeAgentsJsonPayloadForVersion(
  value: unknown,
  version: AgentsJsonApprovalSchemaVersion,
): unknown {
  switch (version) {
    case 1:
      return normalizeAgentsJsonPayloadForApprovalV1(value);
  }
}

function versionedAgentsJsonApprovalHash(input: {
  canonicalJson: string;
  schemaVersion: AgentsJsonApprovalSchemaVersion;
}): string {
  const digest = createHash("sha256").update(input.canonicalJson).digest("hex");
  return `v${input.schemaVersion}:${digest}`;
}

export function readAgentsJsonSnapshot(
  sourceFiles: Record<string, string> | null | undefined,
  schemaVersion: AgentsJsonApprovalSchemaVersion =
    AGENTS_JSON_APPROVAL_SCHEMA_VERSION,
): AgentsJsonSnapshot | null {
  const raw = sourceFiles?.["agents.json"];
  if (!raw?.trim()) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new InvalidAgentsJsonError("agents.json is not valid JSON");
  }

  return createAgentsJsonSnapshot(payload, schemaVersion);
}

export function createAgentsJsonSnapshot(
  payload: unknown,
  schemaVersion: AgentsJsonApprovalSchemaVersion =
    AGENTS_JSON_APPROVAL_SCHEMA_VERSION,
): AgentsJsonSnapshot {
  const normalizedPayload = normalizeAgentsJsonPayloadForVersion(
    payload,
    schemaVersion,
  );
  validateAgentsJsonPayload(normalizedPayload);
  const canonicalJson = stableJsonStringify(normalizedPayload);
  return {
    hash: versionedAgentsJsonApprovalHash({ canonicalJson, schemaVersion }),
    payload: normalizedPayload,
    canonicalJson,
    schemaVersion,
  };
}

export function tryReadAgentsJsonSnapshot(
  sourceFiles: Record<string, string> | null | undefined,
): AgentsJsonSnapshot | null {
  try {
    return readAgentsJsonSnapshot(sourceFiles);
  } catch {
    return null;
  }
}

export function agentsJsonApprovalHashMatches(input: {
  approvalHash: string | null | undefined;
  sourceFiles: Record<string, string> | null | undefined;
}): boolean {
  if (!input.approvalHash) return false;

  try {
    const schemaVersion = resolveApprovalSchemaVersionForHash(input.approvalHash);
    const snapshot = readAgentsJsonSnapshot(input.sourceFiles, schemaVersion);
    return snapshot?.hash === input.approvalHash;
  } catch {
    return false;
  }
}

export function getDraftAgentsJsonApproval(input: {
  app: Pick<AppDocument, "agentsJsonApprovalHash">;
  sourceFiles: Record<string, string> | null | undefined;
}): {
  requiresApproval: boolean;
  approved: boolean;
  hash: string | null;
  invalid: boolean;
} {
  let snapshot: AgentsJsonSnapshot | null;
  try {
    snapshot = readAgentsJsonSnapshot(input.sourceFiles);
  } catch {
    return {
      requiresApproval: true,
      approved: false,
      hash: null,
      invalid: true,
    };
  }

  if (!snapshot) {
    return {
      requiresApproval: false,
      approved: true,
      hash: null,
      invalid: false,
    };
  }

  return {
    requiresApproval: true,
    approved: agentsJsonApprovalHashMatches({
      approvalHash: input.app.agentsJsonApprovalHash,
      sourceFiles: input.sourceFiles,
    }),
    hash: snapshot.hash,
    invalid: false,
  };
}

export function agentsPayloadAllowsDataCollection(
  payload: unknown,
  collection: string,
  agentId?: string,
): boolean {
  const requestedAgentId = agentId?.trim();
  if (!requestedAgentId) return false;
  if (!isRecord(payload) || !Array.isArray(payload.agents)) return false;

  for (const agent of payload.agents) {
    if (!isRecord(agent) || !Array.isArray(agent.dataCollections)) continue;
    if (agent.id !== requestedAgentId) continue;
    if (agent.dataCollections.includes(collection)) return true;
  }

  return false;
}
