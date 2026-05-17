import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireReadyState,
} from "@/lib/auth";
import {
  updateUserContext,
  updateWorkspaceCompanyContext,
} from "@/lib/db";
import { normalizeOnboardingContextText } from "@/lib/onboarding-context";

type ContextUpdateRequest = {
  companyContext?: unknown;
  userContext?: unknown;
};

export async function POST(request: Request) {
  let readyState: Awaited<ReturnType<typeof requireReadyState>>;
  try {
    readyState = await requireReadyState({ headers: request.headers });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const workspaceId = readyState.memberships[0]?.workspaceId;
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspace_required" },
      { status: 403 },
    );
  }

  let body: ContextUpdateRequest;
  try {
    body = (await request.json()) as ContextUpdateRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const companyContext = normalizeOnboardingContextText(body.companyContext);
  const userContext = normalizeOnboardingContextText(body.userContext);

  await Promise.all([
    updateWorkspaceCompanyContext({ workspaceId, companyContext }),
    updateUserContext({
      userId: readyState.user._id,
      userContext,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    companyContext,
    userContext,
  });
}
