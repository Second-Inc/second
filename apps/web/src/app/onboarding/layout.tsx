import type { ReactNode } from "react";
import { OnboardingFrame } from "@/components/onboarding/onboarding-shell";

export default function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <OnboardingFrame>{children}</OnboardingFrame>;
}
