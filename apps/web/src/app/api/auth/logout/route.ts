import { NextResponse } from "next/server";
import {
  buildClearedWorkspaceCookie,
  IDENTITY_ONBOARDING_PATH,
  NO_AUTH_SESSION_COOKIE,
} from "@/lib/auth";
import { PUBLIC_URL } from "@/lib/config";

export async function POST(request: Request) {
  const response = NextResponse.redirect(
    new URL(IDENTITY_ONBOARDING_PATH, PUBLIC_URL),
    303,
  );

  // Clear the no-auth session cookie
  response.cookies.set({
    name: NO_AUTH_SESSION_COOKIE,
    value: "",
    maxAge: 0,
    path: "/",
  });

  // Clear the workspace cookie
  response.cookies.set(
    buildClearedWorkspaceCookie({
      headers: request.headers,
      url: request.url,
    }),
  );

  return response;
}
