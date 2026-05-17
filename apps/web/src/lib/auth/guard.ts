import {
  ACTIVE_WORKSPACE_COOKIE,
  WORKSPACE_HEADER_NAME,
} from "@/lib/auth/constants";
import { readCookieFromHeaders } from "@/lib/auth/session";
import { resolveActor } from "@/lib/auth/provider";
import type { AuthActor, HeaderReader } from "@/lib/auth/types";
import {
  findUserById,
  listMembershipsForUser,
  type UserDocument,
  type WorkspaceMembershipDocument,
} from "@/lib/db";

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

type GuardRequest = {
  headers: HeaderReader;
};

export type OnboardingState =
  | {
      status: "missing-identity";
    }
  | {
      status: "needs-profile";
      actor: AuthActor;
    }
  | {
      status: "needs-workspace";
      actor: AuthActor;
      user: UserDocument;
    }
  | {
      status: "ready";
      actor: AuthActor;
      user: UserDocument;
      memberships: WorkspaceMembershipDocument[];
    };

export type WorkspaceContext = {
  actor: AuthActor;
  user: UserDocument;
  workspaceId: string;
  membership: WorkspaceMembershipDocument;
  memberships: WorkspaceMembershipDocument[];
};

export type GuardFailureCode =
  | "identity_required"
  | "profile_required"
  | "workspace_required"
  | "not_found";

export class RequestGuardError extends Error {
  readonly code: GuardFailureCode;

  constructor(code: GuardFailureCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function isRequestGuardError(error: unknown): error is RequestGuardError {
  return error instanceof RequestGuardError;
}

export function normalizeObjectId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed || !OBJECT_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed.toLowerCase();
}

export function normalizeWorkspaceId(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed || !WORKSPACE_SLUG_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function readRawWorkspaceIdFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "w" && segments[1]) {
    return segments[1];
  }

  if (segments[0] === "api" && segments[1] === "workspaces" && segments[2]) {
    return segments[2];
  }

  return null;
}

export function resolveWorkspaceIdFromPath(pathname: string): string | null {
  return normalizeWorkspaceId(readRawWorkspaceIdFromPath(pathname));
}

export function hasInvalidExplicitWorkspaceSelection(input: {
  pathname?: string;
  workspaceId?: string | null;
}): boolean {
  if (input.workspaceId !== undefined && input.workspaceId !== null) {
    return normalizeWorkspaceId(input.workspaceId) === null;
  }

  if (!input.pathname) {
    return false;
  }

  const rawWorkspaceId = readRawWorkspaceIdFromPath(input.pathname);

  if (rawWorkspaceId === null) {
    return false;
  }

  return normalizeWorkspaceId(rawWorkspaceId) === null;
}

export function resolveRequestedWorkspaceId(input: {
  headers: HeaderReader;
  pathname?: string;
  workspaceId?: string | null;
}): string | null {
  if (input.workspaceId !== undefined && input.workspaceId !== null) {
    return normalizeWorkspaceId(input.workspaceId);
  }

  if (input.pathname) {
    const pathWorkspaceId = readRawWorkspaceIdFromPath(input.pathname);

    if (pathWorkspaceId !== null) {
      return normalizeWorkspaceId(pathWorkspaceId);
    }
  }

  const headerWorkspaceId = normalizeWorkspaceId(
    input.headers.get(WORKSPACE_HEADER_NAME),
  );

  if (headerWorkspaceId) {
    return headerWorkspaceId;
  }

  const cookieWorkspaceId = normalizeWorkspaceId(
    readCookieFromHeaders(input.headers, ACTIVE_WORKSPACE_COOKIE),
  );

  return cookieWorkspaceId;
}

function hasRequiredUserProfile(user: UserDocument): boolean {
  return Boolean(user.displayName.trim() && user.email.trim());
}

export async function resolveOnboardingState(
  request: GuardRequest,
): Promise<OnboardingState> {
  const actor = await resolveActor({ headers: request.headers });

  if (!actor) {
    return { status: "missing-identity" };
  }

  const user = await findUserById(actor.userId);

  if (!user || !hasRequiredUserProfile(user)) {
    return { status: "needs-profile", actor };
  }

  const memberships = await listMembershipsForUser(user._id);

  if (memberships.length === 0) {
    return {
      status: "needs-workspace",
      actor,
      user,
    };
  }

  return {
    status: "ready",
    actor,
    user,
    memberships,
  };
}

export async function requireReadyState(
  request: GuardRequest,
): Promise<Extract<OnboardingState, { status: "ready" }>> {
  const state = await resolveOnboardingState(request);

  if (state.status === "missing-identity") {
    throw new RequestGuardError(
      "identity_required",
      "Request requires an authenticated actor.",
    );
  }

  if (state.status === "needs-profile") {
    throw new RequestGuardError(
      "profile_required",
      "Actor identity is missing required profile fields.",
    );
  }

  if (state.status === "needs-workspace") {
    throw new RequestGuardError(
      "workspace_required",
      "User must create a workspace before accessing this route.",
    );
  }

  return state;
}

export async function requireWorkspaceContext(input: {
  headers: HeaderReader;
  pathname?: string;
  workspaceId?: string | null;
}): Promise<WorkspaceContext> {
  if (hasInvalidExplicitWorkspaceSelection(input)) {
    throw new RequestGuardError(
      "not_found",
      "Workspace was not found for the current actor.",
    );
  }

  const readyState = await requireReadyState({ headers: input.headers });
  const requestedWorkspaceId = resolveRequestedWorkspaceId(input);

  const workspaceId =
    requestedWorkspaceId ?? readyState.memberships[0]?.workspaceId ?? null;

  if (!workspaceId) {
    throw new RequestGuardError(
      "workspace_required",
      "No workspace membership is available for the current actor.",
    );
  }

  const membership = readyState.memberships.find(
    (item) => item.workspaceId === workspaceId,
  );

  if (!membership) {
    throw new RequestGuardError(
      "not_found",
      "Workspace was not found for the current actor.",
    );
  }

  return {
    actor: readyState.actor,
    user: readyState.user,
    workspaceId,
    membership,
    memberships: readyState.memberships,
  };
}
