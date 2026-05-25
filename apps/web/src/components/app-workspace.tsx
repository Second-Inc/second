"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { UIMessage } from "ai";
import {
  ArrowLeftIcon,
  BotIcon,
  HammerIcon,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  FolderClosed,
  Database,
  Maximize2,
  Minimize2,
  PencilLine,
  SparklesIcon,
  XIcon,
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
import { AppLoader } from "@/components/app-loader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AppChat } from "@/components/app-chat";
import { AppPreview } from "@/components/app-preview";
import { AppFileExplorer } from "@/components/app-file-explorer";
import { AppDataExplorer } from "@/components/app-data-explorer";
import { AppAgentBridge } from "@/components/app-agent-bridge";
import { AppIntegrationBridge } from "@/components/app-integration-bridge";
import { AppCollaboratorsDialog } from "@/components/app-collaborators-dialog";
import {
  AppDataBridge,
  type AppDataLiveChange,
} from "@/components/app-data-bridge";
import { AgentRunList, type AgentRunSummary } from "@/components/agent-run-viewer";
import { Balloons, type BalloonsHandle } from "@/components/ui/balloons";
import { AgentStreamDialog } from "@/components/agent-stream-dialog";
import {
  AppPublishDialog,
} from "@/components/app-publish-dialog";
import { isDoneBuildingSuccessOutput } from "@/lib/agent/done-building";
import type {
  AgentRunFailure,
  AppPublishStatus,
  AgentsJsonApprovalSource,
  IntegrationPermissionGroup,
  IntegrationSecretRequirement,
  ModelUsageRecord,
  RunUsage,
  WorkspaceRole,
} from "@/lib/db/types";
import type { SecondAuthMode } from "@/lib/config";
import { getModelDisplayName } from "@/lib/agent/models";
import { decodeUsageModelKey } from "@/lib/agent/usage-keys";
import { estimateOpenAiCostUsd } from "@/lib/agent/openai-pricing";
import type { AttachmentReference } from "@/lib/attachments";
import {
  findRuntimeForModel,
  type AgentRuntimeSettings,
} from "@/lib/agent/runtime-registry";
import { useWorkspaceRealtimeEvent } from "@/components/workspace-realtime-provider";
import { RecoverableErrorBoundary } from "@/components/recoverable-error-boundary";
import type { WorkspaceAppRuntimeSettings } from "@/lib/workspace-app-runtime-settings";
import { cn } from "@/lib/utils";

type RuntimeBillingMode = {
  claudeCodeLocalSubscription: boolean;
  codexCliLocalSubscription: boolean;
};

type AppAgentUsageSummary = {
  usage: RunUsage | null;
  runCount: number;
  completedRunCount: number;
  usageRunCount: number;
};

type UsageDisplayEntry = {
  model: string;
  usage: ModelUsageRecord;
  costUsd: number;
  runtimeId: string | null;
  localSubscription: boolean;
};

type AppWorkspaceProps = {
  workspaceId: string;
  appId: string;
  appName: string;
  currentUserId: string;
  appCreatorUserId: string;
  collaboratorUserIds: string[];
  initialPrompt?: string;
  initialAutoStartPrompt?: string | null;
  initialAutoStartKey?: string | null;
  runId: string | null;
  initialMessages: UIMessage[];
  initialRunAttachments?: AttachmentReference[];
  runStatus: "pending" | "streaming" | "completed" | "failed" | null;
  initialRunFailure?: AgentRunFailure | null;
  initialToolRecoveryStatus?: ToolRecoveryStatus;
  initialToolRecoveryToolName?: string | null;
  initialUsage: RunUsage | null;
  runtimeBillingMode: RuntimeBillingMode;
  initialSourceFiles: Record<string, string> | null;
  initialSourceVersion: "draft" | "published";
  hasPublishedVersion: boolean;
  initialHasDraftChanges: boolean;
  initialRuntimeSettings: AgentRuntimeSettings;
  initialAppRuntimeSettings: WorkspaceAppRuntimeSettings;
  authMode: SecondAuthMode;
  currentUserRole: WorkspaceRole;
  canManageApp: boolean;
  canCollaborateApp: boolean;
  canManageCollaborators: boolean;
  publishStatus: AppPublishStatus;
  reviewRequestedAt?: string | null;
  changeRequestMessage?: string | null;
  agentsJsonApprovalSource?: AgentsJsonApprovalSource | null;
  appTeamIds: string[];
  teams: Array<{
    id: string;
    name: string;
    slug: string;
    isDefault: boolean;
  }>;
  publishIntegrations: Array<{
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
  }>;
};

/** "panel" = 385px side panel, "full" = agent full width, "hidden" = agent hidden */
type AgentMode = "panel" | "full" | "hidden";
type MainView = "preview" | "files" | "data";
type ToolRecoveryStatus = "fixing" | null;

const DEFAULT_BUILDER_PANEL_WIDTH = 400;
const AGENTS_APPROVAL_PANEL_WIDTH = 535;
const MIN_BUILDER_PANEL_WIDTH = 320;
const FALLBACK_MAX_BUILDER_PANEL_WIDTH = 720;
const MIN_MAIN_PANE_WIDTH = 360;
const APP_AGENT_RUNS_HINT_STORAGE_PREFIX = "second:app-agent-runs-hint";
const BUILDER_AGENT_TOGGLE_HINT_STORAGE_PREFIX =
  "second:builder-agent-toggle-hint";

function maxBuilderPanelWidth(): number {
  if (typeof window === "undefined") return FALLBACK_MAX_BUILDER_PANEL_WIDTH;
  return Math.max(MIN_BUILDER_PANEL_WIDTH, window.innerWidth - MIN_MAIN_PANE_WIDTH);
}

function clampBuilderPanelWidth(width: number): number {
  return Math.min(
    Math.max(width, MIN_BUILDER_PANEL_WIDTH),
    maxBuilderPanelWidth(),
  );
}

const FIRST_APP_AGENT_CONFETTI_PIECES = [
  "left-[10%] top-6 size-1.5 rounded-full bg-chart-1 duration-300",
  "left-[18%] top-12 h-2 w-1 rounded-sm bg-chart-2 rotate-12 duration-500",
  "left-[28%] top-4 size-1 rounded-full bg-chart-3 duration-700",
  "left-[36%] top-14 h-1.5 w-3 rounded-sm bg-chart-4 -rotate-12 duration-500",
  "left-[48%] top-7 size-1.5 rounded-full bg-chart-5 duration-300",
  "right-[36%] top-[3.25rem] h-2 w-1 rounded-sm bg-chart-1 -rotate-12 duration-700",
  "right-[27%] top-5 size-1 rounded-full bg-chart-2 duration-500",
  "right-[18%] top-12 h-1.5 w-3 rounded-sm bg-chart-3 rotate-12 duration-700",
  "right-[10%] top-6 size-1.5 rounded-full bg-chart-4 duration-300",
];


function appAgentRunsHintStorageKey(userId: string): string {
  return `${APP_AGENT_RUNS_HINT_STORAGE_PREFIX}:user:${userId}`;
}

function builderAgentToggleHintStorageKey(userId: string): string {
  return `${BUILDER_AGENT_TOGGLE_HINT_STORAGE_PREFIX}:user:${userId}`;
}

function isActiveRunStatus(status: string | null | undefined): boolean {
  return status === "pending" || status === "streaming" || status === "running";
}

function runStatusToAgentStatus(status: AppWorkspaceProps["runStatus"]): string {
  if (status === "pending" || status === "streaming") return "running";
  if (status === "completed") return "done";
  if (status === "failed") return "error";
  return "idle";
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatUsd(value: unknown): string {
  const n = finiteNumber(value);
  return n < 0.01 && n > 0 ? `<$0.01` : `$${n.toFixed(2)}`;
}

function formatTokens(value: unknown): string {
  const n = finiteNumber(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function toModelUsageRecord(value: unknown): ModelUsageRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const hasUsageFields =
    "inputTokens" in record ||
    "outputTokens" in record ||
    "cacheReadInputTokens" in record ||
    "cacheCreationInputTokens" in record ||
    "costUsd" in record ||
    "costUSD" in record;

  if (!hasUsageFields) return null;

  return {
    inputTokens: finiteNumber(record.inputTokens),
    outputTokens: finiteNumber(record.outputTokens),
    cacheReadInputTokens: finiteNumber(record.cacheReadInputTokens),
    cacheCreationInputTokens: finiteNumber(record.cacheCreationInputTokens),
    costUsd: finiteNumber(record.costUsd ?? record.costUSD),
  };
}

function flattenModelUsageEntries(
  byModel: Record<string, unknown> | null | undefined,
  modelPrefix = "",
): Array<[string, ModelUsageRecord]> {
  if (!byModel) return [];

  const entries: Array<[string, ModelUsageRecord]> = [];
  for (const [modelKey, value] of Object.entries(byModel)) {
    const model = modelPrefix
      ? `${modelPrefix}.${modelKey}`
      : decodeUsageModelKey(modelKey);
    const usageRecord = toModelUsageRecord(value);

    if (usageRecord) {
      entries.push([model, usageRecord]);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      entries.push(
        ...flattenModelUsageEntries(value as Record<string, unknown>, model),
      );
    }
  }

  return entries;
}

function usageCostUsd(
  model: string,
  usage: ModelUsageRecord,
): number {
  return usage.costUsd > 0
    ? usage.costUsd
    : estimateOpenAiCostUsd({
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cacheReadInputTokens,
      });
}

function runCostUsd(
  usage: RunUsage,
  modelEntries: Array<[string, ModelUsageRecord]>,
): number {
  if (usage.totalCostUsd > 0) return usage.totalCostUsd;
  return modelEntries.reduce(
    (sum, [model, modelUsage]) => sum + usageCostUsd(model, modelUsage),
    0,
  );
}

function usageTokenCount(usage: RunUsage | null): number {
  if (!usage) return 0;
  return (
    finiteNumber(usage.totalInputTokens) +
    finiteNumber(usage.totalOutputTokens)
  );
}

function isLocalSubscriptionUsage(
  model: string,
  billingMode: RuntimeBillingMode,
): boolean {
  const runtimeId = findRuntimeForModel(model)?.id;
  return (
    (runtimeId === "claude-code" && billingMode.claudeCodeLocalSubscription) ||
    (runtimeId === "codex-cli" && billingMode.codexCliLocalSubscription)
  );
}

function localSubscriptionUsageLabel(
  billingMode: RuntimeBillingMode,
  entries: Array<{ localSubscription: boolean; runtimeId: string | null }>,
): string {
  const runtimes = new Set(
    entries
      .filter((entry) => entry.localSubscription)
      .map((entry) => entry.runtimeId),
  );
  const hasClaude =
    billingMode.claudeCodeLocalSubscription && runtimes.has("claude-code");
  const hasCodex =
    billingMode.codexCliLocalSubscription && runtimes.has("codex-cli");

  if (hasClaude && hasCodex) {
    return "Claude and Codex usage is running through local subscription auth";
  }
  if (hasCodex) return "Running through your Codex CLI ChatGPT login";
  return "Running on your Claude subscription";
}

function hasDoneBuildingInMessages(messages: UIMessage[]): boolean {
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.parts) {
      if (
        part.type === "dynamic-tool" &&
        part.toolName === "mcp__second__done_building" &&
        part.state === "output-available" &&
        isDoneBuildingSuccessOutput(part.output)
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasPreviewArtifact(files: Record<string, string> | null): boolean {
  return !!(
    files?.["dist/index.html"] ||
    files?.["main.js"] ||
    files?.["main.ts"]
  );
}

function FirstAppAgentRunDialog({
  open,
  onDismiss,
}: {
  open: boolean;
  onDismiss: () => void;
}) {
  const balloonsRef = useRef<BalloonsHandle | null>(null);

  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => {
        balloonsRef.current?.launchAnimation();
      }, 50);
      return () => {
        window.clearTimeout(timer);
      };
    }
  }, [open]);

  return (
    <>
      <Balloons ref={balloonsRef} type="default" />
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onDismiss();
        }}
      >
        <DialogContent className="overflow-hidden p-0 sm:max-w-sm">
          <div
            className="relative h-24 overflow-hidden border-b border-border bg-muted/30"
            aria-hidden="true"
          >
            {FIRST_APP_AGENT_CONFETTI_PIECES.map((className) => (
              <span
                key={className}
                className={`absolute animate-in fade-in-0 slide-in-from-top-1 ${className}`}
              />
            ))}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border">
                <SparklesIcon className="size-4 text-foreground" />
              </div>
            </div>
          </div>
          <div className="px-6 py-5">
            <DialogHeader className="items-center text-center">
              <DialogTitle className="text-base">
                You have just triggered your first app agent
              </DialogTitle>
              <DialogDescription className="text-pretty text-sm leading-5">
                App agents keep working inside the app while you stay in context.
                Use Agent runs to watch progress, reopen the run stream, and see
                what changed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-5 justify-center">
              <Button type="button" onClick={onDismiss}>
                Got it
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BarTooltipButton({
  icon: Icon,
  label,
  disabled,
  active,
  activeLabel,
  tooltipOpen,
  tooltipContent,
  tooltipClassName,
  className,
  iconClassName,
  onTooltipClick,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  disabled?: boolean;
  active?: boolean;
  activeLabel?: string;
  tooltipOpen?: boolean;
  tooltipContent?: ReactNode;
  tooltipClassName?: string;
  className?: string;
  iconClassName?: string;
  onTooltipClick?: () => void;
  onClick?: () => void;
}) {
  const showActiveLabel = active && activeLabel;
  const hasInspectorLabel = Boolean(activeLabel);

  return (
    <Tooltip open={tooltipOpen}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? "secondary" : "ghost"}
          size={showActiveLabel ? "sm" : "icon-sm"}
          className={cn(
            "rounded-full",
            hasInspectorLabel && "transition-none",
            showActiveLabel
              ? "h-7 px-2.5 text-xs text-foreground"
              : "text-muted-foreground",
            className,
          )}
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
        >
          <Icon
            className={iconClassName}
            data-icon={showActiveLabel ? "inline-start" : undefined}
            strokeWidth={1.5}
          />
          {showActiveLabel ? (
            <>
              <span>{activeLabel}</span>
              <XIcon data-icon="inline-end" strokeWidth={1.5} aria-hidden="true" />
            </>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className={tooltipClassName}
        onClick={onTooltipClick}
      >
        {tooltipContent ?? label}
      </TooltipContent>
    </Tooltip>
  );
}

function BarSeparator() {
  return <div className="mx-0.5 h-4 w-px bg-border" />;
}

function UsageModelBreakdown({
  label,
  entries,
}: {
  label: string;
  entries: UsageDisplayEntry[];
}) {
  if (entries.length === 0) return null;

  return (
    <>
      <div className="h-px bg-border/50" />
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          {label}
        </span>
        {entries.map((entry) => (
          <div
            key={`${label}:${entry.model}`}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="truncate">
              {getModelDisplayName(entry.model)}
            </span>
            <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
              <span className="font-mono text-[11px]">
                {formatTokens(
                  entry.usage.inputTokens + entry.usage.outputTokens,
                )}
              </span>
              {entry.localSubscription ? (
                <span className="font-medium text-muted-foreground/60 line-through decoration-muted-foreground/30">
                  {formatUsd(entry.costUsd)}
                </span>
              ) : (
                <span className="font-medium text-foreground">
                  {formatUsd(entry.costUsd)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function AppWorkspace({
  workspaceId,
  appId,
  appName,
  currentUserId,
  appCreatorUserId,
  collaboratorUserIds,
  initialPrompt,
  initialAutoStartPrompt = null,
  initialAutoStartKey = null,
  runId,
  initialMessages,
  initialRunAttachments = [],
  runStatus,
  initialRunFailure = null,
  initialToolRecoveryStatus = null,
  initialToolRecoveryToolName = null,
  initialUsage,
  runtimeBillingMode,
  initialSourceFiles,
  initialSourceVersion,
  hasPublishedVersion,
  initialHasDraftChanges,
  initialRuntimeSettings,
  initialAppRuntimeSettings,
  authMode,
  currentUserRole,
  canManageApp,
  canCollaborateApp,
  canManageCollaborators,
  publishStatus,
  reviewRequestedAt,
  changeRequestMessage,
  agentsJsonApprovalSource,
  appTeamIds,
  teams,
  publishIntegrations,
}: AppWorkspaceProps) {
  const router = useRouter();
  const [isHydrated, setIsHydrated] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<Record<string, string> | null>(
    () => initialSourceFiles,
  );
  const [sourceVersion, setSourceVersion] = useState<"draft" | "published">(
    initialSourceVersion,
  );
  const sourceVersionRef = useRef<"draft" | "published">(initialSourceVersion);
  const isDraftVersion = sourceVersion === "draft";
  const [hasPublishedSnapshot, setHasPublishedSnapshot] =
    useState(hasPublishedVersion);
  const [hasDraftChanges, setHasDraftChanges] =
    useState(initialHasDraftChanges);
  const hasInitialSourceFiles = useMemo(
    () => !!initialSourceFiles && Object.keys(initialSourceFiles).length > 0,
    [initialSourceFiles],
  );
  const [previewVisible, setPreviewVisible] = useState(
    () =>
      !!initialSourceFiles ||
      hasPublishedVersion ||
      hasDoneBuildingInMessages(initialMessages),
  );
  const [agentMode, setAgentMode] = useState<AgentMode>("panel");
  const [builderPanelWidth, setBuilderPanelWidth] = useState(
    DEFAULT_BUILDER_PANEL_WIDTH,
  );
  const builderPanelWidthRef = useRef(DEFAULT_BUILDER_PANEL_WIDTH);
  const autoExpandedBuilderPanelRestoreWidthRef = useRef<number | null>(null);
  const [pendingBuilderApprovalKind, setPendingBuilderApprovalKind] = useState<
    "plan" | "agents" | "suggestions" | null
  >(null);
  const [isBuilderPanelResizing, setIsBuilderPanelResizing] = useState(false);
  const builderPanelResizeGuideRef = useRef<HTMLDivElement | null>(null);
  const builderPanelResizeDraftWidthRef = useRef(DEFAULT_BUILDER_PANEL_WIDTH);
  const builderPanelResizeRafRef = useRef<number | null>(null);
  const [mainView, setMainView] = useState<MainView>("preview");
  const [chatFocusRequest, setChatFocusRequest] = useState(0);
  const [usage, setUsage] = useState<RunUsage | null>(initialUsage);
  const [appAgentUsageSummary, setAppAgentUsageSummary] =
    useState<AppAgentUsageSummary | null>(null);
  const appAgentUsage = appAgentUsageSummary?.usage ?? null;
  useEffect(() => {
    builderPanelWidthRef.current = builderPanelWidth;
  }, [builderPanelWidth]);
  const modelUsageEntries = useMemo(
    () =>
      flattenModelUsageEntries(
        usage?.byModel as Record<string, unknown> | null | undefined,
      ),
    [usage],
  );
  const displayRunCostUsd = useMemo(
    () => (usage ? runCostUsd(usage, modelUsageEntries) : 0),
    [modelUsageEntries, usage],
  );
  const modelUsageDisplayEntries = useMemo(
    () =>
      modelUsageEntries.map(([model, modelUsage]) => {
        const runtimeId = findRuntimeForModel(model)?.id ?? null;
        return {
          model,
          usage: modelUsage,
          costUsd: usageCostUsd(model, modelUsage),
          runtimeId,
          localSubscription: isLocalSubscriptionUsage(
            model,
            runtimeBillingMode,
          ),
        };
      }),
    [modelUsageEntries, runtimeBillingMode],
  );
  const estimatedRunCostUsd = modelUsageDisplayEntries.length > 0
    ? modelUsageDisplayEntries.reduce((sum, entry) => sum + entry.costUsd, 0)
    : displayRunCostUsd;
  const initialRuntimeLocalSubscription =
    (initialRuntimeSettings.runtimeId === "claude-code" &&
      runtimeBillingMode.claudeCodeLocalSubscription) ||
    (initialRuntimeSettings.runtimeId === "codex-cli" &&
      runtimeBillingMode.codexCliLocalSubscription);
  const localSubscriptionEstimatedCostUsd = modelUsageDisplayEntries.reduce(
    (sum, entry) => sum + (entry.localSubscription ? entry.costUsd : 0),
    0,
  );
  const billableRunCostUsd = modelUsageDisplayEntries.length > 0
    ? modelUsageDisplayEntries.reduce(
        (sum, entry) => sum + (entry.localSubscription ? 0 : entry.costUsd),
        0,
      )
    : initialRuntimeLocalSubscription
      ? 0
      : displayRunCostUsd;
  const hasLocalSubscriptionCostMode =
    localSubscriptionEstimatedCostUsd > 0 ||
    modelUsageDisplayEntries.some((entry) => entry.localSubscription) ||
    (modelUsageDisplayEntries.length === 0 &&
      initialRuntimeLocalSubscription &&
      estimatedRunCostUsd > 0);
  const localSubscriptionLabel = hasLocalSubscriptionCostMode
    ? modelUsageDisplayEntries.length > 0
      ? localSubscriptionUsageLabel(runtimeBillingMode, modelUsageDisplayEntries)
      : initialRuntimeSettings.runtimeId === "codex-cli"
        ? "Running through your Codex CLI ChatGPT login"
        : "Running on your Claude subscription"
    : null;
  const appAgentModelUsageEntries = useMemo(
    () =>
      flattenModelUsageEntries(
        appAgentUsage?.byModel as Record<string, unknown> | null | undefined,
      ),
    [appAgentUsage],
  );
  const appAgentModelUsageDisplayEntries = useMemo(
    () =>
      appAgentModelUsageEntries.map(([model, modelUsage]) => {
        const runtimeId = findRuntimeForModel(model)?.id ?? null;
        return {
          model,
          usage: modelUsage,
          costUsd: usageCostUsd(model, modelUsage),
          runtimeId,
          localSubscription: isLocalSubscriptionUsage(
            model,
            runtimeBillingMode,
          ),
        };
      }),
    [appAgentModelUsageEntries, runtimeBillingMode],
  );
  const appAgentEstimatedCostUsd = appAgentModelUsageDisplayEntries.length > 0
    ? appAgentModelUsageDisplayEntries.reduce(
        (sum, entry) => sum + entry.costUsd,
        0,
      )
    : appAgentUsage
      ? runCostUsd(appAgentUsage, appAgentModelUsageEntries)
      : 0;
  const appAgentLocalSubscriptionEstimatedCostUsd =
    appAgentModelUsageDisplayEntries.reduce(
      (sum, entry) => sum + (entry.localSubscription ? entry.costUsd : 0),
      0,
    );
  const appAgentBillableCostUsd = appAgentModelUsageDisplayEntries.length > 0
    ? appAgentModelUsageDisplayEntries.reduce(
        (sum, entry) => sum + (entry.localSubscription ? 0 : entry.costUsd),
        0,
      )
    : appAgentEstimatedCostUsd;
  const combinedEstimatedCostUsd = estimatedRunCostUsd + appAgentEstimatedCostUsd;
  const combinedBillableCostUsd = billableRunCostUsd + appAgentBillableCostUsd;
  const combinedLocalSubscriptionEstimatedCostUsd =
    localSubscriptionEstimatedCostUsd +
    appAgentLocalSubscriptionEstimatedCostUsd;
  const combinedModelUsageDisplayEntries = useMemo(
    () => [
      ...modelUsageDisplayEntries,
      ...appAgentModelUsageDisplayEntries,
    ],
    [appAgentModelUsageDisplayEntries, modelUsageDisplayEntries],
  );
  const combinedHasLocalSubscriptionCostMode =
    hasLocalSubscriptionCostMode ||
    appAgentLocalSubscriptionEstimatedCostUsd > 0 ||
    appAgentModelUsageDisplayEntries.some((entry) => entry.localSubscription);
  const combinedLocalSubscriptionLabel = combinedHasLocalSubscriptionCostMode
    ? combinedModelUsageDisplayEntries.length > 0
      ? localSubscriptionUsageLabel(
          runtimeBillingMode,
          combinedModelUsageDisplayEntries,
        )
      : localSubscriptionLabel
    : null;
  const [builderRunState, setBuilderRunState] = useState<{
    runId: string | null;
    status: AppWorkspaceProps["runStatus"];
  } | null>(null);
  const builderRunStatus =
    builderRunState?.runId === runId ? builderRunState.status : runStatus;
  const setBuilderRunStatus = useCallback(
    (status: AppWorkspaceProps["runStatus"]) => {
      setBuilderRunState({ runId, status });
    },
    [runId],
  );
  const [toolRecoveryState, setToolRecoveryState] = useState<{
    runId: string | null;
    status: ToolRecoveryStatus;
    toolName: string | null;
  } | null>(null);
  const initialActiveToolRecoveryStatus = isActiveRunStatus(runStatus)
    ? initialToolRecoveryStatus
    : null;
  const currentToolRecoveryState =
    toolRecoveryState?.runId === runId
      ? toolRecoveryState
      : {
          status: initialActiveToolRecoveryStatus,
          toolName: initialActiveToolRecoveryStatus === "fixing"
            ? initialToolRecoveryToolName
            : null,
        };
  const toolRecoveryStatus = currentToolRecoveryState.status;
  const toolRecoveryToolName = currentToolRecoveryState.toolName;
  const agentStatus = runStatusToAgentStatus(builderRunStatus);
  const [livePublishStatus, setLivePublishStatus] =
    useState<AppPublishStatus>(publishStatus);
  const [liveReviewRequestedAt, setLiveReviewRequestedAt] = useState<
    string | null
  >(reviewRequestedAt ?? null);
  const [liveChangeRequestMessage, setLiveChangeRequestMessage] = useState<
    string | null
  >(changeRequestMessage ?? null);
  const [liveAgentsJsonApprovalSource, setLiveAgentsJsonApprovalSource] =
    useState<AgentsJsonApprovalSource | null>(
      agentsJsonApprovalSource ?? null,
    );
  const [liveAppTeamIds, setLiveAppTeamIds] = useState(appTeamIds);
  const [liveCollaboratorUserIds, setLiveCollaboratorUserIds] = useState(
    collaboratorUserIds,
  );
  const [livePublishIntegrations, setLivePublishIntegrations] = useState(
    publishIntegrations,
  );
  const [appRuntimeSettings, setAppRuntimeSettings] = useState(
    initialAppRuntimeSettings,
  );
  const reviewRequestedKey =
    livePublishStatus === "review_requested"
      ? (liveReviewRequestedAt ?? "active")
      : null;
  const [invalidatedReviewKey, setInvalidatedReviewKey] = useState<string | null>(
    null,
  );
  const [localDraftStarted, setLocalDraftStarted] = useState(false);
  const reviewInvalidatedLocally =
    reviewRequestedKey !== null && invalidatedReviewKey === reviewRequestedKey;
  const currentPublishStatus: AppPublishStatus =
    reviewInvalidatedLocally || localDraftStarted
      ? "draft"
      : livePublishStatus;
  const currentChangeRequestMessage =
    reviewInvalidatedLocally || localDraftStarted
      ? null
      : liveChangeRequestMessage;

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sourceFilesRef = useRef(sourceFiles);
  const appStateRefreshTimerRef = useRef<number | null>(null);
  const appAgentUsageRefreshTimerRef = useRef<number | null>(null);
  const agentRunsHintDelayTimerRef = useRef<number | null>(null);
  const agentRunsHintStartedRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsHydrated(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    sourceFilesRef.current = sourceFiles;
  }, [sourceFiles]);

  useEffect(() => {
    if (!isDraftVersion && mainView !== "preview") {
      const timer = window.setTimeout(() => setMainView("preview"), 0);
      return () => window.clearTimeout(timer);
    }
  }, [isDraftVersion, mainView]);

  const selectSourceVersion = useCallback((version: "draft" | "published") => {
    sourceVersionRef.current = version;
    setSourceVersion(version);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLivePublishStatus(publishStatus);
      setLiveReviewRequestedAt(reviewRequestedAt ?? null);
      setLiveChangeRequestMessage(changeRequestMessage ?? null);
      setLiveAgentsJsonApprovalSource(agentsJsonApprovalSource ?? null);
      setLiveAppTeamIds(appTeamIds);
      setLiveCollaboratorUserIds(collaboratorUserIds);
      setLivePublishIntegrations(publishIntegrations);
      setAppRuntimeSettings(initialAppRuntimeSettings);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    appTeamIds,
    agentsJsonApprovalSource,
    changeRequestMessage,
    collaboratorUserIds,
    initialAppRuntimeSettings,
    publishIntegrations,
    publishStatus,
    reviewRequestedAt,
  ]);

  const fetchAppState = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/apps/${appId}/state`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = (await response.json()) as {
        publishStatus?: AppPublishStatus;
        reviewRequestedAt?: string | null;
        changeRequestMessage?: string | null;
        agentsJsonApprovalSource?: AgentsJsonApprovalSource | null;
        appTeamIds?: string[];
        collaboratorUserIds?: string[];
        hasPublishedVersion?: boolean;
        hasDraftChanges?: boolean;
        integrations?: AppWorkspaceProps["publishIntegrations"];
        appRuntimeSettings?: WorkspaceAppRuntimeSettings;
      };

      if (data.publishStatus) setLivePublishStatus(data.publishStatus);
      setLiveReviewRequestedAt(data.reviewRequestedAt ?? null);
      setLiveChangeRequestMessage(data.changeRequestMessage ?? null);
      setLiveAgentsJsonApprovalSource(data.agentsJsonApprovalSource ?? null);
      if (Array.isArray(data.appTeamIds)) setLiveAppTeamIds(data.appTeamIds);
      if (Array.isArray(data.collaboratorUserIds)) {
        setLiveCollaboratorUserIds(data.collaboratorUserIds);
      }
      if (Array.isArray(data.integrations)) {
        setLivePublishIntegrations(data.integrations);
      }
      if (data.appRuntimeSettings) {
        setAppRuntimeSettings(data.appRuntimeSettings);
      }
      if (typeof data.hasPublishedVersion === "boolean") {
        setHasPublishedSnapshot(data.hasPublishedVersion);
      }
      if (typeof data.hasDraftChanges === "boolean") {
        setHasDraftChanges(data.hasDraftChanges);
      }
    } catch {
      // Keep the current app chrome state; route data remains the fallback.
    }
  }, [appId, workspaceId]);

  const fetchAppAgentUsage = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/apps/${appId}/agent-runs/usage`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = (await response.json()) as AppAgentUsageSummary;
      setAppAgentUsageSummary(data);
    } catch {
      // Usage is secondary chrome state; keep the current value.
    }
  }, [appId, workspaceId]);

  const scheduleAppStateRefresh = useCallback(() => {
    if (appStateRefreshTimerRef.current !== null) {
      window.clearTimeout(appStateRefreshTimerRef.current);
    }
    appStateRefreshTimerRef.current = window.setTimeout(() => {
      appStateRefreshTimerRef.current = null;
      void fetchAppState();
    }, 120);
  }, [fetchAppState]);

  const scheduleAppAgentUsageRefresh = useCallback(
    (delayMs = 120) => {
      if (appAgentUsageRefreshTimerRef.current !== null) {
        window.clearTimeout(appAgentUsageRefreshTimerRef.current);
      }
      appAgentUsageRefreshTimerRef.current = window.setTimeout(() => {
        appAgentUsageRefreshTimerRef.current = null;
        void fetchAppAgentUsage();
      }, delayMs);
    },
    [fetchAppAgentUsage],
  );

  // Parse agents from source files for the bridge
  const agents = useMemo(() => {
    const agentsJsonRaw = sourceFiles?.["agents.json"];
    if (!agentsJsonRaw) return [];
    try {
      const parsed = JSON.parse(agentsJsonRaw) as {
        agents: Array<{
          id: string;
          name: string;
          description: string;
          tools?: Array<{ type: string; name: string; displayName?: string; enabled?: boolean }>;
        }>;
      };
      return parsed.agents ?? [];
    } catch {
      return [];
    }
  }, [sourceFiles]);
  const canShowAppAgents = isHydrated && agents.length > 0;

  const [, setActiveAgentRuns] = useState<
    Array<{ runId: string; agentId: string; agentName: string }>
  >([]);
  const [activeAppAgentRunIds, setActiveAppAgentRunIds] = useState<Set<string>>(
    () => new Set(),
  );
  const activeAppAgentRunCount = activeAppAgentRunIds.size;
  const hasActiveAppAgentRuns = activeAppAgentRunCount > 0;
  const agentRunsButtonLabel = hasActiveAppAgentRuns
    ? `Agent runs (${activeAppAgentRunCount})`
    : "Agent runs";
  const [agentRunsHintOpen, setAgentRunsHintOpen] = useState(false);
  const [builderAgentToggleHintOpen, setBuilderAgentToggleHintOpen] =
    useState(false);
  const [builderDividerTooltip, setBuilderDividerTooltip] = useState<
    "hide" | "resize" | null
  >(null);

  useWorkspaceRealtimeEvent(useCallback((event) => {
    if (event.workspaceId !== workspaceId) return;

    if (event.scope === "agent-runs" && event.appId === appId) {
      const isAppAgentRunEvent = Boolean(event.sourceVersion);
      const isBuilderRunEvent = Boolean(
        !isAppAgentRunEvent && runId && event.runId && event.runId === runId,
      );

      if (isBuilderRunEvent) {
        if (
          event.runStatus === "pending" ||
          event.runStatus === "streaming" ||
          event.runStatus === "completed" ||
          event.runStatus === "failed"
        ) {
          setBuilderRunStatus(event.runStatus);
          if (
            event.runReason === "app_tool_failure" &&
            isActiveRunStatus(event.runStatus)
          ) {
            setToolRecoveryState((current) => ({
              runId,
              status: "fixing",
              toolName:
                current?.runId === runId
                  ? current.toolName
                  : initialToolRecoveryToolName,
            }));
          } else if (!isActiveRunStatus(event.runStatus)) {
            setToolRecoveryState({ runId, status: null, toolName: null });
          }
          if (event.type === "run.autostart_scheduled") {
            router.refresh();
          }
        }
      } else if (!isAppAgentRunEvent && event.runId) {
        if (
          event.type === "run.autostart_scheduled" ||
          event.type === "run.created" ||
          event.type === "run.starting" ||
          event.runReason === "app_tool_failure"
        ) {
          router.refresh();
        }
      } else if (event.runId && event.runStatus) {
        setActiveAppAgentRunIds((current) => {
          const next = new Set(current);
          if (isActiveRunStatus(event.runStatus)) {
            next.add(event.runId!);
          } else {
            next.delete(event.runId!);
          }
          return next;
        });
      }
      if (isAppAgentRunEvent) {
        scheduleAppAgentUsageRefresh(
          event.runStatus === "completed" ? 250 : 120,
        );
      }
      return;
    }

    const targetsCurrentApp = !event.appId || event.appId === appId;
    if (!targetsCurrentApp) return;

    if (
      event.scope === "apps" ||
      event.scope === "reviews" ||
      event.scope === "integrations" ||
      event.scope === "workspace-settings"
    ) {
      scheduleAppStateRefresh();
    }
  }, [
    appId,
    initialToolRecoveryToolName,
    runId,
    router,
    scheduleAppAgentUsageRefresh,
    scheduleAppStateRefresh,
    setBuilderRunStatus,
    workspaceId,
  ]));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAppAgentUsage();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchAppAgentUsage]);

  useEffect(() => {
    return () => {
      if (appStateRefreshTimerRef.current !== null) {
        window.clearTimeout(appStateRefreshTimerRef.current);
        appStateRefreshTimerRef.current = null;
      }
      if (appAgentUsageRefreshTimerRef.current !== null) {
        window.clearTimeout(appAgentUsageRefreshTimerRef.current);
        appAgentUsageRefreshTimerRef.current = null;
      }
      if (agentRunsHintDelayTimerRef.current !== null) {
        window.clearTimeout(agentRunsHintDelayTimerRef.current);
        agentRunsHintDelayTimerRef.current = null;
      }
    };
  }, [appId]);

  // Agent runs dropdown state
  const [agentRunsOpen, setAgentRunsOpen] = useState(false);
  const [firstAppAgentRunDialogOpen, setFirstAppAgentRunDialogOpen] =
    useState(false);
  const dataChangeSequenceRef = useRef(0);
  const [dataExplorerChange, setDataExplorerChange] = useState<
    (AppDataLiveChange & { sequence: number }) | null
  >(null);

  const dismissFirstAppAgentRunDialog = useCallback(() => {
    setFirstAppAgentRunDialogOpen(false);
    if (agentRunsHintDelayTimerRef.current !== null) {
      window.clearTimeout(agentRunsHintDelayTimerRef.current);
    }
    agentRunsHintDelayTimerRef.current = window.setTimeout(() => {
      agentRunsHintDelayTimerRef.current = null;
      setAgentRunsHintOpen(true);
    }, 180);
  }, []);

  const dismissAgentRunsHint = useCallback(() => {
    setAgentRunsHintOpen(false);
    if (agentRunsHintStartedRef.current) {
      window.localStorage.setItem(
        appAgentRunsHintStorageKey(currentUserId),
        "seen",
      );
    }
  }, [currentUserId]);

  const dismissBuilderAgentToggleHint = useCallback(() => {
    setBuilderAgentToggleHintOpen(false);
    window.localStorage.setItem(
      builderAgentToggleHintStorageKey(currentUserId),
      "seen",
    );
  }, [currentUserId]);

  const hideBuilderAgentFromFloatingButton = useCallback(() => {
    setAgentMode("hidden");
    if (
      !window.localStorage.getItem(
        builderAgentToggleHintStorageKey(currentUserId),
      )
    ) {
      setBuilderAgentToggleHintOpen(true);
    }
  }, [currentUserId]);

  const handleAgentRunsOpenChange = useCallback(
    (open: boolean) => {
      setAgentRunsOpen(open);
      if (open) dismissAgentRunsHint();
    },
    [dismissAgentRunsHint],
  );

  // Close agent runs dropdown when iframe gets focus (click inside iframe)
  useEffect(() => {
    if (!agentRunsOpen) return;
    const onBlur = () => {
      if (document.activeElement === iframeRef.current) {
        setAgentRunsOpen(false);
      }
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [agentRunsOpen]);

  useEffect(() => {
    if (!canShowAppAgents) return;
    const controller = new AbortController();
    fetch(`/api/workspaces/${workspaceId}/apps/${appId}/agent-runs`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { runs?: Array<{ id: string; status: string }> } | null) => {
        if (!data?.runs) return;
        const activeIds = data.runs
          .filter((run) => isActiveRunStatus(run.status))
          .map((run) => run.id);
        setActiveAppAgentRunIds(new Set(activeIds));
      })
      .catch(() => {
        // Active app-agent chrome is best effort; realtime events keep it fresh.
      });
    return () => controller.abort();
  }, [appId, canShowAppAgents, workspaceId]);

  useEffect(() => {
    if (!hasActiveAppAgentRuns) return;
    if (agentRunsHintStartedRef.current) return;
    const key = appAgentRunsHintStorageKey(currentUserId);
    if (window.localStorage.getItem(key)) return;
    agentRunsHintStartedRef.current = true;
    const timer = window.setTimeout(() => {
      setAgentRunsHintOpen(false);
      setFirstAppAgentRunDialogOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentUserId, hasActiveAppAgentRuns]);

  // Stream dialog state
  const [streamDialogRun, setStreamDialogRun] = useState<{
    runId: string;
    agentName: string;
    prompt: string;
  } | null>(null);

  const onAgentRunStarted = useCallback(
    (runId: string, agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      const agentName = agent?.name ?? agentId;
      setActiveAgentRuns((prev) => [
        ...prev,
        { runId, agentId, agentName },
      ]);
      setActiveAppAgentRunIds((current) => {
        const next = new Set(current);
        next.add(runId);
        return next;
      });
      scheduleAppAgentUsageRefresh();
    },
    [agents, scheduleAppAgentUsageRefresh],
  );

  const onAgentRunClick = useCallback((run: AgentRunSummary) => {
    dismissAgentRunsHint();
    setAgentRunsOpen(false);
    setStreamDialogRun({
      runId: run.id,
      agentName: run.agentName,
      prompt: run.prompt,
    });
  }, [dismissAgentRunsHint]);

  const onDataChange = useCallback((change: AppDataLiveChange) => {
    dataChangeSequenceRef.current += 1;
    startTransition(() => {
      setDataExplorerChange({
        ...change,
        sequence: dataChangeSequenceRef.current,
      });
    });
  }, []);

  const previewVisibleRef = useRef(previewVisible);
  useEffect(() => {
    previewVisibleRef.current = previewVisible;
  });

  const refreshTimerRef = useRef<number | null>(null);

  const fetchFiles = useCallback(async (version = sourceVersion) => {
    const requestedVersion = version;
    try {
      const params = new URLSearchParams({ version });
      const res = await fetch(
        `/api/workspaces/${workspaceId}/apps/${appId}/files?${params.toString()}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          files: Record<string, string> | null;
          version?: "draft" | "published";
          hasPublishedVersion?: boolean;
          hasDraftChanges?: boolean;
        };
        if (sourceVersionRef.current !== requestedVersion) return;
        setSourceFiles(data.files ?? null);
        if (data.version) selectSourceVersion(data.version);
        if (typeof data.hasPublishedVersion === "boolean") {
          setHasPublishedSnapshot(data.hasPublishedVersion);
        }
        if (typeof data.hasDraftChanges === "boolean") {
          setHasDraftChanges(data.hasDraftChanges);
        }
        if (hasPreviewArtifact(data.files ?? null)) {
          setPreviewVisible(true);
        }
      }
    } catch {
      // Keep the last known snapshot visible if the worker/files API is cold.
    }
  }, [workspaceId, appId, sourceVersion, selectSourceVersion]);

  const scheduleFilesRefresh = useCallback((delayMs = 120, version = sourceVersion) => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void fetchFiles(version);
    }, delayMs);
  }, [fetchFiles, sourceVersion]);

  const switchSourceVersion = useCallback(
    (value: string) => {
      if (value !== "draft" && value !== "published") return;
      if (value === "published" && !hasPublishedSnapshot) return;
      selectSourceVersion(value);
      void fetchFiles(value);
    },
    [fetchFiles, hasPublishedSnapshot, selectSourceVersion],
  );

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const onBuildComplete = useCallback(() => {
    setPreviewVisible(true);
    if (isDraftVersion) {
      setHasDraftChanges(true);
    }
    scheduleFilesRefresh(0);
  }, [isDraftVersion, scheduleFilesRefresh]);

  const onStreamComplete = useCallback(
    (newUsage: RunUsage | null) => {
      if (newUsage) setUsage(newUsage);
      setBuilderRunStatus("completed");
      setToolRecoveryState({ runId, status: null, toolName: null });
      if (previewVisibleRef.current) {
        scheduleFilesRefresh(0);
      }
    },
    [runId, scheduleFilesRefresh, setBuilderRunStatus],
  );

  const onStreamStart = useCallback(() => {
    setBuilderRunStatus("streaming");
  }, [setBuilderRunStatus]);

  const onToolCallComplete = useCallback(() => {
    scheduleFilesRefresh();
  }, [scheduleFilesRefresh]);

  useEffect(() => {
    if (!previewVisible) return;
    if (hasInitialSourceFiles && agentStatus !== "running") return;
    scheduleFilesRefresh(0);
  }, [
    agentStatus,
    hasInitialSourceFiles,
    previewVisible,
    scheduleFilesRefresh,
  ]);

  useEffect(() => {
    const refreshMissingFiles = () => {
      if (hasPreviewArtifact(sourceFilesRef.current)) return;
      scheduleFilesRefresh(0);
    };

    refreshMissingFiles();
    window.addEventListener("pageshow", refreshMissingFiles);
    window.addEventListener("focus", refreshMissingFiles);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshMissingFiles();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", refreshMissingFiles);
      window.removeEventListener("focus", refreshMissingFiles);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [scheduleFilesRefresh]);

  const isInspectorView = mainView !== "preview";
  const showPreview =
    previewVisible &&
    (!isDraftVersion || agentMode !== "full" || isInspectorView);
  const showAgent =
    canCollaborateApp &&
    isDraftVersion &&
    agentMode !== "hidden" &&
    !isInspectorView;
  const panelMode =
    previewVisible && isDraftVersion && agentMode === "panel" && !isInspectorView;
  const canManageWorkspaceIntegrations =
    currentUserRole === "owner" || currentUserRole === "admin";
  const hasBuilderChat = canCollaborateApp && isDraftVersion && Boolean(runId);
  const showTopBar = previewVisible || hasBuilderChat;
  const showPublishDialog =
    previewVisible &&
    isDraftVersion &&
    (!hasPublishedSnapshot ||
      hasDraftChanges ||
      currentPublishStatus !== "published");
  // Published app sharing grants runtime app and app-data access to selected teams.
  // Keep source/data inspector chrome draft-only until app-level RBAC can split those capabilities.
  const showDraftInspectorTools = previewVisible && isDraftVersion;
  const showRunUsage = isDraftVersion;
  const showDraftAgentControls =
    previewVisible && canCollaborateApp && isDraftVersion && !isInspectorView;
  const isBuilderRunActive = isActiveRunStatus(builderRunStatus);
  const activeToolRecoveryStatus = isBuilderRunActive
    ? toolRecoveryStatus
    : null;
  const toolRecoveryLabel = toolRecoveryToolName
    ? `${toolRecoveryToolName} failed - builder fixing it`
    : "Tool call failed - builder fixing it";
  const agentRunsTooltipOpen = agentRunsHintOpen
    ? true
    : agentRunsOpen || streamDialogRun
      ? false
      : undefined;
  const builderAgentToggleTooltipOpen = builderAgentToggleHintOpen
    ? true
    : undefined;
  const restoreAutoExpandedBuilderPanel = useCallback(() => {
    const restoreWidth = autoExpandedBuilderPanelRestoreWidthRef.current;
    if (restoreWidth === null) return;
    autoExpandedBuilderPanelRestoreWidthRef.current = null;
    setBuilderPanelWidth(clampBuilderPanelWidth(restoreWidth));
  }, []);
  useEffect(() => {
    if (isBuilderPanelResizing) return;
    let animationFrame: number | null = null;
    const scheduleBuilderPanelWidth = (width: number) => {
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        setBuilderPanelWidth(clampBuilderPanelWidth(width));
      });
    };

    const shouldExpandForAgentsApproval =
      showAgent &&
      panelMode &&
      !isBuilderRunActive &&
      pendingBuilderApprovalKind === "agents";

    if (!shouldExpandForAgentsApproval) {
      const restoreWidth = autoExpandedBuilderPanelRestoreWidthRef.current;
      if (restoreWidth !== null) {
        autoExpandedBuilderPanelRestoreWidthRef.current = null;
        scheduleBuilderPanelWidth(restoreWidth);
      }
      return () => {
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
        }
      };
    }

    const currentWidth = builderPanelWidthRef.current;
    if (currentWidth >= AGENTS_APPROVAL_PANEL_WIDTH) {
      return () => {
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
        }
      };
    }

    if (autoExpandedBuilderPanelRestoreWidthRef.current === null) {
      autoExpandedBuilderPanelRestoreWidthRef.current = currentWidth;
    }

    const targetWidth = clampBuilderPanelWidth(AGENTS_APPROVAL_PANEL_WIDTH);
    if (targetWidth > currentWidth) {
      scheduleBuilderPanelWidth(targetWidth);
    }

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [
    isBuilderPanelResizing,
    isBuilderRunActive,
    panelMode,
    pendingBuilderApprovalKind,
    showAgent,
  ]);
  const updateBuilderPanelResizeGuide = useCallback((width: number) => {
    if (builderPanelResizeRafRef.current !== null) {
      window.cancelAnimationFrame(builderPanelResizeRafRef.current);
    }
    builderPanelResizeRafRef.current = window.requestAnimationFrame(() => {
      builderPanelResizeRafRef.current = null;
      if (builderPanelResizeGuideRef.current) {
        builderPanelResizeGuideRef.current.style.right = `${width}px`;
      }
    });
  }, []);
  const startBuilderPanelResize = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      autoExpandedBuilderPanelRestoreWidthRef.current = null;

      const startX = event.clientX;
      const startWidth = builderPanelWidth;
      const handle = event.currentTarget;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      builderPanelResizeDraftWidthRef.current = startWidth;
      setIsBuilderPanelResizing(true);
      updateBuilderPanelResizeGuide(startWidth);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // The fixed drag overlay still captures mouse input if pointer capture is unavailable.
      }

      let finished = false;
      const finishResize = () => {
        if (finished) return;
        finished = true;
        if (builderPanelResizeRafRef.current !== null) {
          window.cancelAnimationFrame(builderPanelResizeRafRef.current);
          builderPanelResizeRafRef.current = null;
        }
        setBuilderPanelWidth(builderPanelResizeDraftWidthRef.current);
        setIsBuilderPanelResizing(false);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        try {
          if (handle.hasPointerCapture(event.pointerId)) {
            handle.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Ignore stale capture state after browser-level pointer cancellation.
        }
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", finishResize);
        window.removeEventListener("pointercancel", finishResize);
        window.removeEventListener("blur", finishResize);
      };

      const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
        moveEvent.preventDefault();
        const nextWidth = clampBuilderPanelWidth(
          startWidth + startX - moveEvent.clientX,
        );
        builderPanelResizeDraftWidthRef.current = nextWidth;
        updateBuilderPanelResizeGuide(nextWidth);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", finishResize);
      window.addEventListener("pointercancel", finishResize);
      window.addEventListener("blur", finishResize);
    },
    [builderPanelWidth, updateBuilderPanelResizeGuide],
  );
  const handleBuilderPanelResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      autoExpandedBuilderPanelRestoreWidthRef.current = null;
      const delta = event.shiftKey ? 48 : 24;
      setBuilderPanelWidth((width) =>
        clampBuilderPanelWidth(
          width + (event.key === "ArrowLeft" ? delta : -delta),
        ),
      );
    },
    [],
  );

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {agentRunsHintOpen || builderAgentToggleHintOpen ? (
        <div
          className="fixed inset-0 z-40 bg-background/10 backdrop-blur-[2px] animate-in fade-in-0 duration-150"
          aria-hidden="true"
        />
      ) : null}
      {isBuilderPanelResizing ? (
        <div
          className="fixed inset-0 z-50 cursor-col-resize touch-none select-none"
          aria-hidden="true"
        >
          <div
            ref={builderPanelResizeGuideRef}
            className="absolute inset-y-0 w-px bg-ring shadow-[0_0_0_1px_hsl(var(--ring)/0.28)]"
            style={{ right: builderPanelWidth }}
          />
        </div>
      ) : null}

      {/* Top bar — visible for active chat, with app controls once a preview exists */}
      {showTopBar && (
        <div
          data-second-desktop-drag-region
          className={cn(
            "flex h-11 shrink-0 items-center justify-between border-b bg-background px-3",
            !agentRunsHintOpen && !builderAgentToggleHintOpen && "z-10",
          )}
        >
          {/* Left: status */}
          <div className="flex items-center gap-2">
            {previewVisible ? (
              <>
                {isDraftVersion && activeToolRecoveryStatus === "fixing" ? (
                  <div className="flex h-7 items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 text-xs text-amber-900 dark:text-amber-200">
                    <HammerIcon className="size-3.5 shrink-0" />
                    <span className="max-w-[18rem] truncate">
                      {toolRecoveryLabel}
                    </span>
                    <AppLoader size="xs" />
                  </div>
                ) : isDraftVersion && isBuilderRunActive ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <AppLoader size="xs" />
                    <span>Working...</span>
                  </div>
                ) : null}
                {canCollaborateApp && isDraftVersion && hasPublishedSnapshot ? (
                  <div className="flex min-w-0 items-center gap-1.5 text-xs">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="mr-1 h-7 rounded-full px-2.5 text-xs"
                          onClick={() => switchSourceVersion("published")}
                        >
                          <ArrowLeftIcon data-icon="inline-start" />
                          Back to public app
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        Return to the public version available to selected teams
                      </TooltipContent>
                    </Tooltip>
                    <PencilLine className="size-3.5 shrink-0 text-foreground" />
                    <span className="shrink-0 font-medium text-foreground">
                      Editing draft
                    </span>
                    <span className="min-w-0 truncate text-muted-foreground">
                      Users can only see and interact with the published version and its data.
                    </span>
                  </div>
                ) : null}
                {/* Published badge intentionally hidden for now. The toolbar action already makes the current public view clear. */}
              </>
            ) : activeToolRecoveryStatus === "fixing" ? (
              <div className="flex h-7 items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 text-xs text-amber-900 dark:text-amber-200">
                <HammerIcon className="size-3.5 shrink-0" />
                <span className="max-w-[18rem] truncate">
                  {toolRecoveryLabel}
                </span>
                <AppLoader size="xs" />
              </div>
            ) : isBuilderRunActive ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AppLoader size="xs" />
                <span>Working...</span>
              </div>
            ) : (
              <div aria-hidden="true" />
            )}
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-0.5">
            {previewVisible && showPublishDialog ? (
              <AppPublishDialog
                workspaceId={workspaceId}
                appId={appId}
                authMode={authMode}
                currentUserRole={currentUserRole}
                canManageApp={canManageApp}
                publishStatus={currentPublishStatus}
                hasPublishedVersion={hasPublishedSnapshot}
                hasDraftChanges={hasDraftChanges}
                changeRequestMessage={currentChangeRequestMessage}
                appTeamIds={liveAppTeamIds}
                teams={teams}
                integrations={livePublishIntegrations}
                onSubmitted={() => void fetchAppState()}
              />
            ) : null}
            {canShowAppAgents ? (
              <div className={cn("relative", agentRunsHintOpen && "z-[60]")}>
                <DropdownMenu open={agentRunsOpen} onOpenChange={handleAgentRunsOpenChange} modal={false}>
                  <Tooltip open={agentRunsTooltipOpen}>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-7 rounded-full px-2.5 text-xs"
                          aria-label={agentRunsButtonLabel}
                          onClick={() => {
                            if (agentRunsHintOpen) dismissAgentRunsHint();
                          }}
                        >
                          {hasActiveAppAgentRuns ? (
                            <span data-icon="inline-start" className="inline-flex">
                              <AppLoader size="xs" interactive={false} />
                            </span>
                          ) : (
                            <BotIcon data-icon="inline-start" strokeWidth={1.5} />
                          )}
                          {agentRunsButtonLabel}
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className={agentRunsHintOpen ? "pointer-events-auto cursor-pointer select-none" : undefined}
                      onClick={() => {
                        if (agentRunsHintOpen) dismissAgentRunsHint();
                      }}
                    >
                      {agentRunsHintOpen
                        ? "Agents running in apps will show up here."
                        : hasActiveAppAgentRuns
                          ? `${activeAppAgentRunCount} app agent${activeAppAgentRunCount === 1 ? "" : "s"} running`
                          : "View app agent runs"}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" side="bottom" className="w-[400px] p-0 z-[60]">
                    <RecoverableErrorBoundary
                      name="AppWorkspace.AgentRunList"
                      resetKey={`${appId}:agent-runs`}
                      className="min-h-[220px]"
                    >
                      <AgentRunList
                        workspaceId={workspaceId}
                        appId={appId}
                        onRunClick={onAgentRunClick}
                      />
                    </RecoverableErrorBoundary>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}
            {(previewVisible && showPublishDialog) || canShowAppAgents ? (
              <BarSeparator />
            ) : null}

            {previewVisible && canCollaborateApp && hasPublishedSnapshot && !isDraftVersion ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 rounded-full px-2.5 text-xs"
                      onClick={() => {
                        switchSourceVersion("draft");
                        setAgentMode((mode) => (mode === "hidden" ? "panel" : mode));
                        setChatFocusRequest((current) => current + 1);
                      }}
                    >
                      <PencilLine data-icon="inline-start" />
                      Edit app
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Open the editable draft
                  </TooltipContent>
                </Tooltip>
                <BarSeparator />
              </>
            ) : null}

            {showDraftInspectorTools ? (
              <>
                {/* Draft inspectors are intentionally hidden from published mode.
                   Sharing an app grants runtime access to its data today; future app-level RBAC can expose finer controls. */}
                <BarTooltipButton
                  icon={FolderClosed}
                  label={mainView === "files" ? "Show preview" : "File explorer"}
                  activeLabel="File explorer"
                  active={mainView === "files"}
                  onClick={() => setMainView((v) => v === "files" ? "preview" : "files")}
                />
                <BarTooltipButton
                  icon={Database}
                  label={mainView === "data" ? "Show preview" : "Data explorer"}
                  activeLabel="Data explorer"
                  active={mainView === "data"}
                  onClick={() => setMainView((v) => v === "data" ? "preview" : "data")}
                />
                <BarSeparator />
              </>
            ) : null}

              {/* --- Collaboration --- */}
              <AppCollaboratorsDialog
                workspaceId={workspaceId}
                appId={appId}
                creatorUserId={appCreatorUserId}
                collaboratorUserIds={liveCollaboratorUserIds}
                canManageCollaborators={canManageCollaborators}
                showLabel={!previewVisible}
              />

              {showRunUsage || showDraftAgentControls ? (
                <BarSeparator />
              ) : null}

              {/* --- Agent controls --- */}

              {/* Run cost info */}
              {showRunUsage ? (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="rounded-full text-muted-foreground"
                          aria-label="App usage"
                        >
                          <Info className="size-3.5" strokeWidth={1.5} />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      View app usage and cost
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" side="bottom" className="w-72">
                    {usage || appAgentUsage ? (
                      <div className="flex flex-col gap-2.5 p-2">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-medium">App cost</span>
                          <span className="flex items-baseline gap-1.5">
                            {combinedHasLocalSubscriptionCostMode && (
                              <span className="text-sm font-semibold text-muted-foreground line-through decoration-muted-foreground/40">
                                {formatUsd(
                                  combinedLocalSubscriptionEstimatedCostUsd > 0
                                    ? combinedLocalSubscriptionEstimatedCostUsd
                                    : combinedEstimatedCostUsd,
                                )}
                              </span>
                            )}
                            <span className="text-sm font-semibold">
                              {formatUsd(combinedBillableCostUsd)}
                            </span>
                          </span>
                        </div>
                        <div className="flex flex-col gap-1 text-xs">
                          {usage ? (
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">
                                Builder run
                              </span>
                              <span className="font-medium">
                                {formatUsd(billableRunCostUsd)}
                              </span>
                            </div>
                          ) : null}
                          {appAgentUsage ? (
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">
                                {appAgentUsageSummary?.usageRunCount
                                  ? `App agents (${appAgentUsageSummary.usageRunCount})`
                                  : "App agents"}
                              </span>
                              <span className="font-medium">
                                {formatUsd(appAgentBillableCostUsd)}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                          {usage ? (
                            <>
                              <span>Builder tokens</span>
                              <span className="text-right font-mono">
                                {formatTokens(usageTokenCount(usage))}
                              </span>
                            </>
                          ) : null}
                          {appAgentUsage ? (
                            <>
                              <span>App agent tokens</span>
                              <span className="text-right font-mono">
                                {formatTokens(usageTokenCount(appAgentUsage))}
                              </span>
                            </>
                          ) : null}
                        </div>
                        <UsageModelBreakdown
                          label="Builder by model"
                          entries={modelUsageDisplayEntries}
                        />
                        <UsageModelBreakdown
                          label="App agents by model"
                          entries={appAgentModelUsageDisplayEntries}
                        />
                        {combinedLocalSubscriptionLabel && (
                          <>
                            <div className="h-px bg-border/50" />
                            <p className="text-[10px] text-muted-foreground leading-relaxed">
                              {combinedLocalSubscriptionLabel}
                            </p>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="p-2 text-xs text-muted-foreground">
                        No usage data yet
                      </div>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}

              {showDraftAgentControls && (
                <>
                  {/* Expand / collapse agent full-width */}
                  <BarTooltipButton
                    icon={agentMode === "full" ? Minimize2 : Maximize2}
                    label={
                      agentMode === "full" ? "Collapse agent" : "Expand agent"
                    }
                    active={agentMode === "full"}
                    onClick={() =>
                      setAgentMode((m) => (m === "full" ? "panel" : "full"))
                    }
                  />

                  {/* Toggle agent panel */}
                  <div className={cn("relative", builderAgentToggleHintOpen && "z-[60]")}>
                    <BarTooltipButton
                      icon={agentMode === "hidden" ? PanelLeftClose : PanelLeftOpen}
                      label={
                        agentMode === "hidden" ? "Show agent" : "Hide agent"
                      }
                      active={agentMode !== "hidden"}
                      className="size-[26px]"
                      iconClassName="size-3.5"
                      tooltipOpen={builderAgentToggleTooltipOpen}
                      tooltipContent={
                        builderAgentToggleHintOpen
                          ? "You can always show the agent panel again by clicking this button."
                          : undefined
                      }
                      onClick={() => {
                        if (builderAgentToggleHintOpen) {
                          dismissBuilderAgentToggleHint();
                        }
                        setAgentMode((m) => (m === "hidden" ? "panel" : "hidden"));
                      }}
                    />
                  </div>
                </>
              )}
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main pane: preview or file explorer */}
        {showPreview && (
          <div
            className="flex-1 min-w-0 min-h-0 overflow-hidden bg-background"
            onPointerEnter={() => setBuilderDividerTooltip(null)}
            onMouseEnter={() => setBuilderDividerTooltip(null)}
          >
            <RecoverableErrorBoundary
              name="AppWorkspace.MainPane"
              resetKey={`${appId}:${sourceVersion}:${mainView}:${sourceFiles ? Object.keys(sourceFiles).length : 0}`}
            >
              {/* Source and data inspectors stay draft-only. Sharing an app can expose the app's runtime data to its selected teams today, which is acceptable inside the workspace until app-level RBAC is introduced. */}
              {isDraftVersion && mainView === "files" ? (
                <AppFileExplorer files={sourceFiles} />
              ) : isDraftVersion && mainView === "data" ? (
                <AppDataExplorer
                  workspaceId={workspaceId}
                  appId={appId}
                  sourceVersion={sourceVersion}
                  change={dataExplorerChange}
                />
              ) : (
                <AppPreview
                  key={`${appId}:${sourceVersion}:${Number(appRuntimeSettings.allowIframeScripts)}:${Number(appRuntimeSettings.allowIframeClipboard)}:${Number(appRuntimeSettings.allowIframeExternalLinks)}`}
                  files={sourceFiles}
                  iframeRef={iframeRef}
                  runtimeSettings={appRuntimeSettings}
                />
              )}
            </RecoverableErrorBoundary>
            {mainView !== "files" && (
              <>
                <AppDataBridge
                  workspaceId={workspaceId}
                  appId={appId}
                  sourceVersion={sourceVersion}
                  iframeRef={iframeRef}
                  onDataChange={
                    isDraftVersion && mainView === "data"
                      ? onDataChange
                      : undefined
                  }
                />
                <AppIntegrationBridge
                  workspaceId={workspaceId}
                  appId={appId}
                  sourceVersion={sourceVersion}
                  iframeRef={iframeRef}
                />
              </>
            )}
            {canShowAppAgents && (
              <AppAgentBridge
                workspaceId={workspaceId}
                appId={appId}
                sourceVersion={sourceVersion}
                iframeRef={iframeRef}
                agents={agents}
                onAgentRunStarted={onAgentRunStarted}
              />
            )}
          </div>
        )}

        {/* Chat pane — always in the DOM, visibility via CSS */}
        {showAgent && panelMode && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize builder agent sidebar"
            aria-valuemin={MIN_BUILDER_PANEL_WIDTH}
            aria-valuenow={Math.round(builderPanelWidth)}
            tabIndex={0}
            className="group relative w-1 shrink-0 cursor-col-resize touch-none bg-transparent outline-none"
            onPointerDown={startBuilderPanelResize}
            onKeyDown={handleBuilderPanelResizeKeyDown}
            onDoubleClick={() => {
              autoExpandedBuilderPanelRestoreWidthRef.current = null;
              setBuilderPanelWidth(DEFAULT_BUILDER_PANEL_WIDTH);
            }}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-foreground/20 group-focus-visible:bg-ring group-active:bg-ring" />
            <Tooltip
              delayDuration={0}
              open={builderDividerTooltip === "hide"}
              onOpenChange={(open) =>
                setBuilderDividerTooltip(open ? "hide" : null)
              }
            >
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="builder-agent-divider-button absolute left-1/2 top-[calc(50%-20px)] z-20 inline-flex size-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border/55 bg-white text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 dark:border-white/10 dark:bg-[#18191B] dark:hover:bg-muted"
                  aria-label="Hide agent"
                  onPointerEnter={() => setBuilderDividerTooltip("hide")}
                  onPointerLeave={() => setBuilderDividerTooltip(null)}
                  onFocus={() => setBuilderDividerTooltip("hide")}
                  onBlur={() => setBuilderDividerTooltip(null)}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setBuilderDividerTooltip(null);
                  }}
                  onClick={hideBuilderAgentFromFloatingButton}
                >
                  <PanelLeftOpen className="size-3.5" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={8}>Hide agent</TooltipContent>
            </Tooltip>
            <Tooltip
              delayDuration={0}
              open={builderDividerTooltip === "resize"}
              onOpenChange={(open) =>
                setBuilderDividerTooltip(open ? "resize" : null)
              }
            >
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="builder-agent-divider-button absolute left-1/2 top-[calc(50%+20px)] z-20 inline-flex size-[26px] -translate-x-1/2 -translate-y-1/2 cursor-col-resize items-center justify-center rounded-full border border-border/55 bg-white text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 dark:border-white/10 dark:bg-[#18191B] dark:hover:bg-muted"
                  aria-label="Drag to resize agent panel"
                  onPointerEnter={() => setBuilderDividerTooltip("resize")}
                  onPointerLeave={() => setBuilderDividerTooltip(null)}
                  onFocus={() => setBuilderDividerTooltip("resize")}
                  onBlur={() => setBuilderDividerTooltip(null)}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setBuilderDividerTooltip(null);
                    startBuilderPanelResize(event);
                  }}
                  onClick={(event) => event.preventDefault()}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-4 items-center gap-[3px]"
                  >
                    <span className="h-3.5 w-px rounded-full bg-current opacity-70" />
                    <span className="h-3.5 w-px rounded-full bg-current opacity-70" />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={8}>
                Drag to resize
              </TooltipContent>
            </Tooltip>
          </div>
        )}
        <div
          className={cn(
            !canCollaborateApp
              ? "hidden"
              : !isDraftVersion
                ? "hidden"
                : !previewVisible
                  ? "flex-1 flex flex-col"
                  : showAgent
                    ? panelMode
                      ? "relative shrink-0 flex flex-col"
                      : "relative flex-1 flex flex-col"
                    : "hidden",
            showAgent &&
              panelMode &&
              !isBuilderPanelResizing &&
              "transition-[width] duration-200 ease-out",
          )}
          style={showAgent && panelMode ? { width: builderPanelWidth } : undefined}
        >
          {canCollaborateApp ? (
            <RecoverableErrorBoundary
              name="AppWorkspace.AppChat"
              resetKey={`${appId}:${runId ?? "no-run"}:${initialAutoStartKey ?? "no-autostart"}`}
            >
              <AppChat
                workspaceId={workspaceId}
                appId={appId}
                appName={appName}
                initialPrompt={initialPrompt}
                autoStartPrompt={initialAutoStartPrompt}
                autoStartKey={initialAutoStartKey}
                runId={runId}
                initialMessages={initialMessages}
                initialRunAttachments={initialRunAttachments}
                runStatus={builderRunStatus}
                initialRunFailure={initialRunFailure}
                toolRecoveryStatus={activeToolRecoveryStatus}
                toolRecoveryToolName={toolRecoveryToolName}
                panelMode={panelMode}
                onBuildComplete={onBuildComplete}
                onStreamComplete={onStreamComplete}
                onStreamStart={onStreamStart}
                onToolCallComplete={onToolCallComplete}
                onPendingApprovalChange={setPendingBuilderApprovalKind}
                onApprovalAction={restoreAutoExpandedBuilderPanel}
                onReviewInvalidated={() => {
                  setInvalidatedReviewKey(reviewRequestedKey ?? "active");
                  setLocalDraftStarted(true);
                  setHasDraftChanges(true);
                  selectSourceVersion("draft");
                }}
                onDraftCreatedFromPublished={() => {
                  setLocalDraftStarted(true);
                  setHasDraftChanges(true);
                  selectSourceVersion("draft");
                }}
                canApproveAgentConfig={
                  canCollaborateApp
                }
                agentConfigApprovalMode={
                  canManageWorkspaceIntegrations
                    ? "live"
                    : "mock"
                }
                agentsJsonApprovalSource={liveAgentsJsonApprovalSource}
                canManageIntegrations={canManageWorkspaceIntegrations}
                initialRuntimeSettings={initialRuntimeSettings}
                focusComposerKey={chatFocusRequest}
                dropEnabled={showAgent || !previewVisible}
              />
            </RecoverableErrorBoundary>
          ) : null}
        </div>
      </div>

      <FirstAppAgentRunDialog
        open={firstAppAgentRunDialogOpen}
        onDismiss={dismissFirstAppAgentRunDialog}
      />

      {/* Agent stream dialog */}
      <RecoverableErrorBoundary
        name="AppWorkspace.AgentStreamDialog"
        resetKey={streamDialogRun?.runId ?? "closed"}
      >
        <AgentStreamDialog
          open={!!streamDialogRun}
          onClose={() => setStreamDialogRun(null)}
          workspaceId={workspaceId}
          appId={appId}
          runId={streamDialogRun?.runId ?? ""}
          agentName={streamDialogRun?.agentName ?? ""}
          prompt={streamDialogRun?.prompt ?? ""}
        />
      </RecoverableErrorBoundary>
    </div>
  );
}
