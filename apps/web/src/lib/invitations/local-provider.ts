import type { WorkspaceInvitationProvider } from "./types";

class UnsupportedInvitationProvider implements WorkspaceInvitationProvider {
  constructor(
    private readonly reason: "local_auth" | "not_configured",
  ) {}

  getCapability() {
    return {
      supported: false,
      reason: this.reason,
    } as const;
  }

  async ensureWorkspaceExternalOrganization(): Promise<never> {
    throw new Error(
      `[invitations] Workspace invitations are unavailable: ${this.reason}.`,
    );
  }

  async sendWorkspaceInvitation(): Promise<never> {
    throw new Error(
      `[invitations] Workspace invitations are unavailable: ${this.reason}.`,
    );
  }

  async revokeWorkspaceInvitation(): Promise<void> {
    throw new Error(
      `[invitations] Workspace invitations are unavailable: ${this.reason}.`,
    );
  }

  async resendWorkspaceInvitation(): Promise<void> {
    throw new Error(
      `[invitations] Workspace invitations are unavailable: ${this.reason}.`,
    );
  }

  async updateWorkspaceMemberRole(): Promise<void> {
    throw new Error(
      `[invitations] External workspace membership management is unavailable: ${this.reason}.`,
    );
  }

  async removeWorkspaceMember(): Promise<void> {
    throw new Error(
      `[invitations] External workspace membership management is unavailable: ${this.reason}.`,
    );
  }
}

export const localInvitationProvider = new UnsupportedInvitationProvider(
  "local_auth",
);

export const notConfiguredInvitationProvider = new UnsupportedInvitationProvider(
  "not_configured",
);
