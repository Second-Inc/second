import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { StarterOnboarding } from "@/components/onboarding/starter-onboarding";
import {
  IDENTITY_ONBOARDING_PATH,
  PROVIDER_ONBOARDING_PATH,
  WORKSPACE_ONBOARDING_PATH,
  resolveOnboardingState,
} from "@/lib/auth";
import { readRuntimeConfig } from "@/lib/config";
import { findWorkspaceById } from "@/lib/db";
import { userCompletedOnboarding } from "@/lib/onboarding";

export default async function StartOnboardingPage() {
  const config = readRuntimeConfig();
  const onboardingState = await resolveOnboardingState({
    headers: await headers(),
  });

  if (onboardingState.status === "missing-identity") {
    redirect(IDENTITY_ONBOARDING_PATH);
  }

  if (onboardingState.status === "needs-profile") {
    redirect(IDENTITY_ONBOARDING_PATH);
  }

  if (onboardingState.status === "needs-workspace") {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  if (userCompletedOnboarding(onboardingState.user)) {
    redirect(`/w/${onboardingState.memberships[0].workspaceId}`);
  }

  if (config.authMode === "none") {
    redirect(PROVIDER_ONBOARDING_PATH);
  }

  const workspaceId = onboardingState.memberships[0].workspaceId;
  const workspace = await findWorkspaceById(workspaceId);

  if (!workspace) {
    notFound();
  }

  return (
    <OnboardingShell
      step="start"
      eyebrow="Workspace Context"
      title="Personalizing"
      titleShimmer
      description="Second now research information about you, then saves as context."
      fitViewport
      trackProgress
    >
      <StarterOnboarding
        workspaceId={workspaceId}
        workspaceName={workspace.name}
        displayName={onboardingState.user.displayName}
        email={onboardingState.user.email}
        profileRole={onboardingState.user.profileRole}
        initialCompanyContext={workspace.companyContext}
        initialUserContext={onboardingState.user.userContext}
      />
    </OnboardingShell>
  );
}
