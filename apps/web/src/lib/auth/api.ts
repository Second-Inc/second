import { NextResponse } from "next/server";
import { RequestGuardError } from "@/lib/auth/guard";

export function guardErrorToApiResponse(error: RequestGuardError): NextResponse {
  switch (error.code) {
    case "identity_required":
      return NextResponse.json({ error: error.code }, { status: 401 });
    case "profile_required":
      return NextResponse.json({ error: error.code }, { status: 401 });
    case "workspace_required":
      return NextResponse.json({ error: error.code }, { status: 403 });
    case "not_found":
      return NextResponse.json({ error: error.code }, { status: 404 });
    default:
      return NextResponse.json({ error: "request_denied" }, { status: 403 });
  }
}
