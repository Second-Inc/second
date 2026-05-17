import { readRuntimeConfig } from "@/lib/config";
import {
  localInvitationProvider,
  notConfiguredInvitationProvider,
} from "./local-provider";
import type { WorkspaceInvitationProvider } from "./types";

let externalInvitationProvider: WorkspaceInvitationProvider | null = null;

export function registerWorkspaceInvitationProvider(
  provider: WorkspaceInvitationProvider,
): void {
  externalInvitationProvider = provider;
}

export function loadWorkspaceInvitationProvider(): WorkspaceInvitationProvider {
  const config = readRuntimeConfig();

  if (config.authMode === "none") {
    return localInvitationProvider;
  }

  return externalInvitationProvider ?? notConfiguredInvitationProvider;
}
