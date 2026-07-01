import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { ProviderSetup } from "@/components/provider-setup";
import { readRuntimeConfig } from "@/lib/config";
import {
  IDENTITY_ONBOARDING_PATH,
  START_ONBOARDING_PATH,
  WORKSPACE_ONBOARDING_PATH,
  resolveOnboardingState,
} from "@/lib/auth";
import { userCompletedOnboarding } from "@/lib/onboarding";

export default async function ProviderOnboardingPage() {
  const config = readRuntimeConfig();

  if (config.authMode !== "none") {
    const state = await resolveOnboardingState({ headers: await headers() });
    if (state.status === "ready") {
      if (userCompletedOnboarding(state.user)) {
        redirect(`/w/${state.memberships[0].workspaceId}`);
      }
      redirect(START_ONBOARDING_PATH);
    }
    redirect(IDENTITY_ONBOARDING_PATH);
  }

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

  return (
    <OnboardingShell
      step="provider"
      eyebrow="Agent Runtime"
      title="Choose your runtime"
      description="Second delegates build work to an agent runtime. In local mode, we check what is already available on this machine before your first build."
      calloutDescription="You are running locally; enterprise runtimes are preconfigured."
      calloutTone="warning"
      trackProgress
    >
      <ProviderSetup workspaceId={onboardingState.memberships[0].workspaceId} />
    </OnboardingShell>
  );
}
