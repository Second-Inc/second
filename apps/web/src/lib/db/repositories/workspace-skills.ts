import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import {
  getWorkspaceAgentsCollection,
  getWorkspaceSkillRevisionsCollection,
  getWorkspaceSkillsCollection,
} from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import type {
  ResourceVisibility,
  RunSkillReference,
  WorkspaceRole,
  WorkspaceSkillDocument,
  WorkspaceSkillRevisionDocument,
  WorkspaceSkillStatus,
} from "@/lib/db/types";

export type WorkspaceResourceViewer = {
  userId: string;
  role: WorkspaceRole;
  teamIds: string[];
};

export type WorkspaceSkillDetail = WorkspaceSkillDocument & {
  bodyMarkdown: string;
};

export type RuntimeSkillReference = RunSkillReference & {
  bodyMarkdown: string;
};

export function normalizeWorkspaceResourceSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function workspaceResourceHash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function isWorkspaceAdminRole(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

function viewerCanAccessTeamScopedResource(input: {
  viewer: WorkspaceResourceViewer;
  createdByUserId: string;
  visibility: ResourceVisibility;
  teamIds: string[];
}): boolean {
  if (isWorkspaceAdminRole(input.viewer.role)) return true;
  if (input.createdByUserId === input.viewer.userId) return true;
  if (input.visibility === "workspace") return true;

  const viewerTeams = new Set(input.viewer.teamIds);
  return input.teamIds.some((teamId) => viewerTeams.has(teamId));
}

export function workspaceResourceVisibilityFilter(
  viewer: WorkspaceResourceViewer,
) {
  if (isWorkspaceAdminRole(viewer.role)) return {};

  return {
    $or: [
      { visibility: "workspace" as const },
      { createdByUserId: viewer.userId },
      { teamIds: { $in: viewer.teamIds } },
    ],
  };
}

function queryRegex(query: string) {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function skillProjection() {
  return {
    _id: 1,
    workspaceId: 1,
    slug: 1,
    displayName: 1,
    description: 1,
    icon: 1,
    tags: 1,
    visibility: 1,
    teamIds: 1,
    status: 1,
    createdByUserId: 1,
    createdByName: 1,
    currentRevisionId: 1,
    currentRevisionNumber: 1,
    currentRevisionHash: 1,
    createdAt: 1,
    updatedAt: 1,
  } as const;
}

export async function listWorkspaceSkillsForViewer(input: {
  workspaceId: string;
  viewer: WorkspaceResourceViewer;
  query?: string;
  status?: WorkspaceSkillStatus;
}): Promise<WorkspaceSkillDocument[]> {
  const collection = await getWorkspaceSkillsCollection();
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
          { tags: pattern },
        ],
      },
    ];
  }

  return collection
    .find(filter, { projection: skillProjection() })
    .sort({ updatedAt: -1, displayName: 1 })
    .toArray();
}

export async function findWorkspaceSkillDetailForViewer(input: {
  workspaceId: string;
  skillId: string;
  viewer: WorkspaceResourceViewer;
}): Promise<WorkspaceSkillDetail | null> {
  return findWorkspaceSkillDetailByFilterForViewer({
    workspaceId: input.workspaceId,
    filter: { _id: input.skillId },
    viewer: input.viewer,
  });
}

export async function findWorkspaceSkillDetailBySlugForViewer(input: {
  workspaceId: string;
  slug: string;
  viewer: WorkspaceResourceViewer;
}): Promise<WorkspaceSkillDetail | null> {
  return findWorkspaceSkillDetailByFilterForViewer({
    workspaceId: input.workspaceId,
    filter: { slug: normalizeWorkspaceResourceSlug(input.slug) },
    viewer: input.viewer,
  });
}

async function findWorkspaceSkillDetailByFilterForViewer(input: {
  workspaceId: string;
  filter: { _id: string } | { slug: string };
  viewer: WorkspaceResourceViewer;
}): Promise<WorkspaceSkillDetail | null> {
  const [skillsCollection, revisionsCollection] = await Promise.all([
    getWorkspaceSkillsCollection(),
    getWorkspaceSkillRevisionsCollection(),
  ]);

  const skill = await skillsCollection.findOne({
    ...input.filter,
    workspaceId: input.workspaceId,
    status: { $ne: "archived" },
  });
  if (!skill) return null;

  if (
    !viewerCanAccessTeamScopedResource({
      viewer: input.viewer,
      createdByUserId: skill.createdByUserId,
      visibility: skill.visibility,
      teamIds: skill.teamIds,
    })
  ) {
    return null;
  }

  const revision = await revisionsCollection.findOne({
    _id: skill.currentRevisionId,
    workspaceId: input.workspaceId,
    skillId: skill._id,
  });

  return {
    ...skill,
    bodyMarkdown: revision?.bodyMarkdown ?? "",
  };
}

export async function findWorkspaceSkillRevision(input: {
  workspaceId: string;
  skillId: string;
  revisionId: string;
}): Promise<WorkspaceSkillRevisionDocument | null> {
  const collection = await getWorkspaceSkillRevisionsCollection();
  return collection.findOne({
    _id: input.revisionId,
    workspaceId: input.workspaceId,
    skillId: input.skillId,
  });
}

async function uniqueSkillSlug(input: {
  workspaceId: string;
  requestedSlug: string;
  excludeSkillId?: string;
}): Promise<string> {
  const collection = await getWorkspaceSkillsCollection();
  const base = normalizeWorkspaceResourceSlug(input.requestedSlug) || "skill";
  let slug = base;
  let suffix = 2;

  while (true) {
    const existing = await collection.findOne(
      {
        workspaceId: input.workspaceId,
        slug,
        ...(input.excludeSkillId ? { _id: { $ne: input.excludeSkillId } } : {}),
      },
      { projection: { _id: 1 } },
    );
    if (!existing) return slug;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
}

export async function createWorkspaceSkill(input: {
  workspaceId: string;
  displayName: string;
  slug?: string;
  description: string;
  icon: string;
  bodyMarkdown: string;
  tags: string[];
  visibility: ResourceVisibility;
  teamIds: string[];
  createdByUserId: string;
  createdByName: string;
}): Promise<WorkspaceSkillDocument> {
  const [skillsCollection, revisionsCollection] = await Promise.all([
    getWorkspaceSkillsCollection(),
    getWorkspaceSkillRevisionsCollection(),
  ]);

  const now = new Date();
  const skillId = new ObjectId().toHexString();
  const revisionId = new ObjectId().toHexString();
  const body = input.bodyMarkdown.trim();
  const hash = workspaceResourceHash(body);
  const slug = await uniqueSkillSlug({
    workspaceId: input.workspaceId,
    requestedSlug: input.slug ?? input.displayName,
  });

  const revision: WorkspaceSkillRevisionDocument = {
    _id: revisionId,
    workspaceId: input.workspaceId,
    skillId,
    revisionNumber: 1,
    bodyMarkdown: body,
    hash,
    createdByUserId: input.createdByUserId,
    createdAt: now,
  };

  const skill: WorkspaceSkillDocument = {
    _id: skillId,
    workspaceId: input.workspaceId,
    slug,
    displayName: input.displayName.trim(),
    description: input.description.trim(),
    icon: input.icon.trim() || "book-open",
    tags: input.tags,
    visibility: input.visibility,
    teamIds: input.teamIds,
    status: "published",
    createdByUserId: input.createdByUserId,
    createdByName: input.createdByName,
    currentRevisionId: revisionId,
    currentRevisionNumber: 1,
    currentRevisionHash: hash,
    createdAt: now,
    updatedAt: now,
  };

  await revisionsCollection.insertOne(revision);
  await skillsCollection.insertOne(skill);
  publishWorkspaceEvent({
    type: "skill.created",
    workspaceId: input.workspaceId,
    scope: "library",
    skillId,
  });
  return skill;
}

export async function updateWorkspaceSkill(input: {
  workspaceId: string;
  skillId: string;
  displayName?: string;
  description?: string;
  icon?: string;
  bodyMarkdown?: string;
  tags?: string[];
  visibility?: ResourceVisibility;
  teamIds?: string[];
  status?: WorkspaceSkillStatus;
  updatedByUserId: string;
}): Promise<WorkspaceSkillDocument | null> {
  const [skillsCollection, revisionsCollection] = await Promise.all([
    getWorkspaceSkillsCollection(),
    getWorkspaceSkillRevisionsCollection(),
  ]);

  const existing = await skillsCollection.findOne({
    _id: input.skillId,
    workspaceId: input.workspaceId,
  });
  if (!existing) return null;

  const now = new Date();
  const $set: Partial<WorkspaceSkillDocument> = {
    updatedAt: now,
  };
  let revisionChanged = false;

  if (typeof input.displayName === "string") {
    $set.displayName = input.displayName.trim();
  }
  if (typeof input.description === "string") {
    $set.description = input.description.trim();
  }
  if (typeof input.icon === "string") {
    $set.icon = input.icon.trim() || "book-open";
  }
  if (Array.isArray(input.tags)) {
    $set.tags = input.tags;
  }
  if (Array.isArray(input.teamIds)) {
    $set.teamIds = input.teamIds;
  }
  if (input.visibility) {
    $set.visibility = input.visibility;
  }
  if (input.status) {
    $set.status = input.status;
  }

  if (typeof input.bodyMarkdown === "string") {
    const body = input.bodyMarkdown.trim();
    const hash = workspaceResourceHash(body);
    if (hash !== existing.currentRevisionHash) {
      const revision: WorkspaceSkillRevisionDocument = {
        _id: new ObjectId().toHexString(),
        workspaceId: input.workspaceId,
        skillId: input.skillId,
        revisionNumber: existing.currentRevisionNumber + 1,
        bodyMarkdown: body,
        hash,
        createdByUserId: input.updatedByUserId,
        createdAt: now,
      };
      await revisionsCollection.insertOne(revision);
      $set.currentRevisionId = revision._id;
      $set.currentRevisionNumber = revision.revisionNumber;
      $set.currentRevisionHash = revision.hash;
      revisionChanged = true;
    }
  }

  const updated = await skillsCollection.findOneAndUpdate(
    { _id: input.skillId, workspaceId: input.workspaceId },
    { $set },
    { returnDocument: "after" },
  );

  if (updated && revisionChanged) {
    const agentsCollection = await getWorkspaceAgentsCollection();
    await agentsCollection.updateMany(
      {
        workspaceId: input.workspaceId,
        selectedSkillIds: input.skillId,
        approvalStatus: "approved",
      },
      {
        $set: {
          approvalStatus: "stale",
          updatedAt: now,
        },
      },
    );
  }

  if (updated) {
    publishWorkspaceEvent({
      type: "skill.updated",
      workspaceId: input.workspaceId,
      scope: "library",
      skillId: input.skillId,
    });
    if (revisionChanged) {
      publishWorkspaceEvent({
        type: "agent.updated",
        workspaceId: input.workspaceId,
        scope: "workspace-agents",
      });
    }
  }

  return updated;
}

export async function deleteWorkspaceSkill(input: {
  workspaceId: string;
  skillId: string;
}): Promise<boolean> {
  const [skillsCollection, agentsCollection] = await Promise.all([
    getWorkspaceSkillsCollection(),
    getWorkspaceAgentsCollection(),
  ]);
  const now = new Date();
  const result = await skillsCollection.updateOne(
    {
      _id: input.skillId,
      workspaceId: input.workspaceId,
      status: { $ne: "archived" },
    },
    {
      $set: {
        status: "archived",
        updatedAt: now,
      },
    },
  );

  if (result.matchedCount === 0) return false;

  const approvedAgentUpdate = await agentsCollection.updateMany(
    {
      workspaceId: input.workspaceId,
      selectedSkillIds: input.skillId,
      status: { $ne: "archived" },
      approvalStatus: "approved",
    },
    {
      $pull: { selectedSkillIds: input.skillId },
      $set: {
        approvalStatus: "stale",
        updatedAt: now,
      },
    },
  );
  const otherAgentUpdate = await agentsCollection.updateMany(
    {
      workspaceId: input.workspaceId,
      selectedSkillIds: input.skillId,
      status: { $ne: "archived" },
      approvalStatus: { $ne: "approved" },
    },
    {
      $pull: { selectedSkillIds: input.skillId },
      $set: { updatedAt: now },
    },
  );

  publishWorkspaceEvent({
    type: "skill.deleted",
    workspaceId: input.workspaceId,
    scope: "library",
    skillId: input.skillId,
  });
  if (approvedAgentUpdate.modifiedCount + otherAgentUpdate.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "agent.updated",
      workspaceId: input.workspaceId,
      scope: "workspace-agents",
    });
  }
  return true;
}

export async function resolveRuntimeSkillsForViewer(input: {
  workspaceId: string;
  skillIds: string[];
  viewer: WorkspaceResourceViewer;
  requirePublished?: boolean;
}): Promise<RuntimeSkillReference[] | null> {
  const uniqueIds = [...new Set(input.skillIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const [skillsCollection, revisionsCollection] = await Promise.all([
    getWorkspaceSkillsCollection(),
    getWorkspaceSkillRevisionsCollection(),
  ]);
  const skills = await skillsCollection
    .find({
      _id: { $in: uniqueIds },
      workspaceId: input.workspaceId,
      ...(input.requirePublished === false ? {} : { status: "published" }),
    })
    .toArray();

  if (skills.length !== uniqueIds.length) return null;

  const byId = new Map(skills.map((skill) => [skill._id, skill]));
  const orderedSkills = uniqueIds.map((id) => byId.get(id));
  if (
    orderedSkills.some((skill) => {
      if (!skill) return true;
      return !viewerCanAccessTeamScopedResource({
        viewer: input.viewer,
        createdByUserId: skill.createdByUserId,
        visibility: skill.visibility,
        teamIds: skill.teamIds,
      });
    })
  ) {
    return null;
  }

  const revisions = await revisionsCollection
    .find({
      workspaceId: input.workspaceId,
      _id: { $in: skills.map((skill) => skill.currentRevisionId) },
    })
    .toArray();
  const revisionById = new Map(revisions.map((revision) => [revision._id, revision]));

  return orderedSkills.flatMap((skill): RuntimeSkillReference[] => {
    if (!skill) return [];
    const revision = revisionById.get(skill.currentRevisionId);
    if (!revision) return [];
    return [{
      skillId: skill._id,
      revisionId: revision._id,
      revisionNumber: revision.revisionNumber,
      revisionHash: revision.hash,
      slug: skill.slug,
      displayName: skill.displayName,
      description: skill.description,
      bodyMarkdown: revision.bodyMarkdown,
    }];
  });
}

export async function loadRuntimeSkillsByRefs(input: {
  workspaceId: string;
  refs: RunSkillReference[];
}): Promise<RuntimeSkillReference[]> {
  const revisionsCollection = await getWorkspaceSkillRevisionsCollection();
  const revisionIds = input.refs.map((ref) => ref.revisionId);
  const revisions = await revisionsCollection
    .find({
      workspaceId: input.workspaceId,
      _id: { $in: revisionIds },
    })
    .toArray();
  const revisionById = new Map(revisions.map((revision) => [revision._id, revision]));

  return input.refs.flatMap((ref): RuntimeSkillReference[] => {
    const revision = revisionById.get(ref.revisionId);
    if (!revision || revision.skillId !== ref.skillId) return [];
    return [{
      ...ref,
      bodyMarkdown: revision.bodyMarkdown,
    }];
  });
}
