"use client";

import { useCallback, useEffect, useState } from "react";
import { OnboardingLoaderChoice } from "@/components/onboarding/onboarding-loader-choice";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { OnboardingStepId } from "@/lib/onboarding";

type LoaderOnboardingProps = {
  nextHref: string;
  nextStep: OnboardingStepId;
};

export function LoaderOnboarding({
  nextHref,
  nextStep,
}: LoaderOnboardingProps) {
  const [continuing, setContinuing] = useState(false);
  const [loaderReady, setLoaderReady] = useState(false);

  const continueToNextStep = useCallback(async () => {
    if (continuing || !loaderReady) return;
    setContinuing(true);
    await fetch("/api/onboarding/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: nextStep }),
    }).catch(() => {});
    document.dispatchEvent(
      new CustomEvent("second:onboarding-navigate", {
        detail: { href: nextHref },
      }),
    );
  }, [continuing, loaderReady, nextHref, nextStep]);

  useEffect(() => {
    if (!loaderReady) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Enter") return;
      event.preventDefault();
      void continueToNextStep();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [continueToNextStep, loaderReady]);

  return (
    <div className="flex flex-col gap-4">
      <OnboardingLoaderChoice
        onLoaderPopoverDismissed={() => setLoaderReady(true)}
      />
      <div className="flex min-h-7 justify-end">
        {loaderReady ? (
          <Button
            type="button"
            variant="outline"
            disabled={continuing}
            onClick={() => void continueToNextStep()}
          >
            {continuing ? "Continuing..." : "Continue"}
            <Kbd data-icon="inline-end" className="translate-x-0.5">
              ⏎
            </Kbd>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
