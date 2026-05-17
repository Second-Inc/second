import { NextResponse } from "next/server";
import {
  buildWorkspaceCookie,
  guardErrorToApiResponse,
  isRequestGuardError,
  requireReadyState,
} from "@/lib/auth";
import { PUBLIC_URL } from "@/lib/config";
import { createWorkspaceWithOwner } from "@/lib/db";
import { validateWorkspaceName } from "@/lib/validation";

export async function POST(request: Request) {
  let readyState: Awaited<ReturnType<typeof requireReadyState>>;

  try {
    readyState = await requireReadyState({ headers: request.headers });
  } catch (error) {
    if (isRequestGuardError(error)) {
      return guardErrorToApiResponse(error);
    }

    throw error;
  }

  const formData = await request.formData();
  const workspaceName = validateWorkspaceName(formData.get("workspaceName"));

  if (!workspaceName) {
    return NextResponse.redirect(
      new URL(
        `/w/${readyState.memberships[0].workspaceId}?error=invalid_workspace`,
        PUBLIC_URL,
      ),
      303,
    );
  }

  const workspace = await createWorkspaceWithOwner({
    name: workspaceName,
    userId: readyState.user._id,
  });

  const response = NextResponse.redirect(
    new URL(`/w/${workspace._id}`, PUBLIC_URL),
    303,
  );

  response.cookies.set(
    buildWorkspaceCookie({
      headers: request.headers,
      url: request.url,
      workspaceId: workspace._id,
    }),
  );

  return response;
}
