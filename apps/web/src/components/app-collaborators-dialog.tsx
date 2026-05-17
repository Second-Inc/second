"use client";

import { useEffect, useMemo, useState } from "react";
import { UserPlusIcon } from "lucide-react";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SearchableMultiSelect } from "@/components/searchable-multi-select";
import type { WorkspaceRole } from "@/lib/db/types";
import { cn } from "@/lib/utils";

type WorkspaceMember = {
  userId: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
};

type AppCollaboratorsDialogProps = {
  workspaceId: string;
  appId: string;
  creatorUserId: string;
  collaboratorUserIds: string[];
  canManageCollaborators: boolean;
  showLabel?: boolean;
};

function roleLabel(role: WorkspaceRole): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

export function AppCollaboratorsDialog({
  workspaceId,
  appId,
  creatorUserId,
  collaboratorUserIds,
  canManageCollaborators,
  showLabel = false,
}: AppCollaboratorsDialogProps) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [selectedIds, setSelectedIds] = useState(collaboratorUserIds);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedIds(collaboratorUserIds);
    }
  }, [collaboratorUserIds, open]);

  useEffect(() => {
    if (!open || !canManageCollaborators) return;

    let cancelled = false;
    const loadMembers = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/workspaces/${workspaceId}/apps/${appId}/collaborators`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          setError("Unable to load workspace members.");
          return;
        }
        const body = (await response.json()) as { members?: WorkspaceMember[] };
        if (!cancelled) setMembers(body.members ?? []);
      } catch {
        if (!cancelled) setError("Unable to load workspace members.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadMembers();

    return () => {
      cancelled = true;
    };
  }, [appId, canManageCollaborators, open, workspaceId]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const originalSet = useMemo(
    () => new Set(collaboratorUserIds),
    [collaboratorUserIds],
  );
  const addedCount = useMemo(
    () => selectedIds.filter((id) => !originalSet.has(id)).length,
    [originalSet, selectedIds],
  );
  const removedCount = useMemo(
    () => collaboratorUserIds.filter((id) => !selectedSet.has(id)).length,
    [collaboratorUserIds, selectedSet],
  );
  const hasChanges = addedCount > 0 || removedCount > 0;
  const actionLabel = removedCount > 0
    ? "Save"
    : addedCount > 0
      ? `Invite (${addedCount})`
      : "Invite";
  const selectableMembers = useMemo(
    () =>
      members.filter((member) => member.userId !== creatorUserId),
    [creatorUserId, members],
  );
  const toggleMember = (userId: string) => {
    setSelectedIds((current) => {
      if (current.includes(userId)) {
        return current.filter((id) => id !== userId);
      }
      return [...current, userId];
    });
  };

  const save = async () => {
    if (!canManageCollaborators) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/apps/${appId}/collaborators`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collaboratorUserIds: selectedIds }),
        },
      );

      if (!response.ok) {
        setError("Unable to update collaborators.");
        return;
      }

      const body = (await response.json()) as { collaboratorUserIds: string[] };
      setSelectedIds(body.collaboratorUserIds);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={showLabel ? "sm" : "icon-sm"}
            className={cn(
              "rounded-full text-muted-foreground",
              showLabel ? "h-8 px-2.5 text-xs" : "",
            )}
            disabled={!canManageCollaborators}
            onClick={() => setOpen(true)}
            aria-label="Invite collaborators"
          >
            <UserPlusIcon className="size-3.5" strokeWidth={1.5} />
            {showLabel ? <span>Invite</span> : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Invite collaborators</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>App collaborators</DialogTitle>
            <DialogDescription className="mt-2 mb-3 text-sm leading-relaxed">
              Collaborators can open this private thread and continue building and chatting.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Workspace members</span>
              <Badge variant="outline">
                {selectedIds.length} collaborator{selectedIds.length === 1 ? "" : "s"}
              </Badge>
            </div>

            {loading ? (
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Loading members...
              </div>
            ) : selectableMembers.length === 0 ? (
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                No other workspace members are available yet.
              </div>
            ) : (
              <SearchableMultiSelect
                items={selectableMembers.map((member) => ({
                  id: member.userId,
                  label: member.displayName,
                  description: member.email,
                  badge: roleLabel(member.role),
                  searchText: `${member.displayName} ${member.email} ${roleLabel(member.role)}`,
                }))}
                selectedIds={selectedIds}
                onToggle={toggleMember}
                placeholder="Select collaborators"
                searchPlaceholder="Search members"
                emptyMessage="No matching members."
                groupLabel="Workspace members"
                itemNoun="member"
              />
            )}

            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || loading || !hasChanges}
              onClick={save}
            >
              {saving ? "Saving..." : actionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
