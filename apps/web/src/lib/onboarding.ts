import {
  IDENTITY_ONBOARDING_PATH,
  LOADER_ONBOARDING_PATH,
  PROVIDER_ONBOARDING_PATH,
  START_ONBOARDING_PATH,
  WORKSPACE_ONBOARDING_PATH,
} from "@/lib/auth/constants";
import type { SecondAuthMode } from "@/lib/config";
import type { UserDocument } from "@/lib/db/types";

export const ONBOARDING_STEPS = [
  "identity",
  "workspace",
  "loader",
  "provider",
  "start",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export function isOnboardingStepId(
  value: unknown,
): value is OnboardingStepId {
  return (
    typeof value === "string" &&
    (ONBOARDING_STEPS as readonly string[]).includes(value)
  );
}

export function onboardingStepPath(step: OnboardingStepId): string {
  if (step === "identity") return IDENTITY_ONBOARDING_PATH;
  if (step === "workspace") return WORKSPACE_ONBOARDING_PATH;
  if (step === "loader") return LOADER_ONBOARDING_PATH;
  if (step === "provider") return PROVIDER_ONBOARDING_PATH;
  return START_ONBOARDING_PATH;
}

export function userCompletedOnboarding(user: UserDocument): boolean {
  return Boolean(user.onboardingCompletedAt);
}

export function nextOnboardingPathForReadyUser(input: {
  authMode: SecondAuthMode;
  user: UserDocument;
}): string | null {
  if (userCompletedOnboarding(input.user)) {
    return null;
  }

  const step = isOnboardingStepId(input.user.onboardingStep)
    ? input.user.onboardingStep
    : "start";

  if (step === "provider" && input.authMode !== "none") {
    return START_ONBOARDING_PATH;
  }

  if (step === "start" && input.authMode === "none") {
    return PROVIDER_ONBOARDING_PATH;
  }

  return onboardingStepPath(step);
}
