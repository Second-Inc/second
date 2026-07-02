import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import { getSourceControlProvider } from "@/lib/source-control";
import {
  safeSourceControlErrorMessage,
  SourceControlProviderError,
} from "@/lib/source-control/types";

type ValidateRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

function parseBody(value: unknown): { token: string; targetOwner: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const token = typeof record.token === "string" ? record.token.trim() : "";
  const targetOwner =
    typeof record.targetOwner === "string" ? record.targetOwner.trim() : "";
  if (!token || !targetOwner) return null;
  return { token, targetOwner };
}

export async function POST(request: Request, context: ValidateRouteContext) {
  const { workspaceId } = await context.params;
  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  if (!hasWorkspacePermission(workspaceContext.membership, "workspace:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = parseBody(await request.json().catch(() => null));
  if (!body) {
    return NextResponse.json({ error: "invalid_source_control" }, { status: 400 });
  }

  try {
    const validation = await getSourceControlProvider("github").validateConnection({
      auth: { token: body.token },
      targetOwner: body.targetOwner,
    });
    return NextResponse.json({
      valid: true,
      validation: {
        provider: validation.provider,
        targetOwner: validation.targetOwner,
        targetOwnerType: validation.targetOwnerType,
        connectedAccountLogin: validation.connectedAccountLogin,
        permissionsState: validation.permissionsState,
      },
    });
  } catch (error) {
    const status = error instanceof SourceControlProviderError
      ? error.status
      : 400;
    return NextResponse.json(
      {
        valid: false,
        error:
          error instanceof SourceControlProviderError
            ? error.code
            : "github_validation_failed",
        message: safeSourceControlErrorMessage(error),
      },
      { status },
    );
  }
}
