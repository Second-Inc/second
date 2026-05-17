import type { WorkspaceRole } from "@/lib/db/types";

export type WorkspaceInvitationCapability =
  | { supported: true; provider: "workos" | "external" }
  | { supported: false; reason: "local_auth" | "not_configured" };

export interface WorkspaceInvitationProvider {
  getCapability(): WorkspaceInvitationCapability;

  ensureWorkspaceExternalOrganization(input: {
    workspaceId: string;
    workspaceName: string;
    createdByUserId: string;
  }): Promise<{
    provider: "workos" | "external";
    externalOrganizationId: string;
  }>;

  sendWorkspaceInvitation(input: {
    workspaceId: string;
    workspaceName: string;
    externalOrganizationId: string;
    email: string;
    role: WorkspaceRole;
    teamIds: string[];
    inviterUserId: string;
  }): Promise<{
    provider: "workos" | "external";
    externalInvitationId: string;
    expiresAt?: Date | null;
  }>;

  revokeWorkspaceInvitation(input: {
    externalInvitationId: string;
  }): Promise<void>;

  resendWorkspaceInvitation(input: {
    externalInvitationId: string;
  }): Promise<void>;

  updateWorkspaceMemberRole(input: {
    workspaceId: string;
    externalOrganizationId?: string | null;
    externalOrganizationMembershipId?: string | null;
    userId: string;
    role: WorkspaceRole;
  }): Promise<void>;

  removeWorkspaceMember(input: {
    workspaceId: string;
    externalOrganizationId?: string | null;
    externalOrganizationMembershipId?: string | null;
    userId: string;
  }): Promise<void>;
}
