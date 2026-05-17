import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { UIMessage } from "ai";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  normalizeWorkspaceId,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import {
  appHasPublishedVersion,
  appHasUnpublishedChanges,
  findPendingAppReviewRequest,
  getAppPublishStatus,
  getWorkspaceAppRuntimeSettings,
  getLatestRun,
  integrationNeedsSetup,
  listIntegrationsForAppReview,
  listWorkspaceTeams,
} from "@/lib/db";
import type { RunUsage } from "@/lib/db/types";
import type { AttachmentReference } from "@/lib/attachments";
import { normalizeRuntimeSettings } from "@/lib/agent/runtime-registry";
import { readRuntimeConfig } from "@/lib/config";
import { AppWorkspace } from "@/components/app-workspace";

export const dynamic = "force-dynamic";

type AppPageProps = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

export default async function AppPage({ params }: AppPageProps) {
  const { workspaceId: rawWorkspaceId, appId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);

  if (!workspaceId) {
    notFound();
  }

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: await headers(),
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) {
      const response = guardErrorToApiResponse(error);
      if (response.status === 404) notFound();
    }
    throw error;
  }

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    notFound();
  }
  const app = access.app;
  const publishStatus = getAppPublishStatus(app);
  const hasPublishedVersion = appHasPublishedVersion(app);
  const hasDraftChanges = appHasUnpublishedChanges(app);
  const canSeeDraftState = access.canCollaborate;
  const visiblePublishStatus =
    canSeeDraftState || !hasPublishedVersion ? publishStatus : "published";
  const visibleHasDraftChanges = canSeeDraftState ? hasDraftChanges : false;
  const initialSourceVersion = hasPublishedVersion ? "published" : "draft";

  const [
    latestRun,
    teams,
    integrations,
    pendingReview,
    appRuntimeSettings,
  ] = await Promise.all([
    canSeeDraftState ? getLatestRun(appId, workspaceId) : Promise.resolve(null),
    canSeeDraftState ? listWorkspaceTeams(workspaceId) : Promise.resolve([]),
    canSeeDraftState
      ? listIntegrationsForAppReview({ workspaceId, appId })
      : Promise.resolve([]),
    canSeeDraftState
      ? findPendingAppReviewRequest({ workspaceId, appId })
      : Promise.resolve(null),
    getWorkspaceAppRuntimeSettings(workspaceId),
  ]);
  const visibleAppTeamIds = canSeeDraftState
    ? (pendingReview?.targetTeamIds ?? app.teamIds ?? [])
    : [];
  const initialToolRecoveryStatus =
    latestRun?.recoveryContext?.type === "app_tool_failure" &&
    (latestRun.status === "pending" || latestRun.status === "streaming")
      ? "fixing"
      : null;
  const config = readRuntimeConfig();
  const localRuntimeMode = config.authMode === "none";
  const anthropicApiKeyConfigured =
    process.env.ANTHROPIC_API_KEY_CONFIGURED === "true" ||
    !!process.env.ANTHROPIC_API_KEY;
  const openAiApiKeyConfigured =
    process.env.OPENAI_API_KEY_CONFIGURED === "true" ||
    process.env.CODEX_API_KEY_CONFIGURED === "true" ||
    !!process.env.OPENAI_API_KEY ||
    !!process.env.CODEX_API_KEY;

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      <AppWorkspace
        workspaceId={workspaceId}
        appId={appId}
        appName={app.name}
        currentUserId={workspaceContext.user._id}
        appCreatorUserId={canSeeDraftState ? app.createdByUserId : ""}
        collaboratorUserIds={canSeeDraftState ? (app.collaboratorUserIds ?? []) : []}
        initialPrompt={canSeeDraftState ? app.prompt : undefined}
        initialAutoStartPrompt={
          canSeeDraftState ? (latestRun?.autoStartPrompt ?? null) : null
        }
        initialAutoStartKey={
          canSeeDraftState && latestRun?.autoStartPrompt
            ? `${latestRun._id}:${latestRun.updatedAt.toISOString()}`
            : null
        }
        runId={latestRun?._id ?? null}
        initialMessages={(latestRun?.messages ?? []) as UIMessage[]}
        initialRunAttachments={(latestRun?.attachments ?? []) as AttachmentReference[]}
        runStatus={latestRun?.status ?? null}
        initialToolRecoveryStatus={initialToolRecoveryStatus}
        initialToolRecoveryToolName={
          initialToolRecoveryStatus === "fixing"
            ? (latestRun?.recoveryContext?.toolName ?? null)
            : null
        }
        initialUsage={(latestRun?.usage as RunUsage) ?? null}
        runtimeBillingMode={{
          claudeCodeLocalSubscription:
            localRuntimeMode && !anthropicApiKeyConfigured,
          codexCliLocalSubscription:
            localRuntimeMode && !openAiApiKeyConfigured,
        }}
        initialSourceFiles={null}
        initialSourceVersion={initialSourceVersion}
        hasPublishedVersion={hasPublishedVersion}
        initialHasDraftChanges={visibleHasDraftChanges}
        initialRuntimeSettings={normalizeRuntimeSettings({
          runtimeId: app.runtimeId,
          model: app.runtimeModel,
          params: app.runtimeParams,
        })}
        initialAppRuntimeSettings={appRuntimeSettings}
        authMode={config.authMode}
        currentUserRole={workspaceContext.membership.role}
        canManageApp={access.canCollaborate}
        canCollaborateApp={access.canCollaborate}
        canManageCollaborators={access.canManageCollaborators}
        publishStatus={visiblePublishStatus}
        reviewRequestedAt={canSeeDraftState ? (app.reviewRequestedAt?.toISOString() ?? null) : null}
        changeRequestMessage={canSeeDraftState ? (app.changeRequestMessage ?? null) : null}
        agentsJsonApprovalSource={canSeeDraftState ? (app.agentsJsonApprovalSource ?? null) : null}
        appTeamIds={visibleAppTeamIds}
        teams={teams.map((team) => ({
          id: team._id,
          name: team.name,
          slug: team.slug,
          isDefault: team.isDefault,
        }))}
        publishIntegrations={integrations.map((integration) => ({
            id: integration._id,
            name: integration.name,
            domain: integration.domain,
            keySlug: integration.keySlug,
            keyName: integration.keyName,
            capabilityLabel: integration.capabilityLabel,
            faviconUrl: integration.faviconUrl,
            configured: integration.configured,
            needsSetup: integrationNeedsSetup(integration),
            permissionGroups: integration.permissionGroups ?? [],
            secretRequirements: integration.secretRequirements ?? [],
        }))}
      />
    </div>
  );
}
