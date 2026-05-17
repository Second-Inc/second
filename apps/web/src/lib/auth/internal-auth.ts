import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function validateInternalToken(request: Request): NextResponse | null {
  const internalToken = process.env.INTERNAL_API_TOKEN?.trim();

  if (!internalToken) {
    if (process.env.NODE_ENV !== "production") {
      return null;
    }

    return NextResponse.json(
      { error: "server misconfigured: INTERNAL_API_TOKEN not set" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${internalToken}`;

  if (
    !authHeader ||
    authHeader.length !== expected.length ||
    !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
