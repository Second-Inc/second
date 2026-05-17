import { NextResponse } from "next/server";
import { getLocalReleaseStatus } from "@/lib/local-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getLocalReleaseStatus();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
