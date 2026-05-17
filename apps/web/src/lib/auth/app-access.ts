import type { WorkspaceContext } from "@/lib/auth/guard";
import {
  appHasPublishedVersion,
  findAppAccessMetadata,
  listAppMetadataForWorkspace,
  listAppSidebarMetadataForWorkspace,
  listTeamIdsForUser,
} from "@/lib/db";
import type { AppMetadata } from "@/lib/db";

export type AppAccess = {
  app: AppMetadata;
  isAdmin: boolean;
  isCreator: boolean;
  isCollaborator: boolean;
  canManage: boolean;
  canCollaborate: boolean;
  canManageCollaborators: boolean;
  canReview: boolean;
};

export function isWorkspaceAdminRole(role: WorkspaceContext["membership"]["role"]): boolean {
  return role === "owner" || role === "admin";
}

export function appIsVisibleToViewer(input: {
  app: AppMetadata;
  userId: string;
  role: WorkspaceContext["membership"]["role"];
  teamIds: string[];
}): boolean {
  const isAdmin = isWorkspaceAdminRole(input.role);
  const isCreator = input.app.createdByUserId === input.userId;
  const isCollaborator = (input.app.collaboratorUserIds ?? []).includes(input.userId);

  if (isAdmin || isCreator || isCollaborator) return true;

  if (!appHasPublishedVersion(input.app)) {
    return false;
  }

  if ((input.app.visibility ?? "workspace") === "workspace") {
    return true;
  }

  const appTeamIds = input.app.teamIds ?? [];
  if (appTeamIds.length === 0) {
    return false;
  }

  const viewerTeamIds = new Set(input.teamIds);
  return appTeamIds.some((teamId) => viewerTeamIds.has(teamId));
}

export function appIsVisibleInSidebar(input: {
  app: AppMetadata;
  userId: string;
  teamIds: string[];
}): boolean {
  const isCreator = input.app.createdByUserId === input.userId;
  const isCollaborator = (input.app.collaboratorUserIds ?? []).includes(input.userId);

  if (isCreator || isCollaborator) return true;

  if (!appHasPublishedVersion(input.app)) {
    return false;
  }

  if ((input.app.visibility ?? "workspace") === "workspace") {
    return true;
  }

  const appTeamIds = input.app.teamIds ?? [];
  if (appTeamIds.length === 0) {
    return false;
  }

  const viewerTeamIds = new Set(input.teamIds);
  return appTeamIds.some((teamId) => viewerTeamIds.has(teamId));
}

export async function resolveAppAccess(input: {
  workspaceContext: WorkspaceContext;
  appId: string;
}): Promise<AppAccess | null> {
  const app = await findAppAccessMetadata({
    workspaceId: input.workspaceContext.workspaceId,
    appId: input.appId,
  });

  if (!app) return null;

  const isAdmin = isWorkspaceAdminRole(input.workspaceContext.membership.role);
  const isCreator = app.createdByUserId === input.workspaceContext.user._id;
  const isCollaborator = (app.collaboratorUserIds ?? []).includes(
    input.workspaceContext.user._id,
  );
  const teamIds = isAdmin || isCreator
    ? []
    : await listTeamIdsForUser({
        workspaceId: input.workspaceContext.workspaceId,
        userId: input.workspaceContext.user._id,
      });

  if (
    !appIsVisibleToViewer({
      app,
      userId: input.workspaceContext.user._id,
      role: input.workspaceContext.membership.role,
      teamIds,
    })
  ) {
    return null;
  }

  return {
    app,
    isAdmin,
    isCreator,
    isCollaborator,
    canManage: isAdmin || isCreator,
    canCollaborate: isAdmin || isCreator || isCollaborator,
    canManageCollaborators: isAdmin || isCreator,
    canReview: isAdmin,
  };
}

export async function listAppsVisibleToWorkspaceContext(
  workspaceContext: WorkspaceContext,
): Promise<AppMetadata[]> {
  const apps = await listAppMetadataForWorkspace(workspaceContext.workspaceId);
  const isAdmin = isWorkspaceAdminRole(workspaceContext.membership.role);
  const teamIds = isAdmin
    ? []
    : await listTeamIdsForUser({
        workspaceId: workspaceContext.workspaceId,
        userId: workspaceContext.user._id,
      });

  return apps.filter((app) =>
    appIsVisibleToViewer({
      app,
      userId: workspaceContext.user._id,
      role: workspaceContext.membership.role,
      teamIds,
    }),
  );
}

export async function listAppsVisibleInSidebarForWorkspaceContext(
  workspaceContext: WorkspaceContext,
): Promise<AppMetadata[]> {
  const [apps, teamIds] = await Promise.all([
    listAppSidebarMetadataForWorkspace(workspaceContext.workspaceId),
    listTeamIdsForUser({
      workspaceId: workspaceContext.workspaceId,
      userId: workspaceContext.user._id,
    }),
  ]);

  return apps.filter((app) =>
    appIsVisibleInSidebar({
      app,
      userId: workspaceContext.user._id,
      teamIds,
    }),
  );
}
