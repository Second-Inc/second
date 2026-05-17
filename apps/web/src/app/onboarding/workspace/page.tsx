import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
} from "lucide-react";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { WorkspaceOnboardingForm } from "@/components/onboarding/workspace-onboarding-form";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  IDENTITY_ONBOARDING_PATH,
  LOADER_ONBOARDING_PATH,
  resolveOnboardingState,
} from "@/lib/auth";
import { findWorkspaceById } from "@/lib/db";
import { userCompletedOnboarding } from "@/lib/onboarding";

export default async function WorkspaceOnboardingPage() {
  const onboardingState = await resolveOnboardingState({
    headers: await headers(),
  });

  if (onboardingState.status === "missing-identity") {
    redirect(IDENTITY_ONBOARDING_PATH);
  }

  if (onboardingState.status === "needs-profile") {
    redirect(IDENTITY_ONBOARDING_PATH);
  }

  if (
    onboardingState.status === "ready" &&
    userCompletedOnboarding(onboardingState.user)
  ) {
    redirect(`/w/${onboardingState.memberships[0].workspaceId}`);
  }

  const firstName =
    onboardingState.user.displayName.split(" ")[0] || null;
  const existingWorkspace =
    onboardingState.status === "ready"
      ? await findWorkspaceById(onboardingState.memberships[0].workspaceId)
      : null;

  return (
    <OnboardingShell
      step="workspace"
      title={`Create the company workspace${firstName ? `, ${firstName}` : ""}.`}
      description="This company name anchors your Second workspace and gives the onboarding agent a starting point for useful context."
      trackProgress={onboardingState.status === "ready"}
    >
      {existingWorkspace ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-lg bg-muted/40 p-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
              <CheckIcon className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-medium">Workspace created</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {existingWorkspace.name} is ready. Continue to the next setup
                phase or go back to update your profile details.
              </p>
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <Button asChild variant="ghost">
              <Link href={IDENTITY_ONBOARDING_PATH}>
                <ArrowLeftIcon data-icon="inline-start" />
                Back
              </Link>
            </Button>
            <Button asChild>
              <Link href={LOADER_ONBOARDING_PATH}>
                Continue
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <WorkspaceOnboardingForm />
      )}
    </OnboardingShell>
  );
}
