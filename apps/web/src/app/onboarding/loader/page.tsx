import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoaderOnboarding } from "@/components/onboarding/loader-onboarding";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import {
  IDENTITY_ONBOARDING_PATH,
  PROVIDER_ONBOARDING_PATH,
  START_ONBOARDING_PATH,
  WORKSPACE_ONBOARDING_PATH,
  resolveOnboardingState,
} from "@/lib/auth";
import { readRuntimeConfig } from "@/lib/config";
import {
  type OnboardingStepId,
  userCompletedOnboarding,
} from "@/lib/onboarding";

export default async function LoaderOnboardingPage() {
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

  const nextHref =
    config.authMode === "none" ? PROVIDER_ONBOARDING_PATH : START_ONBOARDING_PATH;
  const nextStep: OnboardingStepId =
    config.authMode === "none" ? "provider" : "start";

  return (
    <OnboardingShell
      step="loader"
      title="Choose your loader."
      description="Personalize the small waiting state you will see while Second runs tools, builds apps, and streams work across the workspace."
      trackProgress
    >
      <LoaderOnboarding nextHref={nextHref} nextStep={nextStep} />
    </OnboardingShell>
  );
}
