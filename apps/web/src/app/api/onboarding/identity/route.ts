import { NextResponse } from "next/server";
import {
  buildClearedWorkspaceCookie,
  buildNoAuthSessionCookie,
  buildWorkspaceCookie,
  IDENTITY_ONBOARDING_PATH,
  LOCAL_ONBOARDING_EMAIL,
  readNoAuthSessionUserId,
  WORKSPACE_ONBOARDING_PATH,
} from "@/lib/auth";
import { readRuntimeConfig } from "@/lib/config";
import {
  findUserById,
  listMembershipsForUser,
  updateUserOnboarding,
  updateUserProfile,
  upsertUserByEmail,
} from "@/lib/db";
import { userCompletedOnboarding } from "@/lib/onboarding";
import {
  validateDisplayName,
  validateProfileRole,
} from "@/lib/validation";

export async function POST(request: Request) {
  const config = readRuntimeConfig();

  if (config.authMode !== "none") {
    return NextResponse.json({ error: "unsupported_auth_mode" }, { status: 400 });
  }

  const formData = await request.formData();
  const displayName = validateDisplayName(formData.get("displayName"));
  const profileRole = validateProfileRole(formData.get("profileRole"));

  if (!displayName || !profileRole) {
    return NextResponse.redirect(
      new URL(`${IDENTITY_ONBOARDING_PATH}?error=invalid_identity`, config.publicUrl),
      303,
    );
  }

  const existingSessionUserId = readNoAuthSessionUserId(request.headers);
  const existingUser = existingSessionUserId
    ? await findUserById(existingSessionUserId)
    : null;
  const user = existingUser
    ? await updateUserProfile({
        userId: existingUser._id,
        displayName,
        email: existingUser.email || LOCAL_ONBOARDING_EMAIL,
        profileRole,
      })
    : await upsertUserByEmail({
        displayName,
        email: LOCAL_ONBOARDING_EMAIL,
        profileRole,
      });

  if (!user) {
    throw new Error("[onboarding] Failed to save local identity.");
  }

  const memberships = await listMembershipsForUser(user._id);

  let destination = WORKSPACE_ONBOARDING_PATH;
  if (memberships.length > 0) {
    if (userCompletedOnboarding(user)) {
      destination = `/w/${memberships[0].workspaceId}`;
    } else {
      await updateUserOnboarding({ userId: user._id, step: "workspace" });
    }
  }

  const response = NextResponse.redirect(new URL(destination, config.publicUrl), 303);

  response.cookies.set(
    buildNoAuthSessionCookie({
      headers: request.headers,
      url: request.url,
      userId: user._id,
    }),
  );

  if (memberships.length > 0) {
    response.cookies.set(
      buildWorkspaceCookie({
        headers: request.headers,
        url: request.url,
        workspaceId: memberships[0].workspaceId,
      }),
    );
  } else {
    response.cookies.set(
      buildClearedWorkspaceCookie({
        headers: request.headers,
        url: request.url,
      }),
    );
  }

  return response;
}
