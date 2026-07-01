import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  IDENTITY_ONBOARDING_PATH,
  isWorkspaceAdminRole,
  listAppsVisibleInSidebarForWorkspaceContext,
  normalizeWorkspaceId,
  resolveOnboardingState,
  WORKSPACE_ONBOARDING_PATH,
} from "@/lib/auth";
import {
  appHasPublishedVersion,
  getAppPublishStatus,
  listLatestRunStatesForWorkspace,
  listMembershipsForWorkspace,
  listReviewRequestsForWorkspace,
  listWorkspacesByIds,
} from "@/lib/db";
import { readRuntimeConfig } from "@/lib/config";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AnalyticsConsentDialog } from "@/components/analytics-consent-dialog";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { WorkspaceRealtimeProvider } from "@/components/workspace-realtime-provider";
import { WorkspaceContentErrorBoundary } from "@/components/workspace-content-error-boundary";
import { WorkspaceAnalyticsTracker } from "@/components/workspace-analytics-tracker";
import { DesktopTitlebarDragRegion } from "@/components/desktop-titlebar-drag-region";
import { canShowLocalSourceControlFeatures } from "@/lib/source-control/runtime";

type WorkspaceLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
};

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);

  if (!workspaceId) {
    notFound();
  }

  const onboardingState = await resolveOnboardingState({
    headers: await headers(),
  });

  if (onboardingState.status === "missing-identity") {
    redirect(IDENTITY_ONBOARDING_PATH);
  }

  if (onboardingState.status === "needs-profile") {
    redirect(IDENTITY_ONBOARDING_PATH);
  }

  if (onboardingState.status === "needs-workspace") {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  const activeMembership = onboardingState.memberships.find(
    (m) => m.workspaceId === workspaceId,
  );

  if (!activeMembership) {
    notFound();
  }

  const workspaceContext = {
    actor: onboardingState.actor,
    user: onboardingState.user,
    workspaceId,
    membership: activeMembership,
    memberships: onboardingState.memberships,
  };

  const [
    workspaces,
    apps,
    appRunStates,
    activeWorkspaceMemberships,
    reviews,
  ] = await Promise.all([
    listWorkspacesByIds(
      onboardingState.memberships.map((m) => m.workspaceId),
    ),
    listAppsVisibleInSidebarForWorkspaceContext(workspaceContext),
    listLatestRunStatesForWorkspace(workspaceId),
    listMembershipsForWorkspace(workspaceId),
    isWorkspaceAdminRole(activeMembership.role)
      ? listReviewRequestsForWorkspace({ workspaceId, status: "pending" })
      : Promise.resolve([]),
  ]);
  const config = readRuntimeConfig();
  const canReview = isWorkspaceAdminRole(activeMembership.role);
  const roleByWorkspaceId = new Map(
    onboardingState.memberships.map((membership) => [
      membership.workspaceId,
      membership.role,
    ]),
  );

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={900}>
      <WorkspaceRealtimeProvider workspaceId={workspaceId}>
        <SidebarProvider>
          <AnalyticsConsentDialog
            identity={{
              userId: onboardingState.user._id,
              email: onboardingState.user.email,
              displayName: onboardingState.user.displayName,
              workspaceId,
              workspaceRole: activeMembership.role,
            }}
          />
          <WorkspaceAnalyticsTracker workspaceId={workspaceId} />
          <WorkspaceSidebar
            user={{
              displayName: onboardingState.user.displayName,
              email: onboardingState.user.email,
            }}
            authMode={config.authMode}
            workspaces={workspaces.map((w) => ({
              _id: w._id,
              name: w.name,
              role: roleByWorkspaceId.get(w._id) ?? "member",
            }))}
            activeWorkspaceId={workspaceId}
            activeRole={activeMembership.role}
            activeMemberCount={activeWorkspaceMemberships.length}
            pendingReviewCount={reviews.length}
            showAvailableApps={canShowLocalSourceControlFeatures()}
            apps={apps.map((a) => ({
              _id: a._id,
              name: a.name,
              runStatus:
                canReview ||
                a.createdByUserId === onboardingState.user._id ||
                (a.collaboratorUserIds ?? []).includes(onboardingState.user._id)
                  ? (appRunStates[a._id]?.status ?? null)
                  : null,
              toolRecoveryStatus:
                canReview ||
                a.createdByUserId === onboardingState.user._id ||
                (a.collaboratorUserIds ?? []).includes(onboardingState.user._id)
                  ? (appRunStates[a._id]?.toolRecoveryStatus ?? null)
                  : null,
              publishStatus: getAppPublishStatus(a),
              hasPublishedVersion: appHasPublishedVersion(a),
              canManage: canReview || a.createdByUserId === onboardingState.user._id,
            }))}
          />
          <SidebarInset className="max-h-svh overflow-hidden">
            <DesktopTitlebarDragRegion />
            <WorkspaceContentErrorBoundary>
              {children}
            </WorkspaceContentErrorBoundary>
          </SidebarInset>
        </SidebarProvider>
      </WorkspaceRealtimeProvider>
    </TooltipProvider>
  );
}
