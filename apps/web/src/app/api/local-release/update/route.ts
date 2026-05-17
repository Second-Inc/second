import { NextRequest, NextResponse } from "next/server";
import { installLocalReleaseUpdate } from "@/lib/local-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json(
      {
        enabled: true,
        accepted: false,
        updating: false,
        error: {
          code: "cross_origin_update_blocked",
          message: "Update requests must come from the local Second app.",
        },
      },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const result = await installLocalReleaseUpdate();
  const status = result.accepted ? 202 : result.enabled ? 503 : 404;

  return NextResponse.json(result, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isSameOriginMutation(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === request.nextUrl.origin;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}
