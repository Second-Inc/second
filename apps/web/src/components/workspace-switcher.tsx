"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  MailPlusIcon,
  Plus,
  Settings2Icon,
  ShieldCheckIcon,
} from "lucide-react";
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { SecondAuthMode } from "@/lib/config";
import type { WorkspaceRole } from "@/lib/db";
import { announceNavigationIntentFromClick } from "@/lib/navigation-intent";
import { cn } from "@/lib/utils";

type WorkspaceSwitcherProps = {
  user: { displayName: string; email: string };
  authMode: SecondAuthMode;
  workspaces: Array<{ _id: string; name: string; role: WorkspaceRole }>;
  activeWorkspaceId: string;
  activeRole: WorkspaceRole;
  activeMemberCount: number;
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

const INVITABLE_ROLES: WorkspaceRole[] = ["member", "admin", "owner"];

function canInvite(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

function canInviteRole(activeRole: WorkspaceRole, role: WorkspaceRole): boolean {
  if (role === "owner") return activeRole === "owner";
  return canInvite(activeRole);
}

export function WorkspaceSwitcher({
  user,
  authMode,
  workspaces,
  activeWorkspaceId,
  activeRole,
  activeMemberCount,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [inviteState, setInviteState] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "success" }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const activeWorkspace = workspaces.find((w) => w._id === activeWorkspaceId);
  const inviteAllowed = canInvite(activeRole);
  const inviteSupported = authMode !== "none";
  const memberLabel =
    activeMemberCount === 1 ? "1 member" : `${activeMemberCount} members`;
  const submitInvite = async () => {
    if (!inviteAllowed || !inviteSupported || !inviteEmail.trim()) return;

    setInviteState({ status: "saving" });
    try {
      const response = await fetch(
        `/api/workspaces/${activeWorkspaceId}/invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: inviteEmail,
            role: inviteRole,
          }),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          reason?: string;
        } | null;
        const message =
          data?.error === "workspace_invitation_already_pending"
            ? "That email already has a pending invitation."
            : data?.error === "workspace_member_already_exists"
              ? "That user already belongs to this workspace."
              : data?.reason === "not_configured"
                ? "External invitations are not configured for this deployment."
                : "Unable to send invitation.";
        setInviteState({ status: "error", message });
        return;
      }

      setInviteState({ status: "success" });
      setInviteEmail("");
      router.refresh();
    } catch {
      setInviteState({
        status: "error",
        message: "Unable to send invitation.",
      });
    }
  };

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu
            onOpenChange={(open) => {
              if (!open) setShowCreateForm(false);
            }}
          >
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="px-1 data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              >
                <div className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-gradient-to-br from-blue-200/90 via-emerald-200/70 to-orange-200/90 text-xs font-semibold text-black/60 dark:from-blue-700/50 dark:via-emerald-700/40 dark:to-orange-700/50 dark:text-white/60 after:pointer-events-none after:absolute after:inset-0 after:mix-blend-overlay after:opacity-80 after:[background-image:url(&quot;data:image/svg+xml,%3Csvg%20viewBox='0%200%20512%20512'%20xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter%20id='n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='1.2'%20numOctaves='4'%20stitchTiles='stitch'/%3E%3C/filter%3E%3Crect%20width='100%25'%20height='100%25'%20filter='url(%23n)'/%3E%3C/svg%3E&quot;)]">
                  <span className="relative">{activeWorkspace?.name.charAt(0).toUpperCase() ?? "?"}</span>
                </div>
                <div className="grid flex-1 text-left text-xs leading-tight">
                  <span className="truncate font-medium">
                    {activeWorkspace?.name ?? "Select workspace"}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {ROLE_LABELS[activeRole]} · {memberLabel}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-80 p-0"
              align="start"
              alignOffset={isMobile ? 0 : -6}
              collisionPadding={12}
              side={isMobile ? "bottom" : "right"}
              sideOffset={isMobile ? 4 : 6}
            >
              <div className="px-3 pt-3 pb-2">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-gradient-to-br from-blue-200/90 via-emerald-200/70 to-orange-200/90 text-sm font-semibold text-black/60 dark:from-blue-700/50 dark:via-emerald-700/40 dark:to-orange-700/50 dark:text-white/60 after:pointer-events-none after:absolute after:inset-0 after:mix-blend-overlay after:opacity-80 after:[background-image:url(&quot;data:image/svg+xml,%3Csvg%20viewBox='0%200%20512%20512'%20xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter%20id='n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='1.2'%20numOctaves='4'%20stitchTiles='stitch'/%3E%3C/filter%3E%3Crect%20width='100%25'%20height='100%25'%20filter='url(%23n)'/%3E%3C/svg%3E&quot;)]">
                    <span className="relative">{activeWorkspace?.name.charAt(0).toUpperCase() ?? "?"}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {activeWorkspace?.name ?? "Select workspace"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {ROLE_LABELS[activeRole]} · {memberLabel}
                    </div>
                  </div>
                </div>
              </div>

              <DropdownMenuSeparator className="my-0" />

              <DropdownMenuGroup className="p-1">
                <DropdownMenuItem asChild>
                  <Link
                    href={`/w/${activeWorkspaceId}/settings/members`}
                    onClick={announceNavigationIntentFromClick}
                  >
                    <Settings2Icon />
                    <span>Settings</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!inviteAllowed}
                  onSelect={(event) => {
                    event.preventDefault();
                    if (inviteAllowed) {
                      setInviteState({ status: "idle" });
                      setInviteOpen(true);
                    }
                  }}
                >
                  <MailPlusIcon />
                  <span>Invite</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator className="my-0" />

              <DropdownMenuGroup className="p-1">
                <DropdownMenuLabel className="flex flex-col">
                  <span className="text-xs font-medium text-foreground">{user.displayName}</span>
                  <span className="truncate text-[11px] font-normal">
                    {user.email}
                  </span>
                </DropdownMenuLabel>
                {workspaces.map((workspace) => (
                  <DropdownMenuItem key={workspace._id} asChild>
                    <Link
                      href={`/w/${workspace._id}`}
                      onClick={announceNavigationIntentFromClick}
                      className="cursor-pointer"
                    >
                      <div className="flex size-5 shrink-0 items-center justify-center rounded border text-[0.625rem] font-semibold">
                        {workspace.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="min-w-0 flex-1 truncate">
                        {workspace.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {ROLE_LABELS[workspace.role]}
                      </span>
                      {workspace._id === activeWorkspaceId ? <Check /> : null}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>

              <DropdownMenuSeparator className="my-0" />

              <div className="p-1">
                {showCreateForm ? (
                  <form
                    action="/api/workspaces"
                    method="post"
                    className="flex flex-col gap-2 p-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Input
                      name="workspaceName"
                      required
                      minLength={2}
                      maxLength={80}
                      placeholder="Workspace name"
                      autoFocus
                      className="h-7 text-xs"
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    <Button type="submit" size="sm" className="w-full">
                      Create
                    </Button>
                  </form>
                ) : (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setShowCreateForm(true);
                    }}
                  >
                    <Plus />
                    <span>New workspace</span>
                  </DropdownMenuItem>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-md">
          {/* Banner */}
          <div className="flex items-center justify-center px-8 py-10 bg-gradient-to-br from-orange-50 via-rose-50 to-violet-50 dark:from-orange-950/30 dark:via-rose-950/20 dark:to-violet-950/30">
            <div className="flex size-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/[0.06] dark:bg-white/10 dark:ring-white/10">
              <MailPlusIcon className="size-6 text-muted-foreground" />
            </div>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">Invite members</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Add a person to {activeWorkspace?.name ?? "this workspace"} with a
                predefined role.
              </DialogDescription>
            </DialogHeader>

            {!inviteSupported ? (
              <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3">
                <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  This workspace is running in local mode, so real invitations are
                  not available.
                </p>
              </div>
            ) : (
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitInvite();
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="workspace-invite-email">Email</FieldLabel>
                    <Input
                      id="workspace-invite-email"
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="teammate@example.com"
                      autoFocus
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Role</FieldLabel>
                    <div className="grid gap-2">
                      {INVITABLE_ROLES.map((role) => {
                        const disabled = !canInviteRole(activeRole, role);
                        const active = inviteRole === role;
                        return (
                          <button
                            key={role}
                            type="button"
                            disabled={disabled}
                            onClick={() => setInviteRole(role)}
                            className={cn(
                              "flex items-start gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                              active ? "bg-muted" : "hover:bg-muted/50",
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">
                                {ROLE_LABELS[role]}
                              </span>
                              <span className="block text-xs leading-relaxed text-muted-foreground">
                                {ROLE_DESCRIPTIONS[role]}
                              </span>
                            </span>
                            {active ? <Check className="mt-0.5 shrink-0" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </FieldGroup>

                {inviteState.status === "error" ? (
                  <p className="text-xs text-destructive">{inviteState.message}</p>
                ) : null}
                {inviteState.status === "success" ? (
                  <p className="text-xs text-muted-foreground">
                    Invitation sent.
                  </p>
                ) : null}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setInviteOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!inviteEmail.trim() || inviteState.status === "saving"}
                  >
                    {inviteState.status === "saving" ? (
                      <Loader2 data-icon="inline-start" className="animate-spin" />
                    ) : null}
                    Send invite
                  </Button>
                </DialogFooter>
              </form>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
