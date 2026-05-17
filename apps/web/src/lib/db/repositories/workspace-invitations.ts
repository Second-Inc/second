import { ObjectId } from "mongodb";
import { getWorkspaceInvitationsCollection } from "@/lib/db/collections";
import type {
  WorkspaceInvitationDocument,
  WorkspaceInvitationProvider,
  WorkspaceInvitationStatus,
  WorkspaceRole,
} from "@/lib/db/types";

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createWorkspaceInvitation(input: {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  teamIds: string[];
  provider: WorkspaceInvitationProvider;
  externalInvitationId?: string | null;
  externalOrganizationId?: string | null;
  invitedByUserId: string;
  invitedByUserName: string;
  expiresAt?: Date | null;
}): Promise<WorkspaceInvitationDocument> {
  const workspaceInvitationsCollection = await getWorkspaceInvitationsCollection();
  const now = new Date();
  const invitation: WorkspaceInvitationDocument = {
    _id: new ObjectId().toHexString(),
    workspaceId: input.workspaceId,
    email: input.email.trim(),
    emailNormalized: normalizeInvitationEmail(input.email),
    role: input.role,
    teamIds: input.teamIds,
    status: "pending",
    provider: input.provider,
    externalInvitationId: input.externalInvitationId ?? null,
    externalOrganizationId: input.externalOrganizationId ?? null,
    invitedByUserId: input.invitedByUserId,
    invitedByUserName: input.invitedByUserName,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt ?? null,
  };

  await workspaceInvitationsCollection.insertOne(invitation);
  return invitation;
}

export async function listWorkspaceInvitations(
  workspaceId: string,
): Promise<WorkspaceInvitationDocument[]> {
  const workspaceInvitationsCollection = await getWorkspaceInvitationsCollection();

  return workspaceInvitationsCollection
    .find({ workspaceId })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
}

export async function findPendingInvitationByEmail(input: {
  workspaceId: string;
  email: string;
}): Promise<WorkspaceInvitationDocument | null> {
  const workspaceInvitationsCollection = await getWorkspaceInvitationsCollection();

  return workspaceInvitationsCollection.findOne({
    workspaceId: input.workspaceId,
    emailNormalized: normalizeInvitationEmail(input.email),
    status: "pending",
  });
}

export async function findInvitationByIdForWorkspace(input: {
  workspaceId: string;
  invitationId: string;
}): Promise<WorkspaceInvitationDocument | null> {
  const workspaceInvitationsCollection = await getWorkspaceInvitationsCollection();

  return workspaceInvitationsCollection.findOne({
    _id: input.invitationId,
    workspaceId: input.workspaceId,
  });
}

export async function markInvitationAccepted(input: {
  workspaceId: string;
  invitationId: string;
}): Promise<void> {
  await markInvitationStatus({
    workspaceId: input.workspaceId,
    invitationId: input.invitationId,
    status: "accepted",
    timestampField: "acceptedAt",
  });
}

export async function markInvitationRevoked(input: {
  workspaceId: string;
  invitationId: string;
}): Promise<void> {
  await markInvitationStatus({
    workspaceId: input.workspaceId,
    invitationId: input.invitationId,
    status: "revoked",
    timestampField: "revokedAt",
  });
}

export async function markInvitationExpired(input: {
  workspaceId: string;
  invitationId: string;
}): Promise<void> {
  await markInvitationStatus({
    workspaceId: input.workspaceId,
    invitationId: input.invitationId,
    status: "expired",
  });
}

export async function touchWorkspaceInvitation(input: {
  workspaceId: string;
  invitationId: string;
}): Promise<void> {
  const workspaceInvitationsCollection = await getWorkspaceInvitationsCollection();

  await workspaceInvitationsCollection.updateOne(
    {
      _id: input.invitationId,
      workspaceId: input.workspaceId,
    },
    {
      $set: {
        updatedAt: new Date(),
      },
    },
  );
}

export async function syncInvitationFromExternal(input: {
  workspaceId: string;
  externalInvitationId: string;
  status?: WorkspaceInvitationStatus;
  expiresAt?: Date | null;
}): Promise<WorkspaceInvitationDocument | null> {
  const workspaceInvitationsCollection = await getWorkspaceInvitationsCollection();
  const $set: Partial<WorkspaceInvitationDocument> = {
    updatedAt: new Date(),
  };

  if (input.status) $set.status = input.status;
  if (input.expiresAt !== undefined) $set.expiresAt = input.expiresAt;

  return workspaceInvitationsCollection.findOneAndUpdate(
    {
      workspaceId: input.workspaceId,
      externalInvitationId: input.externalInvitationId,
    },
    { $set },
    { returnDocument: "after" },
  );
}

async function markInvitationStatus(input: {
  workspaceId: string;
  invitationId: string;
  status: WorkspaceInvitationStatus;
  timestampField?: "acceptedAt" | "revokedAt";
}): Promise<void> {
  const workspaceInvitationsCollection = await getWorkspaceInvitationsCollection();
  const now = new Date();
  const $set: Partial<WorkspaceInvitationDocument> = {
    status: input.status,
    updatedAt: now,
  };

  if (input.timestampField) {
    $set[input.timestampField] = now;
  }

  await workspaceInvitationsCollection.updateOne(
    {
      _id: input.invitationId,
      workspaceId: input.workspaceId,
    },
    { $set },
  );
}
