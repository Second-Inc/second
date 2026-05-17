import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireReadyState,
} from "@/lib/auth";
import { updateUserOnboarding } from "@/lib/db";
import { isOnboardingStepId } from "@/lib/onboarding";

export async function POST(request: Request) {
  let readyState: Awaited<ReturnType<typeof requireReadyState>>;

  try {
    readyState = await requireReadyState({ headers: request.headers });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const body = (await request.json().catch(() => null)) as {
    step?: unknown;
  } | null;

  if (!body || !isOnboardingStepId(body.step)) {
    return NextResponse.json({ error: "invalid_step" }, { status: 400 });
  }

  await updateUserOnboarding({
    userId: readyState.user._id,
    step: body.step,
  });

  return NextResponse.json({ ok: true });
}
