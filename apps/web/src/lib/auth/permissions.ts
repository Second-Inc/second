import type {
  WorkspaceMembershipDocument,
  WorkspaceRole,
} from "@/lib/db/types";

export type WorkspacePermission =
  | "workspace:view"
  | "workspace:manage"
  | "members:view"
  | "members:invite"
  | "members:manage"
  | "members:manage-owner"
  | "integrations:view"
  | "integrations:manage"
  | "audit:read"
  | "apps:create"
  | "apps:update"
  | "apps:delete"
  | "agents:run";

const OWNER_PERMISSIONS = [
  "workspace:view",
  "workspace:manage",
  "members:view",
  "members:invite",
  "members:manage",
  "members:manage-owner",
  "integrations:view",
  "integrations:manage",
  "audit:read",
  "apps:create",
  "apps:update",
  "apps:delete",
  "agents:run",
] as const satisfies readonly WorkspacePermission[];

const ADMIN_PERMISSIONS = [
  "workspace:view",
  "workspace:manage",
  "members:view",
  "members:invite",
  "members:manage",
  "integrations:view",
  "integrations:manage",
  "audit:read",
  "apps:create",
  "apps:update",
  "apps:delete",
  "agents:run",
] as const satisfies readonly WorkspacePermission[];

const MEMBER_PERMISSIONS = [
  "workspace:view",
  "members:view",
  "integrations:view",
  "apps:create",
  "apps:update",
  "apps:delete",
  "agents:run",
] as const satisfies readonly WorkspacePermission[];

const ROLE_PERMISSION_LISTS: Record<
  WorkspaceRole,
  readonly WorkspacePermission[]
> = {
  owner: OWNER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  member: MEMBER_PERMISSIONS,
};

const ROLE_PERMISSIONS: Record<
  WorkspaceRole,
  ReadonlySet<WorkspacePermission>
> = {
  owner: new Set(OWNER_PERMISSIONS),
  admin: new Set(ADMIN_PERMISSIONS),
  member: new Set(MEMBER_PERMISSIONS),
};

export class WorkspacePermissionError extends Error {
  readonly permission: WorkspacePermission;

  constructor(permission: WorkspacePermission) {
    super(`Workspace permission required: ${permission}`);
    this.permission = permission;
  }
}

export function listWorkspacePermissions(
  membership: Pick<WorkspaceMembershipDocument, "role">,
): WorkspacePermission[] {
  return [...ROLE_PERMISSION_LISTS[membership.role]];
}

export function hasWorkspacePermission(
  membership: Pick<WorkspaceMembershipDocument, "role"> | null | undefined,
  permission: WorkspacePermission,
): boolean {
  if (!membership) return false;
  return ROLE_PERMISSIONS[membership.role]?.has(permission) ?? false;
}

export function assertWorkspacePermission(
  membership: Pick<WorkspaceMembershipDocument, "role"> | null | undefined,
  permission: WorkspacePermission,
): void {
  if (!hasWorkspacePermission(membership, permission)) {
    throw new WorkspacePermissionError(permission);
  }
}

export function isWorkspacePermissionError(
  error: unknown,
): error is WorkspacePermissionError {
  return error instanceof WorkspacePermissionError;
}

export function roleCanManageOwner(role: WorkspaceRole): boolean {
  return role === "owner";
}
