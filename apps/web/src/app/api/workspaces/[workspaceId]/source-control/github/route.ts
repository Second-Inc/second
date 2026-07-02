import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAccessDeniedAuditEvent,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  deleteSourceControlConnection,
  getSourceControlConnection,
  serializeSourceControlConnection,
  upsertSourceControlConnection,
} from "@/lib/db";
import {
  deleteSourceControlCredential,
  readSourceControlCredential,
  upsertSourceControlCredential,
} from "@/lib/source-control/credential-store";
import { getSourceControlProvider } from "@/lib/source-control";
import {
  safeSourceControlErrorMessage,
  SourceControlProviderError,
} from "@/lib/source-control/types";

type GitHubRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

type GitHubConfigInput = {
  token?: string;
  targetOwner: string;
  defaultVisibility: "private" | "public";
  repoNamePrefix?: string | null;
  sourceStorageMode: "mongo" | "source_control";
};

function parseConfig(value: unknown): GitHubConfigInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const token = typeof record.token === "string" ? record.token.trim() : "";
  const targetOwner =
    typeof record.targetOwner === "string" ? record.targetOwner.trim() : "";
  const defaultVisibility =
    record.defaultVisibility === "public" ? "public" : "private";
  const repoNamePrefix =
    typeof record.repoNamePrefix === "string" && record.repoNamePrefix.trim()
      ? record.repoNamePrefix.trim().slice(0, 48)
      : null;
  const sourceStorageMode =
    record.sourceStorageMode === "source_control" ? "source_control" : "mongo";
  if (!targetOwner) return null;
  return {
    ...(token ? { token } : {}),
    targetOwner,
    defaultVisibility,
    repoNamePrefix,
    sourceStorageMode,
  };
}

async function requireManagePermission(input: {
  request: Request;
  workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  action: string;
  summary: string;
}) {
  if (hasWorkspacePermission(input.workspaceContext.membership, "workspace:manage")) {
    return null;
  }
  await recordAccessDeniedAuditEvent({
    request: input.request,
    workspaceContext: input.workspaceContext,
    permission: "workspace:manage",
    action: input.action,
    summary: input.summary,
    target: {
      type: "source_control_connection",
      id: input.workspaceContext.workspaceId,
      name: "GitHub source control",
    },
  });
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function PUT(request: Request, context: GitHubRouteContext) {
  const { workspaceId } = await context.params;
  const url = new URL(request.url);
  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: url.pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const denied = await requireManagePermission({
    request,
    workspaceContext,
    action: "configure_source_control",
    summary:
      "Denied source-control configuration because actor lacks workspace:manage.",
  });
  if (denied) return denied;

  const input = parseConfig(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ error: "invalid_source_control" }, { status: 400 });
  }

  const existing = await getSourceControlConnection({
    workspaceId: workspaceContext.workspaceId,
    provider: "github",
  });

  let token = input.token ?? null;
  if (!token && existing?.credentialRef) {
    token = await readSourceControlCredential(existing.credentialRef);
  }
  if (!token) {
    return NextResponse.json({ error: "missing_github_token" }, { status: 400 });
  }

  try {
    const provider = getSourceControlProvider("github");
    const validation = await provider.validateConnection({
      auth: { token },
      targetOwner: input.targetOwner,
    });
    const credentialRef = await upsertSourceControlCredential({
      workspaceId: workspaceContext.workspaceId,
      provider: "github",
      token,
      existingRef: existing?.credentialRef ?? null,
    });
    const connection = await upsertSourceControlConnection({
      workspaceId: workspaceContext.workspaceId,
      provider: "github",
      mode: "pat",
      status: "valid",
      targetOwner: validation.targetOwner,
      targetOwnerType: validation.targetOwnerType,
      defaultVisibility: input.defaultVisibility,
      repoNamePrefix: input.repoNamePrefix,
      sourceStorageMode: input.sourceStorageMode,
      credentialRef,
      credentialKind: "github_pat",
      connectedAccountLogin: validation.connectedAccountLogin,
      connectedByUserId: workspaceContext.user._id,
      connectedByName: workspaceContext.user.displayName,
      permissionsState: validation.permissionsState,
      lastValidatedAt: new Date(),
      lastErrorCode: null,
    });

    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: existing
        ? "source_control.connection_updated"
        : "source_control.connected",
      category: "source_control",
      severity: "notice",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request),
      target: {
        type: "source_control_connection",
        id: connection._id,
        name: "GitHub",
      },
      action: existing ? "updated" : "connected",
      summary: existing
        ? "Updated GitHub source-control connection."
        : "Connected GitHub source control.",
      metadata: {
        provider: "github",
        targetOwner: connection.targetOwner,
        targetOwnerType: connection.targetOwnerType,
        defaultVisibility: connection.defaultVisibility,
        sourceStorageMode: connection.sourceStorageMode ?? "mongo",
        connectedAccountLogin: connection.connectedAccountLogin,
        credentialStored: true,
      },
      changes: {
        changedFields: [
          "targetOwner",
          "defaultVisibility",
          "sourceStorageMode",
          "credentialRef",
          "permissionsState",
        ],
        redactedFields: ["credentialRef"],
      },
    });

    return NextResponse.json({
      connection: serializeSourceControlConnection(connection),
    });
  } catch (error) {
    const status = error instanceof SourceControlProviderError
      ? error.status
      : 400;
    return NextResponse.json(
      {
        error:
          error instanceof SourceControlProviderError
            ? error.code
            : "github_connection_failed",
        message: safeSourceControlErrorMessage(error),
      },
      { status },
    );
  }
}

export async function DELETE(request: Request, context: GitHubRouteContext) {
  const { workspaceId } = await context.params;
  const url = new URL(request.url);
  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: url.pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const denied = await requireManagePermission({
    request,
    workspaceContext,
    action: "disconnect_source_control",
    summary:
      "Denied source-control disconnection because actor lacks workspace:manage.",
  });
  if (denied) return denied;

  const deleted = await deleteSourceControlConnection({
    workspaceId: workspaceContext.workspaceId,
    provider: "github",
  });
  if (deleted?.credentialRef) {
    await deleteSourceControlCredential(deleted.credentialRef);
  }

  if (deleted) {
    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "source_control.disconnected",
      category: "source_control",
      severity: "notice",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request),
      target: {
        type: "source_control_connection",
        id: deleted._id,
        name: "GitHub",
      },
      action: "disconnected",
      summary: "Disconnected GitHub source control.",
      metadata: {
        provider: "github",
        targetOwner: deleted.targetOwner,
      },
      changes: {
        changedFields: ["sourceControlConnection"],
        redactedFields: ["credentialRef"],
      },
    });
  }

  return NextResponse.json({ ok: true });
}
