import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { IntroOnboarding } from "@/components/onboarding/intro-onboarding";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import {
  IDENTITY_ONBOARDING_PATH,
  WORKSPACE_ONBOARDING_PATH,
  resolveOnboardingState,
} from "@/lib/auth";
import { readRuntimeConfig } from "@/lib/config";
import { nextOnboardingPathForReadyUser } from "@/lib/onboarding";

export default async function IntroOnboardingPage() {
  const config = readRuntimeConfig();
  const onboardingState = await resolveOnboardingState({
    headers: await headers(),
  });

  if (onboardingState.status === "needs-profile") {
    redirect(IDENTITY_ONBOARDING_PATH);
  }

  if (onboardingState.status === "needs-workspace") {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  if (onboardingState.status === "ready") {
    const onboardingPath = nextOnboardingPathForReadyUser({
      authMode: config.authMode,
      user: onboardingState.user,
    });

    if (onboardingPath) {
      redirect(onboardingPath);
    }

    redirect(`/w/${onboardingState.memberships[0].workspaceId}`);
  }

  return (
    <OnboardingShell step="intro" title="Welcome to Second">
      <IntroOnboarding />
    </OnboardingShell>
  );
}
