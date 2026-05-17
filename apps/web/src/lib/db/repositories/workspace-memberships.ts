import { ObjectId } from "mongodb";
import {
  getUsersCollection,
  getWorkspaceMembershipsCollection,
  getWorkspaceTeamMembershipsCollection,
} from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import type {
  UserDocument,
  WorkspaceMembershipDocument,
  WorkspaceRole,
} from "@/lib/db/types";
import { addUserToDefaultWorkspaceTeam } from "./workspace-teams";

export type WorkspaceMemberWithUser = {
  membership: WorkspaceMembershipDocument;
  user: UserDocument | null;
  teamIds: string[];
};

export type WorkspaceMemberProfile = {
  membership: Pick<
    WorkspaceMembershipDocument,
    "_id" | "workspaceId" | "userId" | "role" | "createdAt" | "updatedAt"
  >;
  user: Pick<UserDocument, "_id" | "displayName" | "email"> | null;
};

type RepositoryTimer = <T>(event: string, fn: () => Promise<T>) => Promise<T>;

function timeRepositoryStep<T>(
  timer: RepositoryTimer | undefined,
  event: string,
  fn: () => Promise<T>,
): Promise<T> {
  return timer ? timer(event, fn) : fn();
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return value === "owner" || value === "admin" || value === "member";
}

export async function createOwnerMembership(input: {
  workspaceId: string;
  userId: string;
}): Promise<WorkspaceMembershipDocument> {
  return upsertWorkspaceMembership({
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: "owner",
    createdByUserId: input.userId,
  });
}

export async function createWorkspaceMembership(input: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdByUserId?: string;
  invitedByUserId?: string | null;
  externalOrganizationMembershipId?: string | null;
  externalOrganizationId?: string | null;
  externalProvider?: "workos" | string | null;
}): Promise<WorkspaceMembershipDocument> {
  const workspaceMembershipsCollection = await getWorkspaceMembershipsCollection();
  const now = new Date();
  const membership: WorkspaceMembershipDocument = {
    _id: new ObjectId().toHexString(),
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: input.role,
    invitedByUserId: input.invitedByUserId ?? null,
    externalOrganizationMembershipId:
      input.externalOrganizationMembershipId ?? null,
    externalOrganizationId: input.externalOrganizationId ?? null,
    externalProvider: input.externalProvider ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await workspaceMembershipsCollection.insertOne(membership);
  await addUserToDefaultWorkspaceTeam({
    workspaceId: input.workspaceId,
    userId: input.userId,
    createdByUserId: input.createdByUserId ?? input.invitedByUserId ?? input.userId,
  });

  publishWorkspaceEvent({
    type: "member.changed",
    workspaceId: input.workspaceId,
    scope: "memberships",
  });

  return membership;
}

export async function upsertWorkspaceMembership(input: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdByUserId?: string;
  invitedByUserId?: string | null;
  externalOrganizationMembershipId?: string | null;
  externalOrganizationId?: string | null;
  externalProvider?: "workos" | string | null;
}): Promise<WorkspaceMembershipDocument> {
  const workspaceMembershipsCollection = await getWorkspaceMembershipsCollection();
  const existing = await workspaceMembershipsCollection.findOne({
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  const now = new Date();
  const $set: Partial<WorkspaceMembershipDocument> = {
    role: input.role,
    updatedAt: now,
  };

  if (input.invitedByUserId !== undefined) {
    $set.invitedByUserId = input.invitedByUserId;
  }
  if (input.externalOrganizationMembershipId !== undefined) {
    $set.externalOrganizationMembershipId =
      input.externalOrganizationMembershipId;
  }
  if (input.externalOrganizationId !== undefined) {
    $set.externalOrganizationId = input.externalOrganizationId;
  }
  if (input.externalProvider !== undefined) {
    $set.externalProvider = input.externalProvider;
  }

  const membershipChanged = !existing ||
    existing.role !== input.role ||
    (
      input.invitedByUserId !== undefined &&
      existing.invitedByUserId !== input.invitedByUserId
    ) ||
    (
      input.externalOrganizationMembershipId !== undefined &&
      existing.externalOrganizationMembershipId !==
        input.externalOrganizationMembershipId
    ) ||
    (
      input.externalOrganizationId !== undefined &&
      existing.externalOrganizationId !== input.externalOrganizationId
    ) ||
    (
      input.externalProvider !== undefined &&
      existing.externalProvider !== input.externalProvider
    );

  if (membershipChanged) {
    await workspaceMembershipsCollection.updateOne(
      { workspaceId: input.workspaceId, userId: input.userId },
      {
        $set,
        $setOnInsert: {
          _id: new ObjectId().toHexString(),
          workspaceId: input.workspaceId,
          userId: input.userId,
          createdAt: now,
        },
      },
      { upsert: true },
    );
  }

  const membership = await workspaceMembershipsCollection.findOne({
    workspaceId: input.workspaceId,
    userId: input.userId,
  });

  if (!membership) {
    throw new Error("[db] Failed to upsert workspace membership.");
  }

  await addUserToDefaultWorkspaceTeam({
    workspaceId: input.workspaceId,
    userId: input.userId,
    createdByUserId: input.createdByUserId ?? input.invitedByUserId ?? input.userId,
  });

  if (membershipChanged) {
    publishWorkspaceEvent({
      type: "member.changed",
      workspaceId: input.workspaceId,
      scope: "memberships",
    });
  }

  return membership;
}

export async function findMembership(input: {
  workspaceId: string;
  userId: string;
}): Promise<WorkspaceMembershipDocument | null> {
  const workspaceMembershipsCollection = await getWorkspaceMembershipsCollection();

  return workspaceMembershipsCollection.findOne({
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
}

export async function listMembershipsForUser(
  userId: string,
): Promise<WorkspaceMembershipDocument[]> {
  const workspaceMembershipsCollection = await getWorkspaceMembershipsCollection();

  return workspaceMembershipsCollection
    .find({ userId })
    .sort({ createdAt: 1 })
    .toArray();
}

export async function listMembershipsForWorkspace(
  workspaceId: string,
): Promise<WorkspaceMembershipDocument[]> {
  const workspaceMembershipsCollection = await getWorkspaceMembershipsCollection();

  return workspaceMembershipsCollection
    .find({ workspaceId })
    .sort({ createdAt: 1 })
    .toArray();
}

export async function listWorkspaceMembersWithUsers(
  workspaceId: string,
  options: { time?: RepositoryTimer } = {},
): Promise<WorkspaceMemberWithUser[]> {
  const [
    workspaceMembershipsCollection,
    usersCollection,
    teamMembershipsCollection,
  ] = await Promise.all([
    getWorkspaceMembershipsCollection(),
    getUsersCollection(),
    getWorkspaceTeamMembershipsCollection(),
  ]);

  const memberships = await timeRepositoryStep(
    options.time,
    "settings.members.db.memberships.find",
    () =>
      workspaceMembershipsCollection
        .find({ workspaceId })
        .sort({ createdAt: 1 })
        .toArray(),
  );

  if (memberships.length === 0) return [];

  const userIds = memberships.map((membership) => membership.userId);
  const [users, teamMemberships] = await Promise.all([
    timeRepositoryStep(options.time, "settings.members.db.users.find", () =>
      usersCollection.find({ _id: { $in: userIds } }).toArray(),
    ),
    timeRepositoryStep(
      options.time,
      "settings.members.db.team_memberships.find",
      () =>
        teamMembershipsCollection
          .find({ workspaceId, userId: { $in: userIds } })
          .toArray(),
    ),
  ]);

  const usersById = new Map(users.map((user) => [user._id, user]));
  const teamIdsByUserId = new Map<string, string[]>();
  for (const teamMembership of teamMemberships) {
    const teamIds = teamIdsByUserId.get(teamMembership.userId) ?? [];
    teamIds.push(teamMembership.teamId);
    teamIdsByUserId.set(teamMembership.userId, teamIds);
  }

  return memberships.map((membership) => ({
    membership,
    user: usersById.get(membership.userId) ?? null,
    teamIds: teamIdsByUserId.get(membership.userId) ?? [],
  }));
}

export async function listWorkspaceMemberProfiles(
  workspaceId: string,
  options: { time?: RepositoryTimer } = {},
): Promise<WorkspaceMemberProfile[]> {
  const [workspaceMembershipsCollection, usersCollection] = await Promise.all([
    getWorkspaceMembershipsCollection(),
    getUsersCollection(),
  ]);

  const memberships = await timeRepositoryStep(
    options.time,
    "settings.teams.db.member_profiles.memberships.find",
    () =>
      workspaceMembershipsCollection
        .find(
          { workspaceId },
          {
            projection: {
              _id: 1,
              workspaceId: 1,
              userId: 1,
              role: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          },
        )
        .sort({ createdAt: 1 })
        .toArray(),
  );

  if (memberships.length === 0) return [];

  const userIds = memberships.map((membership) => membership.userId);
  const users = await timeRepositoryStep(
    options.time,
    "settings.teams.db.member_profiles.users.find",
    () =>
      usersCollection
        .find(
          { _id: { $in: userIds } },
          {
            projection: {
              _id: 1,
              displayName: 1,
              email: 1,
            },
          },
        )
        .toArray(),
  );
  const usersById = new Map(users.map((user) => [user._id, user]));

  return memberships.map((membership) => ({
    membership,
    user: usersById.get(membership.userId) ?? null,
  }));
}

export async function updateWorkspaceMemberRole(input: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}): Promise<WorkspaceMembershipDocument | null> {
  const workspaceMembershipsCollection = await getWorkspaceMembershipsCollection();
  const existing = await workspaceMembershipsCollection.findOne({
    workspaceId: input.workspaceId,
    userId: input.userId,
  });

  if (!existing || existing.role === input.role) {
    return existing;
  }

  const result = await workspaceMembershipsCollection.findOneAndUpdate(
    { workspaceId: input.workspaceId, userId: input.userId },
    {
      $set: {
        role: input.role,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );

  if (result) {
    publishWorkspaceEvent({
      type: "member.changed",
      workspaceId: input.workspaceId,
      scope: "memberships",
    });
  }

  return result;
}

export async function removeWorkspaceMember(input: {
  workspaceId: string;
  userId: string;
}): Promise<boolean> {
  const [
    workspaceMembershipsCollection,
    teamMembershipsCollection,
  ] = await Promise.all([
    getWorkspaceMembershipsCollection(),
    getWorkspaceTeamMembershipsCollection(),
  ]);

  const result = await workspaceMembershipsCollection.deleteOne({
    workspaceId: input.workspaceId,
    userId: input.userId,
  });

  if (result.deletedCount > 0) {
    await teamMembershipsCollection.deleteMany({
      workspaceId: input.workspaceId,
      userId: input.userId,
    });
    publishWorkspaceEvent({
      type: "member.changed",
      workspaceId: input.workspaceId,
      scope: "memberships",
    });
    publishWorkspaceEvent({
      type: "member.changed",
      workspaceId: input.workspaceId,
      scope: "team-memberships",
    });
  }

  return result.deletedCount > 0;
}

export async function countWorkspaceOwners(
  workspaceId: string,
): Promise<number> {
  const workspaceMembershipsCollection = await getWorkspaceMembershipsCollection();

  return workspaceMembershipsCollection.countDocuments({
    workspaceId,
    role: "owner",
  });
}

export async function ensureWorkspaceHasAnotherOwner(input: {
  workspaceId: string;
  excludedUserId: string;
}): Promise<boolean> {
  const workspaceMembershipsCollection = await getWorkspaceMembershipsCollection();
  const owner = await workspaceMembershipsCollection.findOne(
    {
      workspaceId: input.workspaceId,
      userId: { $ne: input.excludedUserId },
      role: "owner",
    },
    { projection: { _id: 1 } },
  );

  return Boolean(owner);
}
