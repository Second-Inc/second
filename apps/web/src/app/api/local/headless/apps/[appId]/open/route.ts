import { NextResponse } from "next/server";
import {
  buildNoAuthSessionCookie,
  buildWorkspaceCookie,
} from "@/lib/auth/session";
import {
  buildLocalHeadlessUrls,
  findLocalHeadlessApp,
  validateLocalHeadlessLaunchRequest,
} from "@/lib/local-headless";

type HeadlessOpenRouteContext = {
  params: Promise<{ appId: string }>;
};

export async function GET(
  request: Request,
  context: HeadlessOpenRouteContext,
) {
  const authError = validateLocalHeadlessLaunchRequest(request);
  if (authError) return authError;

  const { appId } = await context.params;
  const appContext = await findLocalHeadlessApp(appId);
  if (!appContext) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const requestedWorkspaceId = url.searchParams.get("workspaceId")?.trim();
  if (requestedWorkspaceId && requestedWorkspaceId !== appContext.workspaceId) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }

  const { appUrl } = buildLocalHeadlessUrls({
    workspaceId: appContext.workspaceId,
    appId,
  });
  const response = NextResponse.redirect(appUrl, 303);
  response.cookies.set(
    buildNoAuthSessionCookie({
      headers: request.headers,
      url: request.url,
      userId: appContext.user._id,
    }),
  );
  response.cookies.set(
    buildWorkspaceCookie({
      headers: request.headers,
      url: request.url,
      workspaceId: appContext.workspaceId,
    }),
  );

  return response;
}
