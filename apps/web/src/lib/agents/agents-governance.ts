import { createHash } from "node:crypto";
import type { AppDocument } from "@/lib/db/types";

export type AgentsJsonSnapshot = {
  hash: string;
  payload: unknown;
  canonicalJson: string;
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

function validateAgentsJsonPayload(value: unknown): void {
  if (!isRecord(value) || !Array.isArray(value.agents) || value.agents.length === 0) {
    throw new InvalidAgentsJsonError("agents.json must contain a non-empty agents array");
  }
}

export function readAgentsJsonSnapshot(
  sourceFiles: Record<string, string> | null | undefined,
): AgentsJsonSnapshot | null {
  const raw = sourceFiles?.["agents.json"];
  if (!raw?.trim()) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new InvalidAgentsJsonError("agents.json is not valid JSON");
  }

  return createAgentsJsonSnapshot(payload);
}

export function createAgentsJsonSnapshot(payload: unknown): AgentsJsonSnapshot {
  validateAgentsJsonPayload(payload);
  const canonicalJson = stableJsonStringify(payload);
  return {
    hash: createHash("sha256").update(canonicalJson).digest("hex"),
    payload,
    canonicalJson,
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
    approved: input.app.agentsJsonApprovalHash === snapshot.hash,
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
