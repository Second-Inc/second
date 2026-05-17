"use client";

import { useEffect, useMemo, useState } from "react";
import {
  KeyRoundIcon,
  MessageSquareWarningIcon,
  RocketIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  UsersRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import type {
  AppPublishStatus,
  IntegrationPermissionGroup,
  IntegrationSecretRequirement,
  WorkspaceRole,
} from "@/lib/db/types";
import type { SecondAuthMode } from "@/lib/config";
import { cn } from "@/lib/utils";

type PublishTeam = {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
};

type PublishIntegration = {
  id: string;
  name: string;
  domain: string;
  keySlug?: string;
  keyName?: string;
  capabilityLabel?: string;
  faviconUrl: string;
  configured: boolean;
  needsSetup: boolean;
  permissionGroups: IntegrationPermissionGroup[];
  secretRequirements: IntegrationSecretRequirement[];
};

type AppPublishDialogProps = {
  workspaceId: string;
  appId: string;
  authMode: SecondAuthMode;
  currentUserRole: WorkspaceRole;
  canManageApp: boolean;
  publishStatus: AppPublishStatus;
  hasPublishedVersion?: boolean;
  hasDraftChanges?: boolean;
  changeRequestMessage?: string | null;
  appTeamIds: string[];
  teams: PublishTeam[];
  integrations: PublishIntegration[];
  onSubmitted?: () => void;
};

type PublishDialogTab = "sharing" | "changes";

function statusLabel(status: AppPublishStatus): string {
  if (status === "published") return "Published";
  if (status === "review_requested") return "In review";
  if (status === "changes_requested") return "Changes requested";
  return "Draft";
}

function statusVariant(status: AppPublishStatus): "default" | "secondary" | "outline" {
  if (status === "published") return "default";
  if (status === "review_requested") return "secondary";
  return "outline";
}

export function AppPublishStatusBadge({
  status,
  hasPublishedVersion = false,
  hasDraftChanges = false,
}: {
  status: AppPublishStatus;
  hasPublishedVersion?: boolean;
  hasDraftChanges?: boolean;
}) {
  const label =
    status === "draft" && hasPublishedVersion && hasDraftChanges
      ? "Draft changes"
      : statusLabel(status);
  return <Badge variant={statusVariant(status)}>{label}</Badge>;
}

export function AppPublishDialog({
  workspaceId,
  appId,
  authMode,
  currentUserRole,
  canManageApp,
  publishStatus,
  hasPublishedVersion = false,
  hasDraftChanges = false,
  changeRequestMessage,
  appTeamIds,
  teams,
  integrations,
  onSubmitted,
}: AppPublishDialogProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PublishDialogTab>("sharing");
  const [savingMode, setSavingMode] = useState<"publish" | "request" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultTeamId = teams.find((team) => team.isDefault)?.id ?? teams[0]?.id;
  const initialTeamIds = useMemo(
    () => (appTeamIds.length > 0 ? appTeamIds : defaultTeamId ? [defaultTeamId] : []),
    [appTeamIds, defaultTeamId],
  );
  const [selectedTeamIds, setSelectedTeamIds] = useState(initialTeamIds);

  const localMode = authMode === "none";
  const reviewer = currentUserRole === "owner" || currentUserRole === "admin";
  const setupNeeded = integrations.some((integration) => integration.needsSetup);
  const canSubmit = selectedTeamIds.length > 0 && !savingMode;
  const hasChangeRequest =
    publishStatus === "changes_requested" && Boolean(changeRequestMessage?.trim());

  useEffect(() => {
    if (open && hasChangeRequest) {
      setActiveTab("changes");
    }
  }, [hasChangeRequest, open]);

  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds((current) => {
      if (current.includes(teamId)) {
        return current.filter((id) => id !== teamId);
      }
      return [...current, teamId];
    });
  };

  const submit = async (mode: "publish" | "request") => {
    if (!canSubmit) return;
    setSavingMode(mode);
    setError(null);

    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/apps/${appId}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamIds: selectedTeamIds, mode }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(
          body?.error === "integrations_setup_required"
            ? "Configure the requested integrations before publishing."
            : body?.error === "invalid_agents_json"
              ? "Fix agents.json before publishing."
            : "Unable to update publishing status.",
        );
        return;
      }

      setOpen(false);
      onSubmitted?.();
    } finally {
      setSavingMode(null);
    }
  };

  if (!canManageApp) {
    return (
      <AppPublishStatusBadge
        status={publishStatus}
        hasPublishedVersion={hasPublishedVersion}
        hasDraftChanges={hasDraftChanges}
      />
    );
  }

  const buttonLabel =
    publishStatus === "published" && !hasDraftChanges
      ? "Sharing"
      : hasPublishedVersion
        ? "Publish draft"
        : "Publish";

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 rounded-full px-2.5 text-xs"
            onClick={() => {
              setSelectedTeamIds(initialTeamIds);
              setActiveTab(hasChangeRequest ? "changes" : "sharing");
              setError(null);
              setOpen(true);
            }}
          >
            <RocketIcon data-icon="inline-start" />
            {buttonLabel}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Publish your app and request a review
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Publish app</DialogTitle>
          </DialogHeader>

          <div className="mt-3 flex flex-col gap-5">
            {hasChangeRequest ? (
              <div
                className="inline-flex w-fit rounded-md border border-border bg-muted/30 p-0.5"
                role="tablist"
                aria-label="Publish dialog sections"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "changes"}
                  className={cn(
                    "h-7 rounded px-2.5 text-xs transition-colors",
                    activeTab === "changes"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setActiveTab("changes")}
                >
                  Requested changes
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "sharing"}
                  className={cn(
                    "h-7 rounded px-2.5 text-xs transition-colors",
                    activeTab === "sharing"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setActiveTab("sharing")}
                >
                  Sharing
                </button>
              </div>
            ) : null}

            {hasChangeRequest && activeTab === "changes" ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-amber-900 dark:text-amber-200">
                <MessageSquareWarningIcon className="mt-0.5 size-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">Changes requested</div>
                  <p className="mt-0.5 text-xs leading-relaxed">
                    {changeRequestMessage}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed">
                    Make the requested update, then review the sharing settings and send it back for review.
                  </p>
                </div>
              </div>
            ) : null}

            {activeTab === "sharing" && localMode && reviewer ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-amber-900 dark:text-amber-200">
                <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">Local mode</div>
                  <p className="mt-0.5 text-xs leading-relaxed">
                    There is no need for an app review step in local mode. You are the owner and only user, so you can publish the app now. If you would like to experience the app review and approval flow, create a review task for this app.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 border-amber-500/30 bg-background/50"
                    disabled={!canSubmit}
                    onClick={() => submit("request")}
                  >
                    {savingMode === "request" ? "Creating..." : "Create review task"}
                  </Button>
                </div>
              </div>
            ) : activeTab === "sharing" && reviewer ? (
              <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">
                    {currentUserRole === "owner"
                      ? "You are the workspace owner."
                      : "You can review apps for this workspace."}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Confirm the app behavior, team access, and integrations before publishing.
                  </p>
                </div>
              </div>
            ) : activeTab === "sharing" ? (
              <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Publishing requires review from a workspace admin or owner. This will create a review task for them.
                </p>
              </div>
            ) : null}

            {activeTab === "sharing" ? (
              <>
                <section className="flex flex-col gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <UsersRoundIcon className="size-3.5 text-muted-foreground" />
                      Share with teams
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      Only members of these teams will see the published app. Admins and owners can always review it.
                    </p>
                  </div>
                  <SearchableMultiSelect
                    items={teams.map((team) => ({
                      id: team.id,
                      label: team.name,
                      description: team.slug,
                      searchText: `${team.name} ${team.slug}`,
                    }))}
                    selectedIds={selectedTeamIds}
                    onToggle={toggleTeam}
                    placeholder="Select teams"
                    searchPlaceholder="Search teams"
                    emptyMessage="No matching teams."
                    groupLabel="Teams"
                    itemNoun="team"
                  />
                </section>

                <section className="flex flex-col gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <KeyRoundIcon className="size-3.5 text-muted-foreground" />
                      Requested tools and integrations
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      These are the external services, permissions, scopes, and secrets this app is asking to use.
                    </p>
                  </div>
                  {integrations.length === 0 ? (
                    <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      No external tools or integrations requested.
                    </div>
                  ) : (
                    <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
                      {integrations.map((integration) => (
                        <div
                          key={integration.id}
                          className="flex items-start gap-3 px-3 py-2.5"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={integration.faviconUrl}
                            alt=""
                            width={18}
                            height={18}
                            className="mt-0.5 size-4 rounded-sm"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium">
                                {integration.capabilityLabel ?? integration.name}
                              </span>
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {integration.domain}
                                {integration.keySlug ? ` / ${integration.keySlug}` : ""}
                              </span>
                              <Badge variant={integration.needsSetup ? "outline" : "secondary"}>
                                {integration.needsSetup ? "Setup needed" : "Configured"}
                              </Badge>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {integration.permissionGroups.flatMap((group) =>
                                group.permissions.map((permission) => (
                                  <Badge
                                    key={`${group.name}:${permission}`}
                                    variant="outline"
                                    className="font-mono"
                                  >
                                    {permission}
                                  </Badge>
                                )),
                              )}
                              {integration.secretRequirements.map((secret) => (
                                <Badge
                                  key={secret.name}
                                  variant="outline"
                                  className="font-mono"
                                >
                                  {secret.name}
                                </Badge>
                              ))}
                              {integration.permissionGroups.length === 0 &&
                              integration.secretRequirements.length === 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  No permissions, scopes, or secrets listed.
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            ) : null}

            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
            {!localMode && reviewer && setupNeeded ? (
              <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                Configure the requested integrations before publishing.
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
            {activeTab === "changes" ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setActiveTab("sharing")}
              >
                Review sharing
              </Button>
            ) : localMode && reviewer ? (
              <Button
                type="button"
                size="sm"
                disabled={!canSubmit}
                onClick={() => submit("publish")}
              >
                {savingMode === "publish" ? "Publishing..." : "Publish"}
              </Button>
            ) : reviewer ? (
              <Button
                type="button"
                size="sm"
                disabled={!canSubmit || setupNeeded}
                onClick={() => submit("publish")}
              >
                {savingMode === "publish" ? "Publishing..." : "Publish"}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={!canSubmit}
                onClick={() => submit("request")}
              >
                {savingMode === "request" ? "Sending..." : "Request review"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
