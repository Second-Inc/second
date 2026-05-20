import { NextResponse } from "next/server";
import { validateInternalToken } from "@/lib/auth/internal-auth";
import {
  reportIntegrationSetupTelemetry,
  type IntegrationSetupTelemetryInput,
} from "@/lib/integration-setup-telemetry";

type IntegrationSetupTelemetryRequest = Omit<
  IntegrationSetupTelemetryInput,
  "source" | "error"
> & {
  source?: "web_route" | "worker";
};

export async function POST(request: Request) {
  const authError = validateInternalToken(request);
  if (authError) return authError;

  let body: IntegrationSetupTelemetryRequest;
  try {
    body = (await request.json()) as IntegrationSetupTelemetryRequest;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.workspaceId || !body.appId || !body.status || !body.reason) {
    return NextResponse.json(
      { success: false, error: "workspaceId, appId, status, and reason are required" },
      { status: 400 },
    );
  }

  const result = await reportIntegrationSetupTelemetry({
    ...body,
    source: body.source ?? "worker",
  });

  return NextResponse.json({ success: true, ...result });
}
