import type { WorkspaceDocument } from "@/lib/db/types";
import {
  getWorkspaceMembershipsCollection,
  getWorkspaceTeamMembershipsCollection,
  getWorkspaceTeamsCollection,
} from "@/lib/db/collections";
import { createOwnerMembership } from "./workspace-memberships";
import { ensureDefaultWorkspaceTeam } from "./workspace-teams";
import { createWorkspace, deleteWorkspaceById } from "./workspaces";

export async function createWorkspaceWithOwner(input: {
  name: string;
  userId: string;
}): Promise<WorkspaceDocument> {
  const workspace = await createWorkspace({
    name: input.name,
    createdByUserId: input.userId,
  });

  try {
    const defaultTeam = await ensureDefaultWorkspaceTeam({
      workspaceId: workspace._id,
      createdByUserId: input.userId,
    });

    await createOwnerMembership({
      workspaceId: workspace._id,
      userId: input.userId,
    });

    return {
      ...workspace,
      defaultTeamId: defaultTeam._id,
      updatedAt: new Date(),
    };
  } catch (error) {
    await rollbackWorkspaceProvisioning(workspace._id);
    throw error;
  }
}

async function rollbackWorkspaceProvisioning(workspaceId: string): Promise<void> {
  const [
    workspaceMembershipsCollection,
    workspaceTeamsCollection,
    workspaceTeamMembershipsCollection,
  ] = await Promise.all([
    getWorkspaceMembershipsCollection(),
    getWorkspaceTeamsCollection(),
    getWorkspaceTeamMembershipsCollection(),
  ]);

  await Promise.all([
    workspaceMembershipsCollection.deleteMany({ workspaceId }),
    workspaceTeamMembershipsCollection.deleteMany({ workspaceId }),
    workspaceTeamsCollection.deleteMany({ workspaceId }),
    deleteWorkspaceById(workspaceId),
  ]);
}
