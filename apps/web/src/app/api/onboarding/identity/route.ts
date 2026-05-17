import { NextResponse } from "next/server";
import {
  buildClearedWorkspaceCookie,
  buildNoAuthSessionCookie,
  buildWorkspaceCookie,
  IDENTITY_ONBOARDING_PATH,
  WORKSPACE_ONBOARDING_PATH,
} from "@/lib/auth";
import { readRuntimeConfig } from "@/lib/config";
import {
  listMembershipsForUser,
  updateUserOnboarding,
  upsertUserByEmail,
} from "@/lib/db";
import { userCompletedOnboarding } from "@/lib/onboarding";
import {
  validateDisplayName,
  validateEmail,
  validateOptionalProfileRole,
} from "@/lib/validation";

export async function POST(request: Request) {
  const config = readRuntimeConfig();

  if (config.authMode !== "none") {
    return NextResponse.json({ error: "unsupported_auth_mode" }, { status: 400 });
  }

  const formData = await request.formData();
  const displayName = validateDisplayName(formData.get("displayName"));
  const email = validateEmail(formData.get("email"));
  const rawProfileRole = formData.get("profileRole");
  const profileRole = validateOptionalProfileRole(rawProfileRole);
  const rawProfileRoleText =
    typeof rawProfileRole === "string" ? rawProfileRole.trim() : "";
  const hasInvalidProfileRole =
    rawProfileRole !== null &&
    (typeof rawProfileRole !== "string" ||
      (rawProfileRoleText.length > 0 && profileRole === null));

  if (!displayName || !email || hasInvalidProfileRole) {
    return NextResponse.redirect(
      new URL(`${IDENTITY_ONBOARDING_PATH}?error=invalid_identity`, config.publicUrl),
      303,
    );
  }

  const user = await upsertUserByEmail({ displayName, email, profileRole });
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
