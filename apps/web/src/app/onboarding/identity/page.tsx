import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { IdentityOnboardingForm } from "@/components/onboarding/identity-onboarding-form";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import {
  resolveOnboardingState,
  WORKSPACE_ONBOARDING_PATH,
} from "@/lib/auth";
import { readRuntimeConfig } from "@/lib/config";
import { userCompletedOnboarding } from "@/lib/onboarding";

export default async function IdentityOnboardingPage() {
  const config = readRuntimeConfig();
  const isLocal = config.authMode === "none";

  const onboardingState = await resolveOnboardingState({
    headers: await headers(),
  });

  if (
    onboardingState.status === "ready" &&
    userCompletedOnboarding(onboardingState.user)
  ) {
    redirect(`/w/${onboardingState.memberships[0].workspaceId}`);
  }

  if (onboardingState.status === "needs-workspace") {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  return (
    <OnboardingShell
      step="identity"
      eyebrow={isLocal ? "Local Only" : "Enterprise Identity"}
      title="Set up your identity."
      description="Tell Second who is building so the workspace can personalize your first app, agent runs, and review flows."
      calloutDescription={
        isLocal
          ? "You're seeing this because you are running locally with no SSO connected."
          : undefined
      }
      calloutTone="warning"
      trackProgress={onboardingState.status === "ready"}
    >
      <IdentityOnboardingForm
        defaultDisplayName={
          onboardingState.status === "ready"
            ? onboardingState.user.displayName
            : undefined
        }
        defaultEmail={
          onboardingState.status === "ready"
            ? onboardingState.user.email
            : undefined
        }
        defaultProfileRole={
          onboardingState.status === "ready"
            ? onboardingState.user.profileRole
            : undefined
        }
      />
    </OnboardingShell>
  );
}
