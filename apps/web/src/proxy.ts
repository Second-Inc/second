import { NextResponse, type NextRequest } from "next/server";
import {
  hasInvalidExplicitWorkspaceSelection,
  IDENTITY_ONBOARDING_PATH,
  INTRO_ONBOARDING_PATH,
  LOADER_ONBOARDING_PATH,
  PROVIDER_ONBOARDING_PATH,
  resolveOnboardingState,
  resolveRequestedWorkspaceId,
  START_ONBOARDING_PATH,
  WORKSPACE_ONBOARDING_PATH,
} from "@/lib/auth";
import { readRuntimeConfig } from "@/lib/config";
import { nextOnboardingPathForReadyUser } from "@/lib/onboarding";

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function isLocalReleaseRoute(pathname: string): boolean {
  return pathname.startsWith("/api/local-release/");
}

function isIdentityOnboardingRoute(pathname: string): boolean {
  return (
    pathname === IDENTITY_ONBOARDING_PATH ||
    pathname.startsWith(`${IDENTITY_ONBOARDING_PATH}/`) ||
    pathname.startsWith("/api/onboarding/identity")
  );
}

function isIntroOnboardingRoute(pathname: string): boolean {
  return (
    pathname === INTRO_ONBOARDING_PATH ||
    pathname.startsWith(`${INTRO_ONBOARDING_PATH}/`)
  );
}

function isWorkspaceOnboardingRoute(pathname: string): boolean {
  return (
    pathname === WORKSPACE_ONBOARDING_PATH ||
    pathname.startsWith(`${WORKSPACE_ONBOARDING_PATH}/`) ||
    pathname.startsWith("/api/onboarding/workspace")
  );
}

function isLoaderOnboardingRoute(pathname: string): boolean {
  return (
    pathname === LOADER_ONBOARDING_PATH ||
    pathname.startsWith(`${LOADER_ONBOARDING_PATH}/`)
  );
}

function isProviderOnboardingRoute(pathname: string): boolean {
  return (
    pathname === PROVIDER_ONBOARDING_PATH ||
    pathname.startsWith(`${PROVIDER_ONBOARDING_PATH}/`)
  );
}

function isStartOnboardingRoute(pathname: string): boolean {
  return (
    pathname === START_ONBOARDING_PATH ||
    pathname.startsWith(`${START_ONBOARDING_PATH}/`)
  );
}

function jsonError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

export async function proxy(request: NextRequest) {
  const config = readRuntimeConfig();
  const pathname = request.nextUrl.pathname;

  if (
    pathname === "/api/health" ||
    isLocalReleaseRoute(pathname) ||
    pathname.startsWith("/api/internal/")
  ) {
    return NextResponse.next();
  }

  const onboardingState = await resolveOnboardingState({
    headers: request.headers,
  });
  const requestIsApi = isApiRoute(pathname);
  const requestIsIdentityOnboarding = isIdentityOnboardingRoute(pathname);
  const requestIsIntroOnboarding = isIntroOnboardingRoute(pathname);
  const requestIsWorkspaceOnboarding = isWorkspaceOnboardingRoute(pathname);
  const requestIsOnboarding =
    requestIsIntroOnboarding ||
    requestIsIdentityOnboarding ||
    requestIsWorkspaceOnboarding ||
    isLoaderOnboardingRoute(pathname) ||
    isProviderOnboardingRoute(pathname) ||
    isStartOnboardingRoute(pathname);

  if (onboardingState.status === "missing-identity") {
    if (config.authMode !== "none") {
      if (requestIsApi) {
        return jsonError(401, "identity_required");
      }

      return NextResponse.next();
    }

    if (requestIsIntroOnboarding || requestIsIdentityOnboarding) {
      return NextResponse.next();
    }

    if (requestIsApi) {
      return jsonError(401, "identity_required");
    }

    return NextResponse.redirect(new URL(INTRO_ONBOARDING_PATH, config.publicUrl));
  }

  if (onboardingState.status === "needs-profile") {
    if (config.authMode !== "none") {
      if (requestIsApi) {
        return jsonError(401, "profile_required");
      }

      return NextResponse.next();
    }

    if (requestIsIdentityOnboarding) {
      return NextResponse.next();
    }

    if (requestIsApi) {
      return jsonError(401, "profile_required");
    }

    return NextResponse.redirect(new URL(IDENTITY_ONBOARDING_PATH, config.publicUrl));
  }

  if (onboardingState.status === "needs-workspace") {
    if (config.authMode !== "none") {
      if (requestIsApi) {
        return jsonError(403, "workspace_required");
      }

      return NextResponse.next();
    }

    if (requestIsWorkspaceOnboarding) {
      return NextResponse.next();
    }

    if (requestIsApi) {
      return jsonError(403, "workspace_required");
    }

    return NextResponse.redirect(new URL(WORKSPACE_ONBOARDING_PATH, config.publicUrl));
  }

  if (hasInvalidExplicitWorkspaceSelection({ pathname })) {
    if (requestIsApi) {
      return jsonError(404, "not_found");
    }

    return NextResponse.next();
  }

  const onboardingPath = nextOnboardingPathForReadyUser({
    authMode: config.authMode,
    user: onboardingState.user,
  });

  if (!requestIsApi && onboardingPath) {
    if (!requestIsOnboarding) {
      return NextResponse.redirect(new URL(onboardingPath, config.publicUrl));
    }

    return NextResponse.next();
  }

  const requestedWorkspaceId = resolveRequestedWorkspaceId({
    headers: request.headers,
    pathname,
  });

  if (requestedWorkspaceId) {
    const hasMembership = onboardingState.memberships.some(
      (membership) => membership.workspaceId === requestedWorkspaceId,
    );

    if (!hasMembership) {
      if (requestIsApi) {
        return jsonError(404, "not_found");
      }

      return NextResponse.next();
    }
  }

  if (!requestIsApi && requestIsOnboarding) {
    return NextResponse.redirect(
      new URL(`/w/${onboardingState.memberships[0].workspaceId}`, config.publicUrl),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/w/:path*", "/onboarding/:path*", "/api/:path*"],
};
