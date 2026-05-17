import { NextResponse } from "next/server";
import {
  buildWorkspaceCookie,
  IDENTITY_ONBOARDING_PATH,
  LOADER_ONBOARDING_PATH,
  resolveOnboardingState,
} from "@/lib/auth";
import { PUBLIC_URL, readRuntimeConfig } from "@/lib/config";
import { createWorkspaceWithOwner, updateUserOnboarding } from "@/lib/db";
import {
  nextOnboardingPathForReadyUser,
  userCompletedOnboarding,
} from "@/lib/onboarding";
import { validateWorkspaceName } from "@/lib/validation";

export async function POST(request: Request) {
  const onboardingState = await resolveOnboardingState({
    headers: request.headers,
  });

  if (onboardingState.status === "missing-identity") {
    return NextResponse.redirect(
      new URL(IDENTITY_ONBOARDING_PATH, PUBLIC_URL),
      303,
    );
  }

  if (onboardingState.status === "needs-profile") {
    return NextResponse.redirect(
      new URL(IDENTITY_ONBOARDING_PATH, PUBLIC_URL),
      303,
    );
  }

  if (onboardingState.status === "ready") {
    const destination = userCompletedOnboarding(onboardingState.user)
      ? `/w/${onboardingState.memberships[0].workspaceId}`
      : nextOnboardingPathForReadyUser({
          authMode: readRuntimeConfig().authMode,
          user: onboardingState.user,
        }) ?? `/w/${onboardingState.memberships[0].workspaceId}`;

    return NextResponse.redirect(
      new URL(destination, PUBLIC_URL),
      303,
    );
  }

  const formData = await request.formData();
  const workspaceName = validateWorkspaceName(formData.get("workspaceName"));

  if (!workspaceName) {
    return NextResponse.redirect(
      new URL("/onboarding/workspace?error=invalid_workspace", PUBLIC_URL),
      303,
    );
  }

  const workspace = await createWorkspaceWithOwner({
    name: workspaceName,
    userId: onboardingState.user._id,
  });

  await updateUserOnboarding({
    userId: onboardingState.user._id,
    step: "loader",
  });

  const redirectUrl = new URL(LOADER_ONBOARDING_PATH, PUBLIC_URL);

  const response = NextResponse.redirect(redirectUrl, 303);

  response.cookies.set(
    buildWorkspaceCookie({
      headers: request.headers,
      url: request.url,
      workspaceId: workspace._id,
    }),
  );

  return response;
}
