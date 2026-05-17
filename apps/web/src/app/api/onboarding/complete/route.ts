import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireReadyState,
} from "@/lib/auth";
import { updateUserOnboarding } from "@/lib/db";

export async function POST(request: Request) {
  let readyState: Awaited<ReturnType<typeof requireReadyState>>;

  try {
    readyState = await requireReadyState({ headers: request.headers });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  await updateUserOnboarding({
    userId: readyState.user._id,
    completed: true,
  });

  return NextResponse.json({ ok: true });
}
