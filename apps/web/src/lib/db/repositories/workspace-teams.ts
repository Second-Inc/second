import { ObjectId } from "mongodb";
import {
  getAppsCollection,
  getWorkspaceTeamMembershipsCollection,
  getWorkspaceTeamsCollection,
  getWorkspacesCollection,
} from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import type {
  WorkspaceTeamDocument,
  WorkspaceTeamMembershipDocument,
} from "@/lib/db/types";

export const DEFAULT_WORKSPACE_TEAM_NAME = "General";
export const DEFAULT_WORKSPACE_TEAM_SLUG = "general";

export type WorkspaceTeamMembershipSummary = Pick<
  WorkspaceTeamMembershipDocument,
  "teamId" | "userId"
>;

function normalizeTeamSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function findDefaultWorkspaceTeam(
  workspaceId: string,
): Promise<WorkspaceTeamDocument | null> {
  const workspaceTeamsCollection = await getWorkspaceTeamsCollection();

  return workspaceTeamsCollection.findOne({
    workspaceId,
    $or: [{ isDefault: true }, { slug: DEFAULT_WORKSPACE_TEAM_SLUG }],
  });
}

export async function ensureDefaultWorkspaceTeam(input: {
  workspaceId: string;
  createdByUserId?: string;
}): Promise<WorkspaceTeamDocument> {
  const existing = await findDefaultWorkspaceTeam(input.workspaceId);

  if (existing) {
    const workspacesCollection = await getWorkspacesCollection();
    await workspacesCollection.updateOne(
      {
        _id: input.workspaceId,
        $or: [
          { defaultTeamId: { $exists: false } },
          { defaultTeamId: null },
        ],
      },
      {
        $set: {
          defaultTeamId: existing._id,
          updatedAt: new Date(),
        },
      },
    );
    return existing;
  }

  const [workspaceTeamsCollection, workspacesCollection] = await Promise.all([
    getWorkspaceTeamsCollection(),
    getWorkspacesCollection(),
  ]);
  const workspace = await workspacesCollection.findOne({ _id: input.workspaceId });

  if (!workspace) {
    throw new Error("[db] Cannot create a default team for a missing workspace.");
  }

  const now = new Date();
  const team: WorkspaceTeamDocument = {
    _id: new ObjectId().toHexString(),
    workspaceId: input.workspaceId,
    name: DEFAULT_WORKSPACE_TEAM_NAME,
    slug: DEFAULT_WORKSPACE_TEAM_SLUG,
    isDefault: true,
    createdByUserId: input.createdByUserId ?? workspace.createdByUserId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await workspaceTeamsCollection.insertOne(team);
  } catch (error) {
    const racedTeam = await findDefaultWorkspaceTeam(input.workspaceId);
    if (racedTeam) return racedTeam;
    throw error;
  }

  await workspacesCollection.updateOne(
    { _id: input.workspaceId },
    {
      $set: {
        defaultTeamId: team._id,
        updatedAt: now,
      },
    },
  );

  return team;
}

export async function createWorkspaceTeam(input: {
  workspaceId: string;
  name: string;
  slug?: string;
  createdByUserId: string;
}): Promise<WorkspaceTeamDocument> {
  const workspaceTeamsCollection = await getWorkspaceTeamsCollection();
  const now = new Date();
  const name = input.name.trim();
  const slug = normalizeTeamSlug(input.slug ?? input.name);

  if (!name || !slug) {
    throw new Error("[db] Workspace team name and slug are required.");
  }

  const team: WorkspaceTeamDocument = {
    _id: new ObjectId().toHexString(),
    workspaceId: input.workspaceId,
    name,
    slug,
    isDefault: false,
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
  };

  await workspaceTeamsCollection.insertOne(team);
  publishWorkspaceEvent({
    type: "member.changed",
    workspaceId: input.workspaceId,
    scope: "team-memberships",
  });
  return team;
}

export async function listWorkspaceTeams(
  workspaceId: string,
): Promise<WorkspaceTeamDocument[]> {
  const workspaceTeamsCollection = await getWorkspaceTeamsCollection();

  return workspaceTeamsCollection
    .find({ workspaceId })
    .sort({ isDefault: -1, name: 1 })
    .toArray();
}

export async function findWorkspaceTeamById(input: {
  workspaceId: string;
  teamId: string;
}): Promise<WorkspaceTeamDocument | null> {
  const workspaceTeamsCollection = await getWorkspaceTeamsCollection();
  return workspaceTeamsCollection.findOne({
    _id: input.teamId,
    workspaceId: input.workspaceId,
  });
}

export async function updateWorkspaceTeamName(input: {
  workspaceId: string;
  teamId: string;
  name: string;
}): Promise<WorkspaceTeamDocument | null> {
  const workspaceTeamsCollection = await getWorkspaceTeamsCollection();
  const name = input.name.trim();
  if (!name) {
    throw new Error("[db] Workspace team name is required.");
  }

  const existing = await workspaceTeamsCollection.findOne({
    _id: input.teamId,
    workspaceId: input.workspaceId,
  });
  if (!existing || existing.name === name) {
    return existing;
  }

  const team = await workspaceTeamsCollection.findOneAndUpdate(
    { _id: input.teamId, workspaceId: input.workspaceId },
    {
      $set: {
        name,
        slug: normalizeTeamSlug(name),
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );

  if (team) {
    publishWorkspaceEvent({
      type: "member.changed",
      workspaceId: input.workspaceId,
      scope: "team-memberships",
    });
  }

  return team;
}

export async function deleteWorkspaceTeam(input: {
  workspaceId: string;
  teamId: string;
}): Promise<boolean> {
  const [
    workspaceTeamsCollection,
    teamMembershipsCollection,
    appsCollection,
  ] = await Promise.all([
    getWorkspaceTeamsCollection(),
    getWorkspaceTeamMembershipsCollection(),
    getAppsCollection(),
  ]);

  const team = await workspaceTeamsCollection.findOne({
    _id: input.teamId,
    workspaceId: input.workspaceId,
  });

  if (!team || team.isDefault) {
    return false;
  }

  await appsCollection.updateMany(
    { workspaceId: input.workspaceId, teamIds: input.teamId },
    {
      $pull: { teamIds: input.teamId },
      $set: { updatedAt: new Date() },
    },
  );
  await teamMembershipsCollection.deleteMany({
    workspaceId: input.workspaceId,
    teamId: input.teamId,
  });
  const result = await workspaceTeamsCollection.deleteOne({
    _id: input.teamId,
    workspaceId: input.workspaceId,
  });

  if (result.deletedCount > 0) {
    publishWorkspaceEvent({
      type: "member.changed",
      workspaceId: input.workspaceId,
      scope: "team-memberships",
    });
  }

  return result.deletedCount > 0;
}

export async function addUserToWorkspaceTeam(input: {
  workspaceId: string;
  teamId: string;
  userId: string;
}): Promise<WorkspaceTeamMembershipDocument> {
  const [workspaceTeamsCollection, teamMembershipsCollection] = await Promise.all([
    getWorkspaceTeamsCollection(),
    getWorkspaceTeamMembershipsCollection(),
  ]);

  const team = await workspaceTeamsCollection.findOne({
    _id: input.teamId,
    workspaceId: input.workspaceId,
  });

  if (!team) {
    throw new Error("[db] Cannot add a user to a missing workspace team.");
  }

  const now = new Date();
  const result = await teamMembershipsCollection.updateOne(
    {
      workspaceId: input.workspaceId,
      teamId: input.teamId,
      userId: input.userId,
    },
    {
      $setOnInsert: {
        _id: new ObjectId().toHexString(),
        workspaceId: input.workspaceId,
        teamId: input.teamId,
        userId: input.userId,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const membership = await teamMembershipsCollection.findOne({
    workspaceId: input.workspaceId,
    teamId: input.teamId,
    userId: input.userId,
  });

  if (!membership) {
    throw new Error("[db] Failed to add workspace team membership.");
  }

  if (result.upsertedCount > 0) {
    publishWorkspaceEvent({
      type: "member.changed",
      workspaceId: input.workspaceId,
      scope: "team-memberships",
    });
  }

  return membership;
}

export async function removeUserFromWorkspaceTeam(input: {
  workspaceId: string;
  teamId: string;
  userId: string;
}): Promise<boolean> {
  const [workspaceTeamsCollection, teamMembershipsCollection] =
    await Promise.all([
      getWorkspaceTeamsCollection(),
      getWorkspaceTeamMembershipsCollection(),
    ]);

  const team = await workspaceTeamsCollection.findOne({
    _id: input.teamId,
    workspaceId: input.workspaceId,
  });

  if (!team || team.isDefault) {
    return false;
  }

  const result = await teamMembershipsCollection.deleteOne({
    workspaceId: input.workspaceId,
    teamId: input.teamId,
    userId: input.userId,
  });

  if (result.deletedCount > 0) {
    publishWorkspaceEvent({
      type: "member.changed",
      workspaceId: input.workspaceId,
      scope: "team-memberships",
    });
  }

  return result.deletedCount > 0;
}

export async function addUserToDefaultWorkspaceTeam(input: {
  workspaceId: string;
  userId: string;
  createdByUserId?: string;
}): Promise<WorkspaceTeamMembershipDocument> {
  const defaultTeam = await ensureDefaultWorkspaceTeam({
    workspaceId: input.workspaceId,
    createdByUserId: input.createdByUserId ?? input.userId,
  });

  return addUserToWorkspaceTeam({
    workspaceId: input.workspaceId,
    teamId: defaultTeam._id,
    userId: input.userId,
  });
}

export async function listTeamMembershipsForUser(input: {
  workspaceId: string;
  userId: string;
}): Promise<WorkspaceTeamMembershipDocument[]> {
  const teamMembershipsCollection = await getWorkspaceTeamMembershipsCollection();

  return teamMembershipsCollection
    .find({ workspaceId: input.workspaceId, userId: input.userId })
    .sort({ createdAt: 1 })
    .toArray();
}

export async function listWorkspaceTeamMembershipsForWorkspace(
  workspaceId: string,
): Promise<WorkspaceTeamMembershipSummary[]> {
  const teamMembershipsCollection =
    await getWorkspaceTeamMembershipsCollection();

  const memberships = await teamMembershipsCollection
    .find(
      { workspaceId },
      {
        projection: {
          teamId: 1,
          userId: 1,
        },
      },
    )
    .toArray();

  return memberships.map((membership) => ({
    teamId: membership.teamId,
    userId: membership.userId,
  }));
}

export async function listTeamIdsForUser(input: {
  workspaceId: string;
  userId: string;
}): Promise<string[]> {
  const memberships = await listTeamMembershipsForUser(input);
  return memberships.map((membership) => membership.teamId);
}
