"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Loader2,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
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
  isAbortError,
  subscribeNavigationIntent,
} from "@/lib/navigation-intent";
import type { TeamsSettingsReadModel } from "@/lib/workspace-settings/read-models";

type Team = {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
};

type TeamMember = {
  userId: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
  teamIds: string[];
};

type TeamsResponse = TeamsSettingsReadModel;

type InFlightFetch = {
  promise: Promise<void>;
  signal?: AbortSignal;
};

function hasPermission(
  data: TeamsResponse | null,
  permission: WorkspacePermission,
): boolean {
  return data?.currentUser.permissions.includes(permission) ?? false;
}

export default function TeamsClient({
  initialData,
}: {
  initialData: TeamsResponse | null;
}) {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const [data, setData] = useState<TeamsResponse | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [createOpen, setCreateOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [manageTeam, setManageTeam] = useState<Team | null>(null);
  const [renameTeam, setRenameTeam] = useState<Team | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const fetchTeamsInFlightRef = useRef<InFlightFetch | null>(null);

  const canManage = hasPermission(data, "members:manage");

  const filteredTeams = useMemo(() => {
    if (!data?.teams) return [];
    if (!searchQuery.trim()) return data.teams;
    const q = searchQuery.toLowerCase();
    return data.teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q),
    );
  }, [data?.teams, searchQuery]);

  const fetchTeams = useCallback(async (options?: {
    force?: boolean;
    showLoading?: boolean;
    signal?: AbortSignal;
  }) => {
    const inFlight = fetchTeamsInFlightRef.current;
    if (!options?.force && inFlight && !inFlight.signal?.aborted) {
      return inFlight.promise;
    }

    const showLoading = options?.showLoading ?? true;
    const run = (async () => {
      if (showLoading) setLoading(true);
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/teams`, {
          cache: "no-store",
          signal: options?.signal,
        });
        if (options?.signal?.aborted) return;
        if (!response.ok) return;
        const nextData = (await response.json()) as TeamsResponse;
        if (options?.signal?.aborted) return;
        setData(nextData);
      } catch (error) {
        if (options?.signal?.aborted || isAbortError(error)) return;
        // Best effort refresh. Mutations still update local state when possible.
      } finally {
        if (showLoading && !options?.signal?.aborted) setLoading(false);
      }
    })();

    fetchTeamsInFlightRef.current = {
      promise: run,
      signal: options?.signal,
    };
    try {
      await run;
    } finally {
      if (fetchTeamsInFlightRef.current?.promise === run) {
        fetchTeamsInFlightRef.current = null;
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    const unsubscribeNavigation = subscribeNavigationIntent(() => {
      abortForNavigation(controller);
    });
    void fetchTeams({ signal: controller.signal });
    return () => {
      unsubscribeNavigation();
      abortForNavigation(controller, "Teams settings unmounted.");
    };
  }, [fetchTeams, initialData]);

  useWorkspaceRealtimeEvent(useCallback((event) => {
    if (
      event.workspaceId !== workspaceId ||
      (event.scope !== "memberships" &&
        event.scope !== "team-memberships")
    ) {
      return;
    }
    void fetchTeams({ showLoading: false });
  }, [fetchTeams, workspaceId]));

  const createTeam = async () => {
    const name = teamName.trim();
    if (!name || !canManage) return;
    setBusyKey("create");
    setMessage(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        setMessage("Unable to create that team.");
        return;
      }
      setCreateOpen(false);
      setTeamName("");
      await fetchTeams({ force: true });
    } finally {
      setBusyKey(null);
    }
  };

  const saveRename = async () => {
    if (!renameTeam || !renameValue.trim() || !canManage) return;
    setBusyKey(`rename:${renameTeam.id}`);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/teams/${renameTeam.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: renameValue.trim() }),
        },
      );
      if (!response.ok) {
        setMessage("Unable to rename that team.");
        return;
      }
      setRenameTeam(null);
      await fetchTeams({ force: true });
    } finally {
      setBusyKey(null);
    }
  };

  const deleteTeam = async (team: Team) => {
    if (!canManage || team.isDefault) return;
    setBusyKey(`delete:${team.id}`);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/teams/${team.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setMessage("Unable to delete that team.");
        return;
      }
      await fetchTeams({ force: true });
    } finally {
      setBusyKey(null);
    }
  };

  const updateMembership = async (
    team: Team,
    member: TeamMember,
    nextSelected: boolean,
  ) => {
    if (!canManage || team.isDefault) return;
    setBusyKey(`member:${team.id}:${member.userId}`);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/teams/${team.id}/members/${member.userId}`,
        { method: nextSelected ? "PUT" : "DELETE" },
      );
      if (!response.ok) {
        setMessage("Unable to update team membership.");
        return;
      }
      await fetchTeams({ force: true });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
        <div>
          <h1 className="text-lg font-semibold">Teams</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Organize members into teams for app publishing and visibility.
          </p>
        </div>

        {message ? (
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            {message}
          </p>
        ) : null}

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
          {canManage ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              <PlusIcon data-icon="inline-start" />
              Add team
            </Button>
          ) : (
            <Badge variant="outline">Admin or owner required</Badge>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : data ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center border-b border-border bg-muted/40 px-5 py-2.5 text-xs font-medium text-muted-foreground">
              <div className="min-w-0 flex-[2]">Name</div>
              <div className="w-28 shrink-0">Members</div>
              <div className="w-28 shrink-0" />
            </div>
            {filteredTeams.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                {searchQuery.trim() ? "No teams match your search." : "No teams found"}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredTeams.map((team) => (
                  <TeamRow
                    key={team.id}
                    team={team}
                    members={data.members}
                    canManage={canManage}
                    busy={busyKey?.includes(team.id) ?? false}
                    onManage={() => setManageTeam(team)}
                    onRename={() => {
                      setRenameTeam(team);
                      setRenameValue(team.name);
                    }}
                    onDelete={() => deleteTeam(team)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a new team</DialogTitle>
            <DialogDescription>
              Teams are used when publishing apps to control visibility.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createTeam();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="team-name">Team name</FieldLabel>
                <Input
                  id="team-name"
                  autoFocus
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  placeholder="e.g. Sales ops"
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!teamName.trim() || busyKey === "create"}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameTeam} onOpenChange={(open) => !open && setRenameTeam(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename team</DialogTitle>
            <DialogDescription>Update the team name shown in publish flows.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveRename();
            }}
          >
            <Input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              placeholder="Team name"
            />
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setRenameTeam(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!renameValue.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ManageMembersDialog
        team={manageTeam}
        members={data?.members ?? []}
        busyKey={busyKey}
        onClose={() => setManageTeam(null)}
        onToggle={updateMembership}
      />
    </div>
  );
}

function TeamRow({
  team,
  members,
  canManage,
  busy,
  onManage,
  onRename,
  onDelete,
}: {
  team: Team;
  members: TeamMember[];
  canManage: boolean;
  busy: boolean;
  onManage: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const teamMembers = useMemo(
    () => members.filter((member) => member.teamIds.includes(team.id)),
    [members, team.id],
  );

  return (
    <div className="flex items-center px-5 py-3.5">
      <div className="min-w-0 flex-[2]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{team.name}</span>
          {team.isDefault ? <Badge variant="outline">Default</Badge> : null}
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {team.slug}
        </span>
      </div>
      <div className="w-28 shrink-0 text-sm text-muted-foreground">
        {teamMembers.length} {teamMembers.length === 1 ? "member" : "members"}
      </div>
      <div className="flex w-28 shrink-0 items-center justify-end gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canManage || team.isDefault}
          onClick={onManage}
        >
          Manage
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={!canManage || team.isDefault || busy}
              aria-label="Team actions"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ManageMembersDialog({
  team,
  members,
  busyKey,
  onClose,
  onToggle,
}: {
  team: Team | null;
  members: TeamMember[];
  busyKey: string | null;
  onClose: () => void;
  onToggle: (team: Team, member: TeamMember, nextSelected: boolean) => void;
}) {
  const [memberSearch, setMemberSearch] = useState("");

  const currentMembers = useMemo(
    () => (team ? members.filter((m) => m.teamIds.includes(team.id)) : []),
    [members, team],
  );

  const filteredSuggestions = useMemo(() => {
    if (!team || !memberSearch.trim()) return [];
    const q = memberSearch.toLowerCase();
    return members.filter(
      (m) =>
        !m.teamIds.includes(team.id) &&
        (m.displayName.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q)),
    );
  }, [members, team, memberSearch]);

  return (
    <Dialog
      open={!!team}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setMemberSearch("");
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage {team?.name} members</DialogTitle>
          <DialogDescription>
            Add or remove workspace members from this team.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <FieldLabel>Team members</FieldLabel>
          <div className="rounded-lg border border-border focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
            {currentMembers.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
                {currentMembers.map((member) => {
                  const busy = team
                    ? busyKey === `member:${team.id}:${member.userId}`
                    : false;
                  return (
                    <span
                      key={member.userId}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs"
                    >
                      {member.displayName}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => team && onToggle(team, member, false)}
                        className="rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}
            <input
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder={currentMembers.length > 0 ? "Add members..." : "Search members to add..."}
              className="w-full bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {memberSearch.trim() ? (
            <div className="max-h-48 overflow-auto rounded-lg border border-border">
              {filteredSuggestions.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  No matching users
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredSuggestions.map((member) => {
                    const busy = team
                      ? busyKey === `member:${team.id}:${member.userId}`
                      : false;
                    return (
                      <button
                        key={member.userId}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (team) {
                            onToggle(team, member, true);
                            setMemberSearch("");
                          }
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 disabled:opacity-60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {member.displayName}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {member.email}
                          </span>
                        </span>
                        <Badge variant="outline">{member.role}</Badge>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onClose();
              setMemberSearch("");
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
