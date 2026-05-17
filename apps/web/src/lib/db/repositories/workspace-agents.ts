import { ObjectId } from "mongodb";
import { getWorkspaceAgentsCollection } from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import type {
  ResourceVisibility,
  RunSkillReference,
  WorkspaceAgentApprovalStatus,
  WorkspaceAgentDocument,
  WorkspaceAgentRunSnapshot,
  WorkspaceAgentStatus,
} from "@/lib/db/types";
import {
  isWorkspaceAdminRole,
  normalizeWorkspaceResourceSlug,
  type WorkspaceResourceViewer,
  workspaceResourceVisibilityFilter,
} from "./workspace-skills";

export type WorkspaceToolProjection = {
  _id: string;
  workspaceId: string;
  slug: string;
  displayName: string;
  description: string;
  integrationName: string;
  integrationDomain: string;
  actionName: string;
  method: string;
  status: "active" | "draft";
};

function viewerCanAccessAgent(input: {
  viewer: WorkspaceResourceViewer;
  agent: Pick<
    WorkspaceAgentDocument,
    "createdByUserId" | "visibility" | "teamIds"
  >;
}): boolean {
  if (isWorkspaceAdminRole(input.viewer.role)) return true;
  if (input.agent.createdByUserId === input.viewer.userId) return true;
  if (input.agent.visibility === "workspace") return true;

  const viewerTeams = new Set(input.viewer.teamIds);
  return input.agent.teamIds.some((teamId) => viewerTeams.has(teamId));
}

function queryRegex(query: string) {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function agentProjection() {
  return {
    _id: 1,
    workspaceId: 1,
    slug: 1,
    avatarGradientSeed: 1,
    displayName: 1,
    description: 1,
    systemPrompt: 1,
    visibility: 1,
    teamIds: 1,
    status: 1,
    approvalStatus: 1,
    selectedSkillIds: 1,
    selectedToolIds: 1,
    builtinTools: 1,
    model: 1,
    createdByUserId: 1,
    createdByName: 1,
    createdAt: 1,
    updatedAt: 1,
  } as const;
}

async function uniqueAgentSlug(input: {
  workspaceId: string;
  requestedSlug: string;
  excludeAgentId?: string;
}): Promise<string> {
  const collection = await getWorkspaceAgentsCollection();
  const base = normalizeWorkspaceResourceSlug(input.requestedSlug) || "agent";
  let slug = base;
  let suffix = 2;

  while (true) {
    const existing = await collection.findOne(
      {
        workspaceId: input.workspaceId,
        slug,
        ...(input.excludeAgentId ? { _id: { $ne: input.excludeAgentId } } : {}),
      },
      { projection: { _id: 1 } },
    );
    if (!existing) return slug;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
}

function normalizeBuiltinTools(value: string[]): string[] {
  const allowed = new Set(["WebSearch", "WebFetch"]);
  return [...new Set(value.filter((tool) => allowed.has(tool)))];
}

function normalizeSelectedToolIds(value: string[]): string[] {
  // Workspace custom tools are intentionally out of scope for this pass.
  // Keep the shape ready, but do not persist browser-provided tool IDs yet.
  return value.length > 0 ? [] : [];
}

export async function listWorkspaceAgentsForViewer(input: {
  workspaceId: string;
  viewer: WorkspaceResourceViewer;
  query?: string;
  status?: WorkspaceAgentStatus;
}): Promise<WorkspaceAgentDocument[]> {
  const collection = await getWorkspaceAgentsCollection();
  const filter: Record<string, unknown> = {
    workspaceId: input.workspaceId,
    status: input.status ?? { $ne: "archived" },
    ...workspaceResourceVisibilityFilter(input.viewer),
  };

  if (input.query?.trim()) {
    const pattern = queryRegex(input.query.trim());
    filter.$and = [
      {
        $or: [
          { displayName: pattern },
          { description: pattern },
          { slug: pattern },
        ],
      },
    ];
  }

  return collection
    .find(filter, { projection: agentProjection() })
    .sort({ updatedAt: -1, displayName: 1 })
    .toArray();
}

export async function listAvailableWorkspaceAgentsForViewer(input: {
  workspaceId: string;
  viewer: WorkspaceResourceViewer;
}): Promise<WorkspaceAgentDocument[]> {
  const collection = await getWorkspaceAgentsCollection();
  return collection
    .find(
      {
        workspaceId: input.workspaceId,
        status: "published",
        approvalStatus: "approved",
        ...workspaceResourceVisibilityFilter(input.viewer),
      },
      { projection: agentProjection() },
    )
    .sort({ displayName: 1 })
    .toArray();
}

export async function findWorkspaceAgentForViewer(input: {
  workspaceId: string;
  agentId: string;
  viewer: WorkspaceResourceViewer;
}): Promise<WorkspaceAgentDocument | null> {
  const collection = await getWorkspaceAgentsCollection();
  const agent = await collection.findOne(
    {
      _id: input.agentId,
      workspaceId: input.workspaceId,
      status: { $ne: "archived" },
    },
    { projection: agentProjection() },
  );
  if (!agent) return null;
  return viewerCanAccessAgent({ viewer: input.viewer, agent }) ? agent : null;
}

export async function findWorkspaceAgentBySlugForViewer(input: {
  workspaceId: string;
  slug: string;
  viewer: WorkspaceResourceViewer;
}): Promise<WorkspaceAgentDocument | null> {
  const collection = await getWorkspaceAgentsCollection();
  const agent = await collection.findOne(
    {
      slug: normalizeWorkspaceResourceSlug(input.slug),
      workspaceId: input.workspaceId,
      status: { $ne: "archived" },
    },
    { projection: agentProjection() },
  );
  if (!agent) return null;
  return viewerCanAccessAgent({ viewer: input.viewer, agent }) ? agent : null;
}

export async function findRunnableWorkspaceAgentForViewer(input: {
  workspaceId: string;
  agentId: string;
  viewer: WorkspaceResourceViewer;
}): Promise<WorkspaceAgentDocument | null> {
  const agent = await findWorkspaceAgentForViewer(input);
  if (!agent) return null;
  if (agent.status !== "published") return null;
  if (agent.approvalStatus !== "approved") return null;
  return agent;
}

export async function findRunnableWorkspaceAgentBySlugForViewer(input: {
  workspaceId: string;
  slug: string;
  viewer: WorkspaceResourceViewer;
}): Promise<WorkspaceAgentDocument | null> {
  const agent = await findWorkspaceAgentBySlugForViewer(input);
  if (!agent) return null;
  if (agent.status !== "published") return null;
  if (agent.approvalStatus !== "approved") return null;
  return agent;
}

export async function createWorkspaceAgent(input: {
  workspaceId: string;
  displayName: string;
  slug?: string;
  avatarGradientSeed?: string | null;
  description: string;
  systemPrompt: string;
  visibility: ResourceVisibility;
  teamIds: string[];
  selectedSkillIds: string[];
  selectedToolIds: string[];
  builtinTools: string[];
  model: string;
  createdByUserId: string;
  createdByName: string;
}): Promise<WorkspaceAgentDocument> {
  const collection = await getWorkspaceAgentsCollection();
  const now = new Date();
  const selectedToolIds = normalizeSelectedToolIds(input.selectedToolIds);
  const agentId = new ObjectId().toHexString();
  const agent: WorkspaceAgentDocument = {
    _id: agentId,
    workspaceId: input.workspaceId,
    slug: await uniqueAgentSlug({
      workspaceId: input.workspaceId,
      requestedSlug: input.slug ?? input.displayName,
    }),
    avatarGradientSeed: input.avatarGradientSeed?.trim() || agentId,
    displayName: input.displayName.trim(),
    description: input.description.trim(),
    systemPrompt: input.systemPrompt.trim(),
    visibility: input.visibility,
    teamIds: input.teamIds,
    status: "published",
    approvalStatus: selectedToolIds.length > 0 ? "none" : "approved",
    selectedSkillIds: input.selectedSkillIds,
    selectedToolIds,
    builtinTools: normalizeBuiltinTools(input.builtinTools),
    model: input.model,
    createdByUserId: input.createdByUserId,
    createdByName: input.createdByName,
    createdAt: now,
    updatedAt: now,
  };

  await collection.insertOne(agent);
  publishWorkspaceEvent({
    type: "agent.created",
    workspaceId: input.workspaceId,
    scope: "workspace-agents",
    agentId: agent._id,
  });
  return agent;
}

function shouldStaleApproval(input: {
  existing: WorkspaceAgentDocument;
  selectedSkillIds?: string[];
  selectedToolIds?: string[];
  systemPrompt?: string;
}): boolean {
  if (typeof input.systemPrompt === "string" && input.systemPrompt.trim() !== input.existing.systemPrompt) {
    return true;
  }

  if (
    input.selectedSkillIds &&
    input.selectedSkillIds.join("\0") !== input.existing.selectedSkillIds.join("\0")
  ) {
    return true;
  }

  if (
    input.selectedToolIds &&
    input.selectedToolIds.join("\0") !== input.existing.selectedToolIds.join("\0")
  ) {
    return true;
  }

  return false;
}

export async function updateWorkspaceAgent(input: {
  workspaceId: string;
  agentId: string;
  avatarGradientSeed?: string | null;
  displayName?: string;
  description?: string;
  systemPrompt?: string;
  visibility?: ResourceVisibility;
  teamIds?: string[];
  selectedSkillIds?: string[];
  selectedToolIds?: string[];
  builtinTools?: string[];
  status?: WorkspaceAgentStatus;
  approvalStatus?: WorkspaceAgentApprovalStatus;
}): Promise<WorkspaceAgentDocument | null> {
  const collection = await getWorkspaceAgentsCollection();
  const existing = await collection.findOne({
    _id: input.agentId,
    workspaceId: input.workspaceId,
  });
  if (!existing) return null;

  const selectedToolIds = input.selectedToolIds
    ? normalizeSelectedToolIds(input.selectedToolIds)
    : undefined;
  const now = new Date();
  const $set: Partial<WorkspaceAgentDocument> = {
    updatedAt: now,
  };

  if (typeof input.displayName === "string") {
    $set.displayName = input.displayName.trim();
  }
  if (typeof input.avatarGradientSeed === "string") {
    $set.avatarGradientSeed = input.avatarGradientSeed.trim();
  }
  if (typeof input.description === "string") {
    $set.description = input.description.trim();
  }
  if (typeof input.systemPrompt === "string") {
    $set.systemPrompt = input.systemPrompt.trim();
  }
  if (input.visibility) {
    $set.visibility = input.visibility;
  }
  if (Array.isArray(input.teamIds)) {
    $set.teamIds = input.teamIds;
  }
  if (Array.isArray(input.selectedSkillIds)) {
    $set.selectedSkillIds = input.selectedSkillIds;
  }
  if (selectedToolIds) {
    $set.selectedToolIds = selectedToolIds;
  }
  if (Array.isArray(input.builtinTools)) {
    $set.builtinTools = normalizeBuiltinTools(input.builtinTools);
  }
  if (input.status) {
    $set.status = input.status;
  }
  if (input.approvalStatus) {
    $set.approvalStatus = input.approvalStatus;
  } else if (
    existing.approvalStatus === "approved" &&
    shouldStaleApproval({
      existing,
      selectedSkillIds: input.selectedSkillIds,
      selectedToolIds,
      systemPrompt: input.systemPrompt,
    })
  ) {
    $set.approvalStatus = "stale";
  }

  const updated = await collection.findOneAndUpdate(
    { _id: input.agentId, workspaceId: input.workspaceId },
    { $set },
    { returnDocument: "after" },
  );

  if (updated) {
    publishWorkspaceEvent({
      type: "agent.updated",
      workspaceId: input.workspaceId,
      scope: "workspace-agents",
      agentId: input.agentId,
    });
  }

  return updated;
}

export async function deleteWorkspaceAgent(input: {
  workspaceId: string;
  agentId: string;
}): Promise<boolean> {
  const collection = await getWorkspaceAgentsCollection();
  const result = await collection.updateOne(
    {
      _id: input.agentId,
      workspaceId: input.workspaceId,
      status: { $ne: "archived" },
    },
    {
      $set: {
        status: "archived",
        updatedAt: new Date(),
      },
    },
  );

  if (result.matchedCount === 0) return false;

  publishWorkspaceEvent({
    type: "agent.deleted",
    workspaceId: input.workspaceId,
    scope: "workspace-agents",
    agentId: input.agentId,
  });
  return true;
}

export function createWorkspaceAgentRunSnapshot(input: {
  agent: WorkspaceAgentDocument;
  selectedSkillRefs: RunSkillReference[];
}): WorkspaceAgentRunSnapshot {
  return {
    agentId: input.agent._id,
    slug: input.agent.slug,
    displayName: input.agent.displayName,
    description: input.agent.description,
    systemPrompt: input.agent.systemPrompt,
    visibility: input.agent.visibility,
    teamIds: input.agent.teamIds,
    approvalStatus: input.agent.approvalStatus,
    selectedSkillRefs: input.selectedSkillRefs,
    selectedToolIds: input.agent.selectedToolIds,
    builtinTools: input.agent.builtinTools,
    model: input.agent.model,
    capturedAt: new Date(),
  };
}

export async function listWorkspaceTools(): Promise<WorkspaceToolProjection[]> {
  return [];
}
