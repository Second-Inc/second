import { NextResponse } from "next/server";
import { validateInternalToken } from "@/lib/auth/internal-auth";
import {
  findMembership,
  findUserById,
  findWorkspaceById,
  updateUserContext,
  updateWorkspaceCompanyContext,
} from "@/lib/db";
import { normalizeOnboardingContextText } from "@/lib/onboarding-context";

type OnboardingContextRequest = {
  workspaceId?: unknown;
  userId?: unknown;
  companyContext?: unknown;
  userContext?: unknown;
};

function logId() {
  return Math.random().toString(36).slice(2, 8);
}

export async function POST(request: Request) {
  const requestId = logId();
  const authError = validateInternalToken(request);
  if (authError) {
    console.warn("[onboarding-context-save] rejected internal auth", {
      requestId,
    });
    return authError;
  }

  let body: OnboardingContextRequest;
  try {
    body = (await request.json()) as OnboardingContextRequest;
  } catch {
    console.warn("[onboarding-context-save] invalid json", { requestId });
    return NextResponse.json(
      { success: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const workspaceId =
    typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!workspaceId || !userId) {
    console.warn("[onboarding-context-save] missing ids", {
      requestId,
      hasWorkspaceId: Boolean(workspaceId),
      hasUserId: Boolean(userId),
    });
    return NextResponse.json(
      { success: false, error: "workspaceId_and_userId_required" },
      { status: 400 },
    );
  }

  console.info("[onboarding-context-save] request", {
    requestId,
    workspaceId,
    userId,
    rawCompanyContextType: typeof body.companyContext,
    rawUserContextType: typeof body.userContext,
    rawCompanyContextChars:
      typeof body.companyContext === "string" ? body.companyContext.length : null,
    rawUserContextChars:
      typeof body.userContext === "string" ? body.userContext.length : null,
  });

  const [workspace, user] = await Promise.all([
    findWorkspaceById(workspaceId),
    findUserById(userId),
  ]);
  if (!workspace || !user) {
    console.warn("[onboarding-context-save] workspace or user not found", {
      requestId,
      workspaceId,
      userId,
      foundWorkspace: Boolean(workspace),
      foundUser: Boolean(user),
    });
    return NextResponse.json(
      { success: false, error: "not_found" },
      { status: 404 },
    );
  }

  const membership = await findMembership({ workspaceId, userId });
  if (!membership) {
    console.warn("[onboarding-context-save] membership not found", {
      requestId,
      workspaceId,
      userId,
    });
    return NextResponse.json(
      { success: false, error: "not_found" },
      { status: 404 },
    );
  }

  const companyContext = normalizeOnboardingContextText(body.companyContext);
  const userContext = normalizeOnboardingContextText(body.userContext);
  if (!companyContext && !userContext) {
    console.warn("[onboarding-context-save] normalized context empty", {
      requestId,
      workspaceId,
      userId,
      rawCompanyContextType: typeof body.companyContext,
      rawUserContextType: typeof body.userContext,
    });
    return NextResponse.json(
      { success: false, error: "context_required" },
      { status: 400 },
    );
  }

  await Promise.all([
    updateWorkspaceCompanyContext({ workspaceId, companyContext }),
    updateUserContext({ userId, userContext }),
  ]);

  console.info("[onboarding-context-save] saved", {
    requestId,
    workspaceId,
    userId,
    companyContextChars: companyContext?.length ?? 0,
    userContextChars: userContext?.length ?? 0,
  });

  return NextResponse.json({
    success: true,
    status: "saved",
    workspaceId,
    userId,
    companyContext,
    userContext,
  });
}
