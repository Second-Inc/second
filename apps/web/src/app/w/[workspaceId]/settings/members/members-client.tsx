"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  CheckIcon,
  Loader2,
  MailPlusIcon,
  MoreHorizontalIcon,
  RotateCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UsersRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useWorkspaceRealtimeEvent } from "@/components/workspace-realtime-provider";
import type { WorkspacePermission } from "@/lib/auth";
import type { WorkspaceRole } from "@/lib/db";
import {
  abortForNavigation,
  subscribeNavigationIntent,
} from "@/lib/navigation-intent";
import type {
  MembersSettingsInvitation,
  MembersSettingsReadModel,
} from "@/lib/workspace-settings/read-models";
import { cn } from "@/lib/utils";

type Member = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
  teamIds: string[];
  createdAt: string;
  updatedAt: string;
};

type MembersResponse = MembersSettingsReadModel;
type Invitation = MembersSettingsInvitation;

type InviteResponse = {
  invitation?: Invitation;
};

type InFlightFetch = {
  promise: Promise<void>;
  signal?: AbortSignal;
};

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: "Full workspace control",
  admin: "Manage members and integrations",
  member: "Build and use apps",
};

const ROLES: WorkspaceRole[] = ["member", "admin", "owner"];

function roleBadgeVariant(role: WorkspaceRole): "default" | "secondary" | "outline" {
  if (role === "owner") return "default";
  if (role === "admin") return "secondary";
  return "outline";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function hasPermission(
  data: MembersResponse | null,
  permission: WorkspacePermission,
): boolean {
  return data?.currentUser.permissions.includes(permission) ?? false;
}

function upsertInvitation(
  invitations: Invitation[],
  invitation: Invitation,
): Invitation[] {
  return [
    invitation,
    ...invitations.filter((existing) => existing.id !== invitation.id),
  ].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export default function MembersClient({
  initialData,
  initialInvitations,
}: {
  initialData: MembersResponse | null;
  initialInvitations: Invitation[];
}) {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const [data, setData] = useState<MembersResponse | null>(initialData);
  const [invitations, setInvitations] =
    useState<Invitation[]>(initialInvitations);
  const [loading, setLoading] = useState(!initialData);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const fetchMembersInFlightRef = useRef<InFlightFetch | null>(null);

  const canInviteMembers = hasPermission(data, "members:invite");
  const canManageMembers = hasPermission(data, "members:manage");
  const canManageOwners = hasPermission(data, "members:manage-owner");
  const inviteSupported = data?.invitationCapability.supported ?? false;
  const ownerCount = useMemo(
    () => data?.members.filter((member) => member.role === "owner").length ?? 0,
    [data],
  );

  const filteredMembers = useMemo(() => {
    if (!data?.members) return [];
    if (!searchQuery.trim()) return data.members;
    const q = searchQuery.toLowerCase();
    return data.members.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q),
    );
  }, [data?.members, searchQuery]);

  const fetchMembers = useCallback(async (options?: {
    force?: boolean;
    showLoading?: boolean;
    signal?: AbortSignal;
  }) => {
    const inFlight = fetchMembersInFlightRef.current;
    if (!options?.force && inFlight && !inFlight.signal?.aborted) {
      return inFlight.promise;
    }

    const showLoading = options?.showLoading ?? true;
    const run = (async () => {
      if (showLoading) setLoading(true);
      try {
        const membersPromise = fetch(
          `/api/workspaces/${workspaceId}/members`,
          { cache: "no-store", signal: options?.signal },
        );
        const invitationsPromise = fetch(
          `/api/workspaces/${workspaceId}/invitations`,
          { cache: "no-store", signal: options?.signal },
        ).catch(() => null);
        const membersResponse = await membersPromise;
        if (options?.signal?.aborted) return;
        if (!membersResponse.ok) return;
        const membersData = (await membersResponse.json()) as MembersResponse;
        if (options?.signal?.aborted) return;
        setData(membersData);

        if (membersData.currentUser.permissions.includes("members:invite")) {
          const invitationsResponse = await invitationsPromise;
          if (options?.signal?.aborted) return;
          if (invitationsResponse?.ok) {
            const invitationsData = (await invitationsResponse.json()) as {
              invitations: Invitation[];
            };
            if (options?.signal?.aborted) return;
            setInvitations(invitationsData.invitations);
          }
        }
      } catch {
        // Best effort refresh. Mutations still update local state when possible.
      } finally {
        if (showLoading && !options?.signal?.aborted) setLoading(false);
      }
    })();

    fetchMembersInFlightRef.current = {
      promise: run,
      signal: options?.signal,
    };
    try {
      await run;
    } finally {
      if (fetchMembersInFlightRef.current?.promise === run) {
        fetchMembersInFlightRef.current = null;
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    const unsubscribeNavigation = subscribeNavigationIntent(() => {
      abortForNavigation(controller);
    });
    void fetchMembers({ signal: controller.signal });
    return () => {
      unsubscribeNavigation();
      abortForNavigation(controller, "Members settings unmounted.");
    };
  }, [fetchMembers, initialData]);

  useWorkspaceRealtimeEvent(useCallback((event) => {
    if (
      event.workspaceId !== workspaceId ||
      (event.scope !== "memberships" &&
        event.scope !== "team-memberships")
    ) {
      return;
    }
    void fetchMembers({ showLoading: false });
  }, [fetchMembers, workspaceId]));

  const submitInvite = async () => {
    if (!data || !canInviteMembers || !inviteSupported || !inviteEmail.trim()) {
      return;
    }

    setBusyKey("invite");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          reason?: string;
        } | null;
        setMessage(invitationErrorMessage(body?.error, body?.reason));
        return;
      }

      const body = (await response.json().catch(() => null)) as
        | InviteResponse
        | null;
      const createdInvitation = body?.invitation;
      if (createdInvitation) {
        setInvitations((current) =>
          upsertInvitation(current, createdInvitation),
        );
      }

      setInviteEmail("");
      setInviteRole("member");
      setInviteOpen(false);
      void fetchMembers({ force: true, showLoading: false });
    } finally {
      setBusyKey(null);
    }
  };

  const updateRole = async (member: Member, role: WorkspaceRole) => {
    if (member.role === role) return;
    setBusyKey(`role:${member.userId}`);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/members/${member.userId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      if (!response.ok) {
        setMessage("Unable to update that member role.");
        return;
      }
      await fetchMembers({ force: true });
    } finally {
      setBusyKey(null);
    }
  };

  const removeMember = async (member: Member) => {
    setBusyKey(`remove:${member.userId}`);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/members/${member.userId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setMessage("Unable to remove that member.");
        return;
      }
      await fetchMembers({ force: true });
    } finally {
      setBusyKey(null);
    }
  };

  const resendInvitation = async (invitation: Invitation) => {
    setBusyKey(`resend:${invitation.id}`);
    setMessage(null);
    try {
      await fetch(
        `/api/workspaces/${workspaceId}/invitations/${invitation.id}/resend`,
        { method: "POST" },
      );
      await fetchMembers({ force: true });
    } finally {
      setBusyKey(null);
    }
  };

  const revokeInvitation = async (invitation: Invitation) => {
    setBusyKey(`revoke:${invitation.id}`);
    setMessage(null);
    try {
      await fetch(
        `/api/workspaces/${workspaceId}/invitations/${invitation.id}/revoke`,
        { method: "POST" },
      );
      await fetchMembers({ force: true });
    } finally {
      setBusyKey(null);
    }
  };

  const localInviteMessage =
    data?.invitationCapability.supported === false &&
    data.invitationCapability.reason === "local_auth"
      ? "Invitations require external authentication. Local mode can still test roles by seeding a member with scripts/local-workspace-member.mjs."
      : null;

  const pendingCount = invitations.filter((i) => i.status === "pending").length;

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
        <div data-second-desktop-drag-region>
          <h1 className="text-lg font-semibold">Members</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage workspace members, roles, and invitations.
          </p>
        </div>

        {localInviteMessage ? (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {localInviteMessage}
            </p>
          </div>
        ) : null}

        {message ? <p className="text-xs text-destructive">{message}</p> : null}

        {canInviteMembers ? (
          <div className="flex gap-6 border-b border-border">
            <button
              type="button"
              className={cn(
                "-mb-px pb-2.5 text-xs font-medium transition-colors",
                tab === "members"
                  ? "border-b-2 border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTab("members")}
            >
              Members
            </button>
            <button
              type="button"
              className={cn(
                "-mb-px pb-2.5 text-xs font-medium transition-colors",
                tab === "invitations"
                  ? "border-b-2 border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTab("invitations")}
            >
              Invitations
              {pendingCount > 0 ? (
                <span className="ml-1.5 inline-flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                  {pendingCount}
                </span>
              ) : null}
            </button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <UsersRoundIcon className="mx-auto mb-3 size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Members could not be loaded.
            </p>
          </div>
        ) : tab === "members" ? (
          <>
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search"
                  className="pl-9"
                />
              </div>
              {canInviteMembers ? (
                <Button size="sm" onClick={() => setInviteOpen(true)}>
                  <MailPlusIcon data-icon="inline-start" />
                  Invite member
                </Button>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center border-b border-border bg-muted/40 px-5 py-2.5 text-xs font-medium text-muted-foreground">
                <div className="min-w-0 flex-[2]">User</div>
                <div className="w-24 shrink-0">Role</div>
                <div className="w-24 shrink-0">Status</div>
                <div className="w-36 shrink-0">Joined</div>
                <div className="w-9 shrink-0" />
              </div>
              {filteredMembers.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  {searchQuery.trim()
                    ? "No members match your search."
                    : "No members."}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredMembers.map((member) => (
                    <MemberRow
                      key={member.userId}
                      member={member}
                      currentUserId={data.currentUser.userId}
                      canManageMembers={canManageMembers}
                      canManageOwners={canManageOwners}
                      ownerCount={ownerCount}
                      busy={busyKey?.endsWith(member.userId) ?? false}
                      onRoleChange={(role) => updateRole(member, role)}
                      onRemove={() => removeMember(member)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {invitations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-12 text-center">
                <p className="text-sm text-muted-foreground">
                  No invitations yet.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="flex items-center border-b border-border bg-muted/40 px-5 py-2.5 text-xs font-medium text-muted-foreground">
                  <div className="min-w-0 flex-[2]">Email</div>
                  <div className="w-24 shrink-0">Role</div>
                  <div className="w-24 shrink-0">Status</div>
                  <div className="min-w-0 flex-1">Invited by</div>
                  <div className="w-36 shrink-0" />
                </div>
                <div className="divide-y divide-border">
                  {invitations.map((invitation) => (
                    <InvitationRow
                      key={invitation.id}
                      invitation={invitation}
                      inviteSupported={inviteSupported}
                      busy={busyKey?.endsWith(invitation.id) ?? false}
                      onResend={() => resendInvitation(invitation)}
                      onRevoke={() => revokeInvitation(invitation)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <InviteDialog
        open={inviteOpen}
        inviteSupported={inviteSupported}
        currentRole={data?.currentUser.role ?? "member"}
        email={inviteEmail}
        role={inviteRole}
        saving={busyKey === "invite"}
        onEmailChange={setInviteEmail}
        onRoleChange={setInviteRole}
        onClose={() => setInviteOpen(false)}
        onSubmit={submitInvite}
      />
    </div>
  );
}

function MemberRow({
  member,
  currentUserId,
  canManageMembers,
  canManageOwners,
  ownerCount,
  busy,
  onRoleChange,
  onRemove,
}: {
  member: Member;
  currentUserId: string;
  canManageMembers: boolean;
  canManageOwners: boolean;
  ownerCount: number;
  busy: boolean;
  onRoleChange: (role: WorkspaceRole) => void;
  onRemove: () => void;
}) {
  const isSelf = member.userId === currentUserId;
  const isLastOwner = member.role === "owner" && ownerCount <= 1;
  const canAct =
    canManageMembers &&
    !isSelf &&
    (member.role !== "owner" || canManageOwners) &&
    !isLastOwner;

  return (
    <div className="flex items-center px-5 py-3.5">
      <div className="flex min-w-0 flex-[2] items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
          {(member.displayName || member.email || "?").charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium">
              {member.email || member.userId}
            </span>
            {isSelf ? (
              <span className="shrink-0 text-[11px] text-muted-foreground">(You)</span>
            ) : null}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {member.displayName || "Unknown user"}
          </div>
        </div>
      </div>
      <div className="w-24 shrink-0">
        <Badge variant={roleBadgeVariant(member.role)}>
          {ROLE_LABELS[member.role]}
        </Badge>
      </div>
      <div className="w-24 shrink-0">
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Active
        </span>
      </div>
      <div className="w-36 shrink-0">
        <div className="text-xs">{formatDate(member.createdAt)}</div>
        <div className="text-xs text-muted-foreground">{formatTime(member.createdAt)}</div>
      </div>
      <div className="flex w-9 shrink-0 justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={!canAct || busy}>
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : (
                <MoreHorizontalIcon />
              )}
              <span className="sr-only">Member actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Role</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={member.role}
              onValueChange={(value) => onRoleChange(value as WorkspaceRole)}
            >
              {ROLES.map((role) => {
                const disabled =
                  role === "owner" && !canManageOwners ||
                  member.role === "owner" && role !== "owner" && isLastOwner;
                return (
                  <DropdownMenuRadioItem
                    key={role}
                    value={role}
                    disabled={disabled}
                  >
                    <span>{ROLE_LABELS[role]}</span>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={!canAct}
              onSelect={onRemove}
            >
              <Trash2Icon />
              <span>Remove member</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function InvitationRow({
  invitation,
  inviteSupported,
  busy,
  onResend,
  onRevoke,
}: {
  invitation: Invitation;
  inviteSupported: boolean;
  busy: boolean;
  onResend: () => void;
  onRevoke: () => void;
}) {
  const pending = invitation.status === "pending";

  return (
    <div className="flex items-center px-5 py-3.5">
      <div className="min-w-0 flex-[2] truncate text-xs">
        {invitation.email}
      </div>
      <div className="w-24 shrink-0">
        <Badge variant={roleBadgeVariant(invitation.role)}>
          {ROLE_LABELS[invitation.role]}
        </Badge>
      </div>
      <div className="w-24 shrink-0">
        <Badge variant="outline">{invitation.status}</Badge>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs">{invitation.invitedByUserName}</div>
        <div className="text-xs text-muted-foreground">{formatDate(invitation.createdAt)}</div>
      </div>
      <div className="flex w-36 shrink-0 items-center justify-end gap-1.5">
        {pending ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!inviteSupported || busy}
              onClick={onResend}
            >
              <RotateCwIcon data-icon="inline-start" />
              Resend
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onRevoke}
            >
              <Trash2Icon data-icon="inline-start" />
              Revoke
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function InviteDialog({
  open,
  inviteSupported,
  currentRole,
  email,
  role,
  saving,
  onEmailChange,
  onRoleChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  inviteSupported: boolean;
  currentRole: WorkspaceRole;
  email: string;
  role: WorkspaceRole;
  saving: boolean;
  onEmailChange: (value: string) => void;
  onRoleChange: (value: WorkspaceRole) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>
            Send an invitation and assign a workspace role.
          </DialogDescription>
        </DialogHeader>

        {!inviteSupported ? (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3">
            <ShieldCheckIcon className="mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              This local workspace cannot send real invitations. Seed another
              user locally, then sign in with that email to test member access.
            </p>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="members-invite-email">Email</FieldLabel>
                <Input
                  id="members-invite-email"
                  type="email"
                  value={email}
                  onChange={(event) => onEmailChange(event.target.value)}
                  placeholder="teammate@example.com"
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel>Role</FieldLabel>
                <div className="grid gap-2">
                  {ROLES.map((option) => {
                    const disabled = option === "owner" && currentRole !== "owner";
                    const active = role === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={disabled}
                        onClick={() => onRoleChange(option)}
                        className={cn(
                          "flex items-start gap-3 rounded-lg border border-border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                          active ? "bg-muted" : "hover:bg-muted/50",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-sm font-medium">
                            {ROLE_LABELS[option]}
                          </span>
                          <span className="block text-xs leading-relaxed text-muted-foreground">
                            {ROLE_DESCRIPTIONS[option]}
                          </span>
                        </span>
                        {active ? <CheckIcon className="mt-0.5 shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!email.trim() || saving}>
                {saving ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : null}
                Send invite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function invitationErrorMessage(error?: string, reason?: string): string {
  if (error === "workspace_invitation_already_pending") {
    return "That email already has a pending invitation.";
  }
  if (error === "workspace_member_already_exists") {
    return "That user already belongs to this workspace.";
  }
  if (reason === "local_auth") {
    return "Invitations are not available in local mode.";
  }
  if (reason === "not_configured") {
    return "External invitations are not configured for this deployment.";
  }
  return "Unable to send invitation.";
}
