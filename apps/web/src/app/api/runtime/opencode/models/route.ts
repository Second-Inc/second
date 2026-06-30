import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireReadyState,
} from "@/lib/auth";
import { workerFetch } from "@/lib/worker-client";

export async function GET(request: Request) {
  try {
    await requireReadyState({ headers: request.headers });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1" ? "?refresh=1" : "";

  try {
    const res = await workerFetch(`/opencode/models${refresh}`);
    if (!res.ok) {
      return NextResponse.json(
        {
          available: false,
          models: [],
          totalCount: 0,
          filteredOutCount: 0,
          refreshed: false,
          error: `Worker returned ${res.status}`,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({
      available: false,
      models: [],
      totalCount: 0,
      filteredOutCount: 0,
      refreshed: false,
      error: "Worker not reachable",
    });
  }
}
