import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  IDENTITY_ONBOARDING_PATH,
  INTRO_ONBOARDING_PATH,
  resolveOnboardingState,
  WORKSPACE_ONBOARDING_PATH,
} from "@/lib/auth";
import { readRuntimeConfig } from "@/lib/config";
import { nextOnboardingPathForReadyUser } from "@/lib/onboarding";

export default async function HomePage() {
  const config = readRuntimeConfig();
  const onboardingState = await resolveOnboardingState({
    headers: await headers(),
  });

  if (onboardingState.status === "missing-identity") {
    redirect(INTRO_ONBOARDING_PATH);
  }

  if (onboardingState.status === "needs-profile") {
    redirect(IDENTITY_ONBOARDING_PATH);
  }

  if (onboardingState.status === "needs-workspace") {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  const onboardingPath = nextOnboardingPathForReadyUser({
    authMode: config.authMode,
    user: onboardingState.user,
  });

  if (onboardingPath) {
    redirect(onboardingPath);
  }

  redirect(`/w/${onboardingState.memberships[0].workspaceId}`);
}
