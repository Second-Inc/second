import { NextResponse } from "next/server";
import { getMongoClient } from "@/lib/db/client";

export async function GET() {
  try {
    const client = await getMongoClient();
    await client.db("admin").command({ ping: 1 });
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error", detail: "db_unreachable" }, { status: 503 });
  }
}
