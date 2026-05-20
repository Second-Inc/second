import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireReadyState,
} from "@/lib/auth";
import { readAnalyticsPublicConfig } from "@/lib/analytics-public-config";

function jsonError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

export async function GET(request: Request) {
  try {
    await requireReadyState({ headers: request.headers });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    return jsonError(500, "analytics_auth_failed");
  }

  const config = readAnalyticsPublicConfig();

  return NextResponse.json(
    {
      posthogToken: config.posthogToken,
      posthogHost: config.posthogHost,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
