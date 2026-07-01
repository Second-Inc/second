"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  Bot,
  ChevronDownIcon,
  HammerIcon,
  Inbox,
  MessageCircle,
  MoreHorizontal,
  PackageOpenIcon,
  Pencil,
  Plus,
  Trash2,
  CornerDownLeft,
} from "lucide-react";
import { AppLoader } from "@/components/app-loader";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { SecondLogo } from "@/components/second-logo";
import { UserMenu } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SecondAuthMode } from "@/lib/config";
import type { AppPublishStatus, WorkspaceRole } from "@/lib/db";
import { announceNavigationIntentFromClick } from "@/lib/navigation-intent";
import { captureAnalyticsEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { useWorkspaceRealtimeEvent } from "@/components/workspace-realtime-provider";

type SidebarApp = {
  _id: string;
  name: string;
  runStatus: "pending" | "streaming" | "completed" | "failed" | null;
  toolRecoveryStatus: "fixing" | null;
  publishStatus: AppPublishStatus;
  hasPublishedVersion: boolean;
  canManage: boolean;
};

type SidebarRunStatus = NonNullable<SidebarApp["runStatus"]>;
type SidebarToolRecoveryStatus = NonNullable<SidebarApp["toolRecoveryStatus"]>;

type WorkspaceSidebarProps = {
  user: { displayName: string; email: string };
  authMode: SecondAuthMode;
  workspaces: Array<{ _id: string; name: string; role: WorkspaceRole }>;
  activeWorkspaceId: string;
  activeRole: WorkspaceRole;
  activeMemberCount: number;
  pendingReviewCount: number;
  showAvailableApps: boolean;
  apps: SidebarApp[];
};

function isSidebarRunStatus(value: unknown): value is SidebarRunStatus {
  return (
    value === "pending" ||
    value === "streaming" ||
    value === "completed" ||
    value === "failed"
  );
}

function sidebarRunStatusMap(apps: SidebarApp[]): Record<string, SidebarRunStatus> {
  return Object.fromEntries(
    apps.flatMap((app) =>
      isSidebarRunStatus(app.runStatus) ? [[app._id, app.runStatus]] : [],
    ),
  );
}

function sidebarToolRecoveryStatusMap(
  apps: SidebarApp[],
): Record<string, SidebarToolRecoveryStatus> {
  return Object.fromEntries(
    apps.flatMap((app) =>
      app.toolRecoveryStatus === "fixing" ? [[app._id, app.toolRecoveryStatus]] : [],
    ),
  );
}

function parseRunStatusMap(
  statuses: Record<string, string> | undefined,
): Record<string, SidebarRunStatus> {
  if (!statuses) return {};
  return Object.fromEntries(
    Object.entries(statuses).filter((entry): entry is [string, SidebarRunStatus] =>
      isSidebarRunStatus(entry[1]),
    ),
  );
}

function parseToolRecoveryStatusMap(
  statuses: Record<string, string | null> | undefined,
): Record<string, SidebarToolRecoveryStatus> {
  if (!statuses) return {};
  return Object.fromEntries(
    Object.entries(statuses).filter(
      (entry): entry is [string, SidebarToolRecoveryStatus] =>
        entry[1] === "fixing",
    ),
  );
}

export function WorkspaceSidebar({
  user,
  authMode,
  workspaces,
  activeWorkspaceId,
  activeRole,
  activeMemberCount,
  pendingReviewCount,
  showAvailableApps,
  apps,
}: WorkspaceSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [renameApp, setRenameApp] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteApp, setDeleteApp] = useState<{ id: string; name: string } | null>(null);
  const [draftsOpen, setDraftsOpen] = useState(true);
  const [appsOpen, setAppsOpen] = useState(() =>
    apps.some((app) => app.hasPublishedVersion),
  );
  const [sidebarApps, setSidebarApps] = useState<SidebarApp[]>(apps);
  const [liveMemberCount, setLiveMemberCount] = useState(activeMemberCount);
  const [livePendingReviewCount, setLivePendingReviewCount] =
    useState(pendingReviewCount);
  const [adminTaskSpotlightDismissed, setAdminTaskSpotlightDismissed] =
    useState(true);
  const sidebarRefreshTimerRef = useRef<number | null>(null);
  const previousPublishedAppCountRef = useRef(
    apps.filter((app) => app.hasPublishedVersion).length,
  );
  const [runStatuses, setRunStatuses] = useState<Record<string, SidebarRunStatus>>(
    () => sidebarRunStatusMap(apps),
  );
  const [toolRecoveryStatuses, setToolRecoveryStatuses] = useState<
    Record<string, SidebarToolRecoveryStatus>
  >(() => sidebarToolRecoveryStatusMap(apps));
  const [optimisticApps, setOptimisticApps] = useState<SidebarApp[]>([]);
  const appItems = useMemo(
    () => {
      const persistedIds = new Set(sidebarApps.map((app) => app._id));
      const mergedApps = [
        ...optimisticApps.filter((app) => !persistedIds.has(app._id)),
        ...sidebarApps,
      ];

      return mergedApps.map((app) => ({
        ...app,
        runStatus: runStatuses[app._id] ?? app.runStatus,
        toolRecoveryStatus:
          toolRecoveryStatuses[app._id] ?? app.toolRecoveryStatus ?? null,
      }));
    },
    [optimisticApps, runStatuses, sidebarApps, toolRecoveryStatuses],
  );
  const draftApps = appItems.filter((app) => !app.hasPublishedVersion);
  const publishedApps = appItems.filter((app) => app.hasPublishedVersion);
  const canReview = activeRole === "owner" || activeRole === "admin";
  const showAdminTasks = canReview && livePendingReviewCount > 0;
  const showAdminTaskSpotlight =
    showAdminTasks && !adminTaskSpotlightDismissed;
  const spotlightMutedClass = showAdminTaskSpotlight
    ? "pointer-events-none opacity-45 blur-[1.5px]"
    : undefined;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSidebarApps(apps);
      setLiveMemberCount(activeMemberCount);
      setLivePendingReviewCount(pendingReviewCount);
      setRunStatuses(sidebarRunStatusMap(apps));
      setToolRecoveryStatuses(sidebarToolRecoveryStatusMap(apps));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeMemberCount, apps, pendingReviewCount]);

  useEffect(() => {
    const previousPublishedAppCount = previousPublishedAppCountRef.current;
    previousPublishedAppCountRef.current = publishedApps.length;

    if (publishedApps.length === 0) {
      const timer = window.setTimeout(() => setAppsOpen(false), 0);
      return () => window.clearTimeout(timer);
    } else if (previousPublishedAppCount === 0) {
      const timer = window.setTimeout(() => setAppsOpen(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, [activeWorkspaceId, publishedApps.length]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!canReview || livePendingReviewCount <= 0) {
        setAdminTaskSpotlightDismissed(true);
        return;
      }

      try {
        const key = `second-admin-task-spotlight:${activeWorkspaceId}`;
        setAdminTaskSpotlightDismissed(
          window.localStorage.getItem(key) === "seen",
        );
      } catch {
        setAdminTaskSpotlightDismissed(false);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeWorkspaceId, canReview, livePendingReviewCount]);

  const dismissAdminTaskSpotlight = useCallback(() => {
    setAdminTaskSpotlightDismissed(true);
    try {
      window.localStorage.setItem(
        `second-admin-task-spotlight:${activeWorkspaceId}`,
        "seen",
      );
    } catch {
      // The cue is best-effort; the admin task link itself remains available.
    }
  }, [activeWorkspaceId]);

  const refreshSidebarSnapshot = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/workspaces/${activeWorkspaceId}/sidebar`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = (await response.json()) as {
        activeMemberCount?: number;
        pendingReviewCount?: number;
        apps?: SidebarApp[];
      };
      const nextApps = data.apps ?? [];
      setSidebarApps(nextApps);
      setOptimisticApps((current) =>
        current.filter(
          (app) => !nextApps.some((persisted) => persisted._id === app._id),
        ),
      );
      setRunStatuses(sidebarRunStatusMap(nextApps));
      setToolRecoveryStatuses(sidebarToolRecoveryStatusMap(nextApps));
      if (typeof data.activeMemberCount === "number") {
        setLiveMemberCount(data.activeMemberCount);
      }
      if (typeof data.pendingReviewCount === "number") {
        setLivePendingReviewCount(data.pendingReviewCount);
      }
    } catch {
      // The last server-rendered sidebar snapshot remains usable.
    }
  }, [activeWorkspaceId]);

  const scheduleSidebarRefresh = useCallback(() => {
    if (sidebarRefreshTimerRef.current !== null) {
      window.clearTimeout(sidebarRefreshTimerRef.current);
    }
    sidebarRefreshTimerRef.current = window.setTimeout(() => {
      sidebarRefreshTimerRef.current = null;
      void refreshSidebarSnapshot();
    }, 120);
  }, [refreshSidebarSnapshot]);

  useWorkspaceRealtimeEvent(useCallback((event) => {
    if (event.workspaceId !== activeWorkspaceId) return;

    if (event.scope === "agent-runs" && event.appId && event.runStatus) {
      if (event.sourceVersion) return;
      const runStatus = event.runStatus;
      if (!isSidebarRunStatus(runStatus)) return;
      setRunStatuses((current) => {
        if (current[event.appId!] === runStatus) return current;
        return {
          ...current,
          [event.appId!]: runStatus,
        };
      });
      setToolRecoveryStatuses((current) => {
        const next = { ...current };
        if (
          event.runReason === "app_tool_failure" &&
          (runStatus === "pending" || runStatus === "streaming")
        ) {
          next[event.appId!] = "fixing";
        } else {
          delete next[event.appId!];
        }
        return next;
      });
      return;
    }

    if (event.scope === "apps" && event.type === "app.deleted" && event.appId) {
      setSidebarApps((current) =>
        current.filter((app) => app._id !== event.appId),
      );
      setOptimisticApps((current) =>
        current.filter((app) => app._id !== event.appId),
      );
      setRunStatuses((current) => {
        const next = { ...current };
        delete next[event.appId!];
        return next;
      });
      setToolRecoveryStatuses((current) => {
        const next = { ...current };
        delete next[event.appId!];
        return next;
      });
    }

    if (
      event.scope === "apps" ||
      event.scope === "reviews" ||
      event.scope === "memberships" ||
      event.scope === "team-memberships" ||
      event.scope === "integrations"
    ) {
      scheduleSidebarRefresh();
    }
  }, [activeWorkspaceId, scheduleSidebarRefresh]));

  useEffect(() => {
    return () => {
      if (sidebarRefreshTimerRef.current !== null) {
        window.clearTimeout(sidebarRefreshTimerRef.current);
        sidebarRefreshTimerRef.current = null;
      }
    };
  }, [activeWorkspaceId]);

  useEffect(() => {
    const handleAppCreated = (event: Event) => {
      const detail = (event as CustomEvent<{
        workspaceId?: string;
        app?: SidebarApp;
      }>).detail;
      if (detail?.workspaceId !== activeWorkspaceId || !detail.app) return;

      setOptimisticApps((current) => [
        detail.app!,
        ...current.filter((app) => app._id !== detail.app!._id),
      ]);
      setRunStatuses((current) => ({
        ...current,
        [detail.app!._id]: detail.app!.runStatus ?? "pending",
      }));
      setToolRecoveryStatuses((current) => {
        const next = { ...current };
        if (detail.app!.toolRecoveryStatus === "fixing") {
          next[detail.app!._id] = "fixing";
        } else {
          delete next[detail.app!._id];
        }
        return next;
      });
    };

    window.addEventListener("second:app-created", handleAppCreated);
    return () => {
      window.removeEventListener("second:app-created", handleAppCreated);
    };
  }, [activeWorkspaceId]);

  useEffect(() => {
    let cancelled = false;

    const fetchStatuses = async () => {
      try {
        const response = await fetch(
          `/api/workspaces/${activeWorkspaceId}/apps/status`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as {
          statuses?: Record<string, string>;
          toolRecoveryStatuses?: Record<string, string | null>;
        };
        if (!cancelled && data.statuses) {
          setRunStatuses(parseRunStatusMap(data.statuses));
          setToolRecoveryStatuses(
            parseToolRecoveryStatusMap(data.toolRecoveryStatuses),
          );
        }
      } catch {
        // Best effort; the server-rendered status remains usable.
      }
    };

    void fetchStatuses();
    const refreshOnFocus = () => {
      void fetchStatuses();
    };
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") {
        void fetchStatuses();
      }
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisible);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [activeWorkspaceId]);

  const handleRename = async () => {
    if (!renameApp) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renameApp.name) {
      setRenameApp(null);
      return;
    }
    try {
      await fetch(`/api/workspaces/${activeWorkspaceId}/apps/${renameApp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      void refreshSidebarSnapshot();
    } catch {
      // best effort
    }
    setRenameApp(null);
  };

  const handleDelete = async () => {
    if (!deleteApp) return;
    try {
      await fetch(`/api/workspaces/${activeWorkspaceId}/apps/${deleteApp.id}`, {
        method: "DELETE",
      });
      // If we're on the deleted app's page, navigate to workspace home
      if (pathname.startsWith(`/w/${activeWorkspaceId}/apps/${deleteApp.id}`)) {
        router.push(`/w/${activeWorkspaceId}`);
      }
      void refreshSidebarSnapshot();
    } catch {
      // best effort
    }
    setDeleteApp(null);
  };

  const openRenameApp = useCallback((app: SidebarApp) => {
    setRenameValue(app.name);
    setRenameApp({ id: app._id, name: app.name });
  }, []);

  const openDeleteApp = useCallback((app: SidebarApp) => {
    setDeleteApp({ id: app._id, name: app.name });
  }, []);

  const trackSidebarClick = useCallback(
    (target: string, properties: Record<string, unknown> = {}) => {
      captureAnalyticsEvent("sidebar clicked", {
        workspace_id: activeWorkspaceId,
        target,
        ...properties,
      });
    },
    [activeWorkspaceId],
  );

  const renderAppItem = useCallback(
    (app: SidebarApp, appSection: "private" | "shared") => {
      const isRunning =
        app.runStatus === "pending" ||
        app.runStatus === "streaming";
      const isRecovering = app.toolRecoveryStatus === "fixing";
      const item = (
        <SidebarMenuItem key={app._id}>
          <SidebarMenuButton
            asChild
            isActive={pathname.startsWith(`/w/${activeWorkspaceId}/apps/${app._id}`)}
            className={cn(isRecovering && "h-auto min-h-8 items-start py-1.5")}
          >
            <Link
              href={`/w/${activeWorkspaceId}/apps/${app._id}`}
              prefetch={false}
              onClick={(event) => {
                trackSidebarClick("app name", {
                  app_id: app._id,
                  app_name: app.name,
                  app_section: appSection,
                  publish_status: app.publishStatus,
                });
                announceNavigationIntentFromClick(event);
              }}
            >
              {isRecovering ? (
                <HammerIcon className="mt-0.5 size-3.5 shrink-0 text-sidebar-foreground/60" />
              ) : isRunning ? (
                <AppLoader size="xs" interactive={false} />
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{app.name}</span>
                {isRecovering ? (
                  <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-sidebar-foreground/55">
                    <span className="truncate">Call failed - builder fixing it</span>
                    <AppLoader size="xs" interactive={false} />
                  </span>
                ) : null}
              </span>
            </Link>
          </SidebarMenuButton>
          {app.canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction
                  showOnHover
                  aria-label={`Open actions for ${app.name}`}
                >
                  <MoreHorizontal />
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => openRenameApp(app)}>
                    <Pencil />
                    Rename
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => openDeleteApp(app)}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </SidebarMenuItem>
      );

      if (!app.canManage) return item;

      return (
        <ContextMenu key={app._id}>
          <ContextMenuTrigger asChild>
            {item}
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => openRenameApp(app)}>
              <Pencil />
              Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => openDeleteApp(app)}
            >
              <Trash2 />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      );
    },
    [
      activeWorkspaceId,
      openDeleteApp,
      openRenameApp,
      pathname,
      trackSidebarClick,
    ],
  );

  return (
    <>
      {showAdminTaskSpotlight ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-transparent backdrop-blur-[2px]"
        />
      ) : null}

      <Sidebar className={showAdminTaskSpotlight ? "z-50" : undefined}>
        <SidebarHeader className={cn("pt-4 pb-0", spotlightMutedClass)}>
          <div className="mb-2 flex items-center justify-between px-2">
            <SecondLogo className="text-sidebar-foreground" />
            <SidebarTrigger className="-mr-2"/>
          </div>
          <WorkspaceSwitcher
            user={user}
            authMode={authMode}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            activeRole={activeRole}
            activeMemberCount={liveMemberCount}
          />
        </SidebarHeader>

        <SidebarContent className={spotlightMutedClass}>
          <SidebarGroup className="pt-1">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link
                    href={`/w/${activeWorkspaceId}`}
                    prefetch={false}
                    onClick={(event) => {
                      trackSidebarClick("new app");
                      announceNavigationIntentFromClick(event);
                    }}
                  >
                    <Plus strokeWidth={1.8} />
                    <span>New app</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith(`/w/${activeWorkspaceId}/agents`)}
                >
                  <Link
                    href={`/w/${activeWorkspaceId}/agents`}
                    prefetch={false}
                    onClick={(event) => {
                      trackSidebarClick("agents");
                      announceNavigationIntentFromClick(event);
                    }}
                  >
                    <Bot strokeWidth={1.7} />
                    <span>Agents</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith(`/w/${activeWorkspaceId}/library`)}
                >
                  <Link
                    href={`/w/${activeWorkspaceId}/library`}
                    prefetch={false}
                    onClick={(event) => {
                      trackSidebarClick("library");
                      announceNavigationIntentFromClick(event);
                    }}
                  >
                    <BookOpen strokeWidth={1.7} />
                    <span>Library</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {showAvailableApps ? (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(
                      `/w/${activeWorkspaceId}/available-apps`,
                    )}
                  >
                    <Link
                      href={`/w/${activeWorkspaceId}/available-apps`}
                      prefetch={false}
                      onClick={(event) => {
                        trackSidebarClick("available apps");
                        announceNavigationIntentFromClick(event);
                      }}
                    >
                      <PackageOpenIcon strokeWidth={1.7} />
                      <span>Available Apps</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroup>

          <Collapsible open={draftsOpen} onOpenChange={setDraftsOpen}>
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="group">
                  <span>Private</span>
                  <span className="ml-1 font-mono text-[10px] text-sidebar-foreground/45">
                    {draftApps.length}
                  </span>
                  <ChevronDownIcon className="ml-auto transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarMenu>
                  {draftApps.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-sidebar-foreground/50">
                      No private apps
                    </p>
                  ) : (
                    draftApps.map((app) => renderAppItem(app, "private"))
                  )}
                </SidebarMenu>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>

          <Collapsible open={appsOpen} onOpenChange={setAppsOpen}>
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="group">
                  <span>Shared Apps</span>
                  <span className="ml-1 font-mono text-[10px] text-sidebar-foreground/45">
                    {publishedApps.length}
                  </span>
                  <ChevronDownIcon className="ml-auto transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarMenu>
                  {publishedApps.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-sidebar-foreground/50">
                      {authMode === "none"
                        ? "Nothing is shared yet. In local mode, publishing lets you experience the publish flow, but it doesn't really do anything."
                        : "No shared apps"}
                    </p>
                  ) : (
                    publishedApps.map((app) => renderAppItem(app, "shared"))
                  )}
                </SidebarMenu>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        </SidebarContent>

        <SidebarFooter>
          {showAdminTasks ? (
            <SidebarGroup className="px-0 py-0">
              <SidebarMenu>
                <SidebarMenuItem
                  className={showAdminTaskSpotlight ? "relative z-[60]" : undefined}
                >
                  <Tooltip open={showAdminTaskSpotlight}>
                    <TooltipTrigger asChild>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname.startsWith(`/w/${activeWorkspaceId}/reviews`)}
                        className={cn(
                          showAdminTaskSpotlight &&
                            "bg-sidebar-accent text-sidebar-accent-foreground shadow-lg ring-1 ring-sidebar-border",
                        )}
                      >
                        <Link
                          href={`/w/${activeWorkspaceId}/reviews`}
                          onClick={(event) => {
                            announceNavigationIntentFromClick(event);
                            dismissAdminTaskSpotlight();
                          }}
                        >
                          <Inbox />
                          <span>Admin tasks</span>
                          {livePendingReviewCount > 0 ? (
                            <span className="ml-auto rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 ring-1 ring-rose-200/80 dark:bg-rose-950/70 dark:text-rose-300 dark:ring-rose-900/70">
                              {livePendingReviewCount}
                            </span>
                          ) : null}
                        </Link>
                      </SidebarMenuButton>
                    </TooltipTrigger>
                    {showAdminTaskSpotlight ? (
                      <TooltipContent
                        side="right"
                        align="center"
                        className="z-[70] max-w-48"
                      >
                        👀 Your first admin task waits here.
                      </TooltipContent>
                    ) : null}
                  </Tooltip>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          ) : null}
          <div className={spotlightMutedClass}>
            <UserMenu user={user} workspaceId={activeWorkspaceId} />
          </div>
          <div className="flex items-center px-2 pb-1 text-xs text-sidebar-foreground/70">
            <span>Second Alpha</span>
            <span className="mx-[7px] text-lg leading-none">&middot;</span>
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/70"
            >
              <MessageCircle className="size-3" />
              Feedback
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>

      {/* Rename dialog */}
      <Dialog open={!!renameApp} onOpenChange={(open) => { if (!open) setRenameApp(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename app</DialogTitle>
            <DialogDescription>Enter a new name for this app.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRename();
            }}
          >
            <Input
              className="mt-4"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="App name"
              maxLength={80}
            />
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setRenameApp(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!renameValue.trim()}>
                Save
                <Kbd data-icon="inline-end" className="translate-x-0.5 h-4 w-4">
                  <CornerDownLeft className="h-3 w-3" />
                </Kbd>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteApp} onOpenChange={(open) => { if (!open) setDeleteApp(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete app</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteApp?.name}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setDeleteApp(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
