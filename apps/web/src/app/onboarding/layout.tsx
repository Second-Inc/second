import type { ReactNode } from "react";
import { OnboardingFrame } from "@/components/onboarding/onboarding-shell";
import { readRuntimeConfig } from "@/lib/config";

export default function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  const config = readRuntimeConfig();
  return (
    <OnboardingFrame isLocalMode={config.authMode === "none"}>
      {children}
    </OnboardingFrame>
  );
}
