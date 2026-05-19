"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { toast } from "sonner";
import {
  Component,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ErrorInfo,
} from "react";
import { flushSync } from "react-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { StickToBottom } from "use-stick-to-bottom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ArrowUp,
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileIcon,
  HammerIcon,
  Info,
  Pause,
  PencilIcon,
  Plus,
  PlugZapIcon,
  RotateCcw,
} from "lucide-react";
import { AppLoader } from "@/components/app-loader";
import { ModelSelector } from "@/components/model-selector";
import { RuntimeParameterSelectors } from "@/components/runtime-parameter-selectors";
import {
  DEFAULT_RUNTIME_SETTINGS,
  normalizeRuntimeSettings,
  type AgentRuntimeSettings,
} from "@/lib/agent/runtime-registry";
import {
  isDoneBuildingSuccessOutput,
  parseDoneBuildingOutput,
} from "@/lib/agent/done-building";
import type {
  AgentRunFailure,
  AgentsJsonApprovalSource,
  RunUsage,
} from "@/lib/db/types";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { LinkChip } from "@/components/ai-elements/link-chip";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import { Terminal } from "@/components/ai-elements/terminal";
import { PlanCard, type PlanData } from "@/components/ai-elements/plan-card";
import {
  SuggestionsCard,
  type BuildSuggestion,
} from "@/components/ai-elements/suggestions-card";
import { AgentsCard, type AgentsCardData } from "@/components/ai-elements/agents-card";
import { ToolCard, hasToolCard } from "@/components/ai-elements/tool-card";
import {
  AppDataToolCard,
  CustomToolCard,
} from "@/components/ai-elements/custom-tool-card";
import { AppIntegrationKeysToolCard } from "@/components/ai-elements/workspace-integrations-tool-card";
import { SkillToolCard } from "@/components/ai-elements/skill-tool-card";
import {
  AttachmentDropOverlay,
  ComposerAttachmentList,
  attachmentReference,
  createComposerAttachment,
  uploadComposerAttachments,
  useWindowFileDrop,
  type ComposerAttachment,
} from "@/components/composer-attachments";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { integrationIconUrl } from "@/lib/integration-icons";
import {
  integrationRouteSegment,
  normalizeIntegrationDomain as normalizeDomain,
} from "@/lib/integration-routes";
import {
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_FILES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  formatAttachmentSize,
  type AttachmentReference,
} from "@/lib/attachments";
import { useWorkspaceRealtimeEvent } from "@/components/workspace-realtime-provider";
import {
  captureAnalyticsEvent,
  runtimeModelFamily,
  textAnalyticsProperties,
  type AnalyticsProperties,
} from "@/lib/analytics";
import { reportClientError } from "@/lib/client-error-reporting";

// Hoist stable refs so react-markdown doesn't re-parse unchanged text on every render
const REMARK_PLUGINS = [remarkGfm];
const MD_COMPONENTS = {
  code: CodeBlock,
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  a: LinkChip,
};

const REVIEW_INVALIDATED_HEADER = "x-second-review-invalidated";
const DRAFT_CREATED_HEADER = "x-second-draft-created";
const COMPOSER_TEXTAREA_MIN_HEIGHT = 72;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 24 * 5;

/** Memoized Markdown wrapper — prevents re-parsing when text hasn't changed. */
const MemoMarkdown = memo(function MemoMarkdown({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
      {text}
    </Markdown>
  );
});

function WorkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <AppLoader size="sm" />
      <span className="working-text-shimmer">
        Working
      </span>
    </div>
  );
}

function ChatFailureRow({
  message,
  retryable,
  retryDisabled,
  onRetry,
  tone = "danger",
  actionLabel = "Try again",
}: {
  message: string;
  retryable: boolean;
  retryDisabled: boolean;
  onRetry: () => void;
  tone?: "danger" | "neutral";
  actionLabel?: string;
}) {
  const Icon = tone === "neutral" ? Info : AlertTriangleIcon;
  return (
    <div
      className={cn(
        "not-prose flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-foreground",
        tone === "neutral"
          ? "border-border bg-background"
          : "border-destructive/20 bg-destructive/5",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          tone === "neutral" ? "text-muted-foreground" : "text-destructive",
        )}
        strokeWidth={1.8}
      />
      <span className="min-w-0 flex-1 text-[13px] leading-5 text-muted-foreground">
        {message}
      </span>
      {retryable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs"
          disabled={retryDisabled}
          onClick={onRetry}
        >
          <RotateCcw className="size-3.5" strokeWidth={1.8} />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function messageText(message: UIMessage): string {
  const chunks: string[] = [];
  for (const part of message.parts ?? []) {
    if (part?.type === "text" && typeof part.text === "string") {
      chunks.push(part.text);
    }
  }
  return chunks.join("");
}

type UserTurn = {
  index: number;
  message: UIMessage;
  text: string;
};

function assistantHasVisibleContent(message: UIMessage): boolean {
  return (message.parts ?? []).some((part) => {
    if (!part || typeof part !== "object") return false;
    if (part.type === "text") return part.text.trim().length > 0;
    if (part.type === "reasoning") return part.text.trim().length > 0;
    return part.type === "dynamic-tool";
  });
}

function assistantTurnHasEnded(
  messages: UIMessage[],
  assistantIndex: number,
): boolean {
  for (let index = assistantIndex + 1; index < messages.length; index += 1) {
    const role = messages[index]?.role;
    if (role === "user" || role === "assistant") return true;
  }
  return false;
}

function findUserTurnBeforeMessage(
  messages: UIMessage[],
  messageId: string,
): UserTurn | null {
  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex <= 0) return null;

  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const text = messageText(message).trim();
    if (text) return { index, message, text };
  }

  return null;
}

function messageWithEditedText(message: UIMessage, text: string): UIMessage {
  return {
    ...message,
    parts: [{ type: "text", text }],
  };
}

function MessageActionButton({
  label,
  icon: Icon,
  onClick,
  disabled = false,
  active = false,
  activeIcon,
}: {
  label: string;
  icon: typeof CopyIcon;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  activeIcon?: typeof CheckIcon;
}) {
  const ActiveIcon = activeIcon;
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8 rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <span className="relative flex size-4 items-center justify-center">
            <Icon
              className={cn(
                "absolute size-4 transition-all duration-100 ease-out",
                active ? "scale-75 opacity-0" : "scale-100 opacity-100",
              )}
              strokeWidth={1.8}
            />
            {ActiveIcon ? (
              <ActiveIcon
                className={cn(
                  "absolute size-4 text-muted-foreground transition-all duration-100 ease-out",
                  active ? "scale-100 opacity-100" : "scale-75 opacity-0",
                )}
                strokeWidth={1.9}
              />
            ) : null}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="font-medium">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function UserMessageEditor({
  value,
  attachments,
  disabled,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: string;
  attachments: AttachmentReference[];
  disabled: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const editRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = editRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  useLayoutEffect(() => {
    const textarea = editRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(68, textarea.scrollHeight)}px`;
  }, [value]);

  return (
    <form
      className="relative w-full rounded-2xl"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="composer-gradient-border-short absolute -inset-[1px] rounded-2xl" />
      <div
        className="relative flex flex-col rounded-2xl bg-[var(--composer-bg)]"
        style={{ boxShadow: "var(--composer-shadow)" }}
      >
        <textarea
          ref={editRef}
          value={value}
          disabled={disabled}
          rows={2}
          className="min-h-[68px] w-full resize-none overflow-hidden bg-transparent px-[22px] pt-[14px] pb-1 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
          style={{ fontFamily: "inherit" }}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        <div className={cn(
          "px-[14px]",
          attachments.length > 0 ? "pb-2" : "hidden",
        )}>
          <UserMessageAttachments attachments={attachments} />
        </div>
        <div className="flex justify-end gap-2 px-3.5 pb-3 pt-0.5">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-full px-4"
            disabled={disabled}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="h-9 rounded-full px-4"
            disabled={disabled || value.trim().length === 0}
          >
            Send
          </Button>
        </div>
      </div>
    </form>
  );
}

function attachmentReferencesFromValue(value: unknown): AttachmentReference[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_ATTACHMENT_FILES).flatMap((item): AttachmentReference[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const size =
      typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0
        ? record.size
        : null;
    const contentType =
      typeof record.contentType === "string" ? record.contentType.trim() : undefined;

    if (
      !id ||
      !name ||
      size === null ||
      !path.startsWith("attachments/") ||
      path.split("/").includes("..") ||
      path.includes("\0")
    ) {
      return [];
    }

    return [{
      id,
      name,
      path,
      size,
      ...(contentType ? { contentType } : {}),
    }];
  });
}

function messageAttachments(message: UIMessage): AttachmentReference[] {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }
  return attachmentReferencesFromValue(
    (metadata as Record<string, unknown>).attachments,
  );
}

function UserMessageAttachments({
  attachments,
}: {
  attachments: AttachmentReference[];
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-2 py-1.5 text-left shadow-[0_1px_0_rgba(0,0,0,0.03)]"
        >
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/30 text-muted-foreground">
            <FileIcon className="size-3.5" strokeWidth={1.7} />
          </div>
          <span className="min-w-0 max-w-[260px] truncate font-medium text-foreground">
            {attachment.name}
          </span>
          <span className="mt-[5.5px] shrink-0 text-[11px] text-muted-foreground">
            {formatAttachmentSize(attachment.size)}
          </span>
        </div>
      ))}
    </div>
  );
}

function isAttachmentOnlyPlaceholder(text: string, attachments: AttachmentReference[]): boolean {
  return attachments.length > 0 && text.trim() === "Use the attached files.";
}

/** Catches render errors in streaming parts without crashing the whole chat. */
class PartErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[PartErrorBoundary]", error.message, info.componentStack);
    void reportClientError({
      source: "component-error-boundary",
      error,
      componentStack: info.componentStack,
      context: { component: "AppChat.PartErrorBoundary" },
    });
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}


type AppChatProps = {
  workspaceId: string;
  appId: string;
  appName: string;
  /** Full user prompt from the composer (may be longer than appName) */
  initialPrompt?: string;
  /** Platform-scheduled prompt that should be sent as the next message in this run. */
  autoStartPrompt?: string | null;
  autoStartKey?: string | null;
  runId: string | null;
  initialMessages: UIMessage[];
  initialRunAttachments?: AttachmentReference[];
  runStatus: "pending" | "streaming" | "completed" | "failed" | null;
  initialRunFailure?: AgentRunFailure | null;
  toolRecoveryStatus?: "fixing" | null;
  toolRecoveryToolName?: string | null;
  /** When true, renders in narrow side-panel mode (360px). */
  panelMode?: boolean;
  /** Called when done_building tool is detected in the stream */
  onBuildComplete?: () => void;
  /** Called when streaming completes with fresh usage data */
  onStreamComplete?: (usage: RunUsage | null) => void;
  /** Called when streaming starts */
  onStreamStart?: () => void;
  /** Called when any tool call reaches output-available */
  onToolCallComplete?: (toolName: string, toolCallId: string) => void;
  /** Called when a new builder message closes a pending app review */
  onReviewInvalidated?: () => void;
  /** Called when editing a published app creates an unpublished draft */
  onDraftCreatedFromPublished?: () => void;
  /** True when the current builder can approve the presented agents.json enough to continue. */
  canApproveAgentConfig?: boolean;
  /** Members can approve only a mock-data draft runtime; admins/owners grant live draft runtime. */
  agentConfigApprovalMode?: "live" | "mock";
  /** Persisted source for the current draft agents.json approval. */
  agentsJsonApprovalSource?: AgentsJsonApprovalSource | null;
  /** True for workspace owners/admins who can connect real integration credentials. */
  canManageIntegrations?: boolean;
  /** Persisted agent settings from the app document */
  initialRuntimeSettings?: AgentRuntimeSettings;
  /** Increment to focus the builder composer from parent toolbar actions. */
  focusComposerKey?: number;
  /** Enables window-level drop handling when this composer is visible. */
  dropEnabled?: boolean;
};

type IntegrationSetupPermissionGroup = {
  name: string;
  permissions: string[];
};

type IntegrationSetupSecret = {
  name: string;
  required?: boolean;
};

type IntegrationSetupItem = {
  name: string;
  domain: string;
  iconUrl?: string;
  faviconUrl?: string;
  keySlug?: string;
  auth?: {
    providerKey?: string;
    scopes?: string[];
  } | null;
  permissionGroups: IntegrationSetupPermissionGroup[];
  secrets: IntegrationSetupSecret[];
};

type AppIntegrationKeyStatus = {
  appId?: string;
  id: string;
  name: string;
  domain: string;
  appName?: string;
  capabilityLabel?: string;
  keySlug?: string;
  authType?: "static_secret" | "oauth2";
  configured: boolean;
  oauth?: {
    providerConfigured: boolean;
    providerConfigMatchesGrant: boolean;
    currentUserConnected: boolean;
  } | null;
  configuredPermissionGroups: IntegrationSetupPermissionGroup[];
  configuredSecrets: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function chatAnalyticsSummary(messages: UIMessage[]) {
  const toolCallIds = new Set<string>();
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  for (const message of messages) {
    if (message.role === "user") userMessageCount += 1;
    if (message.role === "assistant") assistantMessageCount += 1;

    for (const part of message.parts ?? []) {
      const record = asRecord(part);
      if (
        record?.type === "dynamic-tool" &&
        typeof record.toolCallId === "string" &&
        record.toolCallId
      ) {
        toolCallIds.add(record.toolCallId);
      }
    }
  }

  return {
    message_count: messages.length,
    user_message_count: userMessageCount,
    assistant_message_count: assistantMessageCount,
    tool_call_count: toolCallIds.size,
  };
}

function integrationSetupAnalyticsProperties(
  integrations: IntegrationSetupItem[],
  connectableOAuthIntegration?: AppIntegrationKeyStatus | null,
) {
  const permissionCount = integrations.reduce(
    (sum, integration) =>
      sum +
      integration.permissionGroups.reduce(
        (groupSum, group) => groupSum + group.permissions.length,
        0,
      ),
    0,
  );
  const requiredSecretCount = integrations.reduce(
    (sum, integration) =>
      sum + integration.secrets.filter((secret) => secret.required !== false).length,
    0,
  );
  const optionalSecretCount = integrations.reduce(
    (sum, integration) =>
      sum + integration.secrets.filter((secret) => secret.required === false).length,
    0,
  );
  const hasOAuth =
    Boolean(connectableOAuthIntegration) ||
    integrations.some((integration) => Boolean(integration.auth?.providerKey));
  const hasStaticSecret = integrations.some(
    (integration) => integration.secrets.length > 0,
  );

  return {
    integration_count: integrations.length,
    permission_count: permissionCount,
    required_secret_count: requiredSecretCount,
    optional_secret_count: optionalSecretCount,
    auth_kind: hasOAuth && hasStaticSecret
      ? "mixed"
      : hasOAuth
        ? "oauth"
        : hasStaticSecret
          ? "static_secret"
          : "none",
  };
}

function parseJsonText(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseToolTextOutput(output: unknown): unknown {
  if (typeof output === "string") {
    return parseJsonText(output) ?? output;
  }

  if (Array.isArray(output)) {
    const textPart = output.find((item) => {
      const part = asRecord(item);
      return part?.type === "text" && typeof part.text === "string";
    });
    const text = asRecord(textPart)?.text;
    if (typeof text === "string") {
      return parseJsonText(text) ?? text;
    }
  }

  const record = asRecord(output);
  const content = record?.content;
  if (Array.isArray(content)) {
    const textPart = content.find((item) => {
      const part = asRecord(item);
      return part?.type === "text" && typeof part.text === "string";
    });
    const text = asRecord(textPart)?.text;
    if (typeof text === "string") {
      return parseJsonText(text) ?? text;
    }
  }

  return output;
}

function agentsFromPresentAgentsOutput(output: unknown): AgentsCardData["agents"] {
  const parsed = parseToolTextOutput(output);
  const record = asRecord(parsed);
  return Array.isArray(record?.agents)
    ? (record.agents as AgentsCardData["agents"])
    : [];
}

function agentsFromPresentAgentsInput(input: unknown): AgentsCardData["agents"] {
  const record = asRecord(input);
  return Array.isArray(record?.agents)
    ? (record.agents as AgentsCardData["agents"])
    : [];
}

const LEGACY_SUGGESTION_ICON_EMOJI: Record<string, string> = {
  "app-window": "🧩",
  appwindow: "🧩",
  "bar-chart-3": "📊",
  barchart3: "📊",
  bot: "🤖",
  "calendar-days": "📅",
  calendardays: "📅",
  "check-square": "✅",
  checksquare: "✅",
  "clipboard-list": "📋",
  clipboardlist: "📋",
  database: "🗄️",
  "file-text": "📄",
  filetext: "📄",
  gauge: "📊",
  "grid-2x2": "🧩",
  grid2x2: "🧩",
  "layout-grid": "🧩",
  layoutgrid: "🧩",
  "line-chart": "📈",
  linechart: "📈",
  mail: "✉️",
  "message-square": "💬",
  messagesquare: "💬",
  search: "🔎",
  "shield-check": "🛡️",
  shieldcheck: "🛡️",
  sparkles: "✨",
  table2: "📊",
  "table-2": "📊",
  users: "👥",
  workflow: "⚙️",
  zap: "⚡",
};

function legacySuggestionIconKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .replace(/-?icon$/i, "")
    .toLowerCase();
}

function suggestionEmojiFromRecord(record: Record<string, unknown>): string | null {
  const emoji = typeof record.emoji === "string" ? record.emoji.trim() : "";
  const icon = typeof record.icon === "string" ? record.icon.trim() : "";
  if (emoji) {
    return LEGACY_SUGGESTION_ICON_EMOJI[legacySuggestionIconKey(emoji)] ?? emoji;
  }
  if (icon) {
    return LEGACY_SUGGESTION_ICON_EMOJI[legacySuggestionIconKey(icon)] ?? null;
  }
  return null;
}

function normalizeBuildSuggestions(value: unknown): BuildSuggestion[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): BuildSuggestion | null => {
      const record = asRecord(item);
      if (!record) return null;

      const title = typeof record.title === "string" ? record.title.trim() : "";
      const subtitle =
        typeof record.subtitle === "string"
          ? record.subtitle.trim()
          : typeof record.description === "string"
            ? record.description.trim()
            : "";

      if (!title || !subtitle) return null;

      return {
        emoji: suggestionEmojiFromRecord(record),
        title,
        subtitle,
      };
    })
    .filter((item): item is BuildSuggestion => item !== null)
    .slice(0, 6);
}

function suggestionsFromPresentSuggestionsOutput(output: unknown): BuildSuggestion[] {
  const parsed = parseToolTextOutput(output);
  const record = asRecord(parsed);
  return normalizeBuildSuggestions(record?.suggestions);
}

function suggestionsFromPresentSuggestionsInput(input: unknown): BuildSuggestion[] {
  const parsed = parseToolTextOutput(input);
  const record = asRecord(parsed);
  return normalizeBuildSuggestions(record?.suggestions);
}

function planDataFromPresentPlanInput(input: unknown): PlanData {
  const toolInput = asRecord(input);
  return {
    overview:
      typeof toolInput?.overview === "string"
        ? toolInput.overview
        : null,
    features: Array.isArray(toolInput?.features)
      ? (toolInput.features as { name: string; description: string }[])
      : null,
    dataFlow:
      typeof toolInput?.dataFlow === "string"
        ? toolInput.dataFlow
        : null,
    agents:
      typeof toolInput?.agents === "string"
        ? toolInput.agents
        : null,
    backend:
      typeof toolInput?.backend === "string"
        ? toolInput.backend
        : null,
  };
}

const MAX_APPROVAL_ANALYTICS_ITEMS = 10;

function agentAuthKind(agent: AgentsCardData["agents"][number]): string {
  const tools = Array.isArray(agent.tools) ? agent.tools : [];
  const hasOAuth = tools.some((tool) => tool.integration?.auth?.type === "oauth2");
  const hasStaticSecret = tools.some((tool) =>
    tool.integration?.auth?.type === "static_secret"
  );

  if (hasOAuth && hasStaticSecret) return "mixed";
  if (hasOAuth) return "oauth";
  if (hasStaticSecret) return "static_secret";
  return "none";
}

function agentsApprovalAnalytics(
  input: unknown,
  output: unknown,
): AnalyticsProperties {
  const inputAgents = agentsFromPresentAgentsInput(input);
  const outputAgents = agentsFromPresentAgentsOutput(output);
  const agents = inputAgents.length > 0 ? inputAgents : outputAgents;
  const visibleAgents = agents.slice(0, MAX_APPROVAL_ANALYTICS_ITEMS);
  const toolCounts = agents.reduce(
    (totals, agent) => {
      const tools = Array.isArray(agent.tools) ? agent.tools : [];
      totals.toolCount += tools.length;
      totals.enabledToolCount += tools.filter((tool) => tool.enabled !== false).length;
      totals.recommendedToolCount += tools.filter((tool) => tool.recommended).length;
      totals.customToolCount += tools.filter((tool) => tool.type === "custom").length;
      totals.builtinToolCount += tools.filter((tool) => tool.type === "builtin").length;
      totals.integrationCount += tools.filter((tool) => tool.integration).length;
      return totals;
    },
    {
      toolCount: 0,
      enabledToolCount: 0,
      recommendedToolCount: 0,
      customToolCount: 0,
      builtinToolCount: 0,
      integrationCount: 0,
    },
  );

  return {
    agent_count: agents.length,
    agent_detail_count: visibleAgents.length,
    agent_ids: visibleAgents.map((agent) => agent.id),
    agent_names: visibleAgents.map((agent) => agent.name),
    agent_descriptions: visibleAgents.map((agent) => agent.description),
    agent_system_prompts: visibleAgents.map((agent) => agent.systemPrompt),
    agent_tool_count: toolCounts.toolCount,
    agent_enabled_tool_count: toolCounts.enabledToolCount,
    agent_recommended_tool_count: toolCounts.recommendedToolCount,
    agent_custom_tool_count: toolCounts.customToolCount,
    agent_builtin_tool_count: toolCounts.builtinToolCount,
    agent_integration_count: toolCounts.integrationCount,
    agent_data_collection_count: agents.reduce(
      (sum, agent) => sum + (agent.dataCollections?.length ?? 0),
      0,
    ),
    agent_tool_names: visibleAgents.flatMap((agent) =>
      (Array.isArray(agent.tools) ? agent.tools : []).map((tool) => tool.name)
    ),
    agent_tool_display_names: visibleAgents.flatMap((agent) =>
      (Array.isArray(agent.tools) ? agent.tools : [])
        .map((tool) => tool.displayName)
        .filter((name): name is string => Boolean(name))
    ),
    agent_integration_names: visibleAgents.flatMap((agent) =>
      (Array.isArray(agent.tools) ? agent.tools : [])
        .map((tool) => tool.integration?.name)
        .filter((name): name is string => Boolean(name))
    ),
    agent_integration_domains: visibleAgents.flatMap((agent) =>
      (Array.isArray(agent.tools) ? agent.tools : [])
        .map((tool) => tool.integration?.domain)
        .filter((domain): domain is string => Boolean(domain))
    ),
    agent_data_collection_names: visibleAgents.flatMap((agent) =>
      agent.dataCollections ?? []
    ),
    agents: visibleAgents.map((agent) => {
      const tools = Array.isArray(agent.tools) ? agent.tools : [];
      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        system_prompt: agent.systemPrompt,
        tool_count: tools.length,
        enabled_tool_count: tools.filter((tool) => tool.enabled !== false).length,
        recommended_tool_count: tools.filter((tool) => tool.recommended).length,
        custom_tool_count: tools.filter((tool) => tool.type === "custom").length,
        builtin_tool_count: tools.filter((tool) => tool.type === "builtin").length,
        integration_count: tools.filter((tool) => tool.integration).length,
        auth_kind: agentAuthKind(agent),
        data_collection_count: agent.dataCollections?.length ?? 0,
        data_collection_names: agent.dataCollections ?? [],
        tools: tools.map((tool) => ({
          type: tool.type,
          name: tool.name,
          display_name: tool.displayName ?? null,
          enabled: tool.enabled,
          recommended: tool.recommended,
          integration: tool.integration
            ? {
                name: tool.integration.name,
                domain: tool.integration.domain,
              }
            : null,
        })),
      };
    }),
  };
}

function suggestionsApprovalAnalytics(
  input: unknown,
  output: unknown,
): AnalyticsProperties {
  const inputSuggestions = suggestionsFromPresentSuggestionsInput(input);
  const outputSuggestions = suggestionsFromPresentSuggestionsOutput(output);
  const suggestions = inputSuggestions.length > 0
    ? inputSuggestions
    : outputSuggestions;
  const visibleSuggestions = suggestions.slice(0, MAX_APPROVAL_ANALYTICS_ITEMS);

  return {
    suggestion_count: suggestions.length,
    suggestion_detail_count: visibleSuggestions.length,
    suggestion_titles: visibleSuggestions.map((suggestion) => suggestion.title),
    suggestion_subtitles: visibleSuggestions.map((suggestion) => suggestion.subtitle),
    suggestions: visibleSuggestions.map((suggestion) => ({
      title: suggestion.title,
      subtitle: suggestion.subtitle,
      subtitle_length: suggestion.subtitle.length,
      has_emoji: Boolean(suggestion.emoji),
    })),
  };
}

function planApprovalAnalytics(input: unknown): AnalyticsProperties {
  const plan = planDataFromPresentPlanInput(input);
  const features = plan.features ?? [];

  return {
    plan_has_overview: Boolean(plan.overview),
    plan_has_features: features.length > 0,
    plan_has_data_flow: Boolean(plan.dataFlow),
    plan_has_agents: Boolean(plan.agents),
    plan_has_backend: Boolean(plan.backend),
    plan_feature_count: features.length,
    plan_feature_names: features
      .slice(0, MAX_APPROVAL_ANALYTICS_ITEMS)
      .map((feature) => feature.name),
    plan_overview: plan.overview,
    plan_features: features.map((feature) => ({
      name: feature.name,
      description: feature.description,
    })),
    plan_data_flow: plan.dataFlow,
    plan_agents: plan.agents,
    plan_backend: plan.backend,
    plan_overview_length: plan.overview?.length ?? 0,
    plan_data_flow_length: plan.dataFlow?.length ?? 0,
    plan_agents_length: plan.agents?.length ?? 0,
    plan_backend_length: plan.backend?.length ?? 0,
  };
}

type PendingApproval = {
  kind: "plan" | "suggestions" | "agents";
  toolCallId: string;
  analytics: AnalyticsProperties;
};

function blockingApprovalKind(toolName: string): PendingApproval["kind"] | null {
  if (toolName === "mcp__second__present_plan") return "plan";
  if (toolName === "mcp__second__present_suggestions") return "suggestions";
  if (toolName === "mcp__second__present_agents") return "agents";
  return null;
}

function pendingBlockingApprovalFromMessages(
  messages: UIMessage[],
): PendingApproval | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message.role === "user") return null;
    if (message.role !== "assistant") continue;

    const parts = message.parts ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      const record = asRecord(part);
      if (record?.type !== "dynamic-tool") continue;

      const toolName = typeof record.toolName === "string" ? record.toolName : "";
      const kind = blockingApprovalKind(toolName);
      if (!kind) continue;
      if (
        typeof record.toolCallId === "string" &&
        record.state === "output-available" &&
        record.preliminary !== true
      ) {
        const analytics = kind === "agents"
          ? agentsApprovalAnalytics(record.input, record.output)
          : kind === "suggestions"
            ? suggestionsApprovalAnalytics(record.input, record.output)
            : planApprovalAnalytics(record.input);
        if (
          kind === "agents" &&
          analytics.agent_count === 0
        ) {
          continue;
        }
        if (
          kind === "suggestions" &&
          analytics.suggestion_count === 0
        ) {
          continue;
        }
        return { kind, toolCallId: record.toolCallId, analytics };
      }
    }
  }

  return null;
}

function sanitizeMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: Array.isArray(message?.parts)
      ? message.parts.filter((part): part is NonNullable<typeof part> => part != null)
      : [],
  }));
}

type ChatRunSnapshot = {
  messages?: UIMessage[];
  status?: string | null;
  failure?: AgentRunFailure | null;
  usage?: RunUsage | null;
};

function latestUserTurn(messages: UIMessage[]): UserTurn | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const text = messageText(message).trim();
    if (text) return { index, message, text };
  }
  return null;
}

function latestAssistantTurnHasStarted(messages: UIMessage[]): boolean {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  for (let index = latestUserIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    if ((message.parts ?? []).some((part) => part != null)) return true;
  }
  return false;
}

function isUserStoppedFailure(
  failure: AgentRunFailure | null | undefined,
): boolean {
  return failure?.code === "user_stopped";
}

function permissionKey(groupName: string, permission: string): string {
  return `${groupName.trim().toLowerCase()}::${permission.trim().toLowerCase()}`;
}

function normalizeSetupIntegrations(value: unknown): IntegrationSetupItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): IntegrationSetupItem[] => {
    const record = asRecord(item);
    if (!record) return [];
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const domain = typeof record.domain === "string" ? record.domain.trim() : "";
    const auth = asRecord(record.auth);
    if (!name && !domain) return [];

    return [{
      name: name || domain,
      domain,
      iconUrl: typeof record.iconUrl === "string" ? record.iconUrl.trim() : undefined,
      faviconUrl:
        typeof record.faviconUrl === "string" ? record.faviconUrl.trim() : undefined,
      keySlug: typeof record.keySlug === "string" ? record.keySlug : "default",
      auth: auth?.type === "oauth2"
        ? {
            providerKey:
              typeof auth.providerKey === "string" ? auth.providerKey.trim() : undefined,
            scopes: Array.isArray(auth.scopes)
              ? auth.scopes.filter((scope): scope is string => typeof scope === "string")
              : [],
          }
        : null,
      permissionGroups: Array.isArray(record.permissionGroups)
        ? record.permissionGroups.flatMap((group): IntegrationSetupPermissionGroup[] => {
            const groupRecord = asRecord(group);
            const groupName = typeof groupRecord?.name === "string" ? groupRecord.name : "";
            if (!groupName) return [];
            return [{
              name: groupName,
              permissions: Array.isArray(groupRecord?.permissions)
                ? groupRecord.permissions.filter((permission): permission is string => typeof permission === "string")
                : [],
            }];
          })
        : [],
      secrets: Array.isArray(record.secrets)
        ? record.secrets.flatMap((secret): IntegrationSetupSecret[] => {
            const secretRecord = asRecord(secret);
            const secretName = typeof secretRecord?.name === "string" ? secretRecord.name : "";
            if (!secretName) return [];
            return [{
              name: secretName,
              required: typeof secretRecord?.required === "boolean"
                ? secretRecord.required
                : true,
            }];
          })
        : [],
    }];
  });
}

function normalizeAppIntegrationKeys(value: unknown): AppIntegrationKeyStatus[] {
  const record = asRecord(value);
  const integrations = record?.integrations;
  if (!Array.isArray(integrations)) return [];

  return integrations.flatMap((item): AppIntegrationKeyStatus[] => {
    const integration = asRecord(item);
    if (!integration) return [];
    const name = typeof integration.name === "string" ? integration.name.trim() : "";
    const domain = typeof integration.domain === "string" ? integration.domain.trim() : "";
    if (!name && !domain) return [];

    return [{
      appId: typeof integration.appId === "string" ? integration.appId : undefined,
      id:
        typeof integration.id === "string"
          ? integration.id
          : `${domain || name}:${typeof integration.keySlug === "string" ? integration.keySlug : "default"}`,
      name: name || domain,
      domain,
      appName:
        typeof integration.appName === "string" ? integration.appName : undefined,
      capabilityLabel:
        typeof integration.capabilityLabel === "string"
          ? integration.capabilityLabel
          : undefined,
      keySlug: typeof integration.keySlug === "string" ? integration.keySlug : "default",
      authType: integration.authType === "oauth2" ? "oauth2" : "static_secret",
      configured: integration.configured === true,
      oauth: (() => {
        const oauth = asRecord(integration.oauth);
        if (!oauth) return null;
        return {
          providerConfigured: oauth.providerConfigured === true,
          providerConfigMatchesGrant: oauth.providerConfigMatchesGrant === true,
          currentUserConnected: oauth.currentUserConnected === true,
        };
      })(),
      configuredPermissionGroups: Array.isArray(integration.configuredPermissionGroups)
        ? (integration.configuredPermissionGroups as IntegrationSetupPermissionGroup[])
        : [],
      configuredSecrets: Array.isArray(integration.configuredSecrets)
        ? integration.configuredSecrets.filter((secret): secret is string => typeof secret === "string")
        : [],
    }];
  });
}

function latestIntegrationSetupFromMessages(
  messages: UIMessage[],
): IntegrationSetupItem[] {
  for (let msgIndex = messages.length - 1; msgIndex >= 0; msgIndex -= 1) {
    const msg = messages[msgIndex];
    if (msg.role !== "assistant") continue;

    const parts = msg.parts ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      const record = asRecord(part);
      if (
        record?.type !== "dynamic-tool" ||
        record.toolName !== "mcp__second__present_integration_setup" ||
        record.state !== "output-available" ||
        record.preliminary === true ||
        !integrationSetupOutputWasSynced(record.output)
      ) {
        continue;
      }
      const input = asRecord(record.input);
      return normalizeSetupIntegrations(input?.integrations);
    }
  }

  return [];
}

function integrationSetupOutputWasSynced(output: unknown): boolean {
  const parsed = parseToolTextOutput(output);
  const record = asRecord(parsed);
  if (record) {
    if (record.ok === false || record.synced === false) return false;
    if (record.ok === true && record.synced === true) return true;
  }

  if (typeof parsed !== "string") return false;
  const text = parsed.toLowerCase();
  return (
    text.includes("presented to user and synced") &&
    !text.includes("not synced") &&
    !text.includes("not fully synced")
  );
}

function integrationNeedsSetup(
  requested: IntegrationSetupItem,
  live: AppIntegrationKeyStatus | undefined,
): boolean {
  if (!live) return true;
  if (!live.configured) return true;
  if (live.authType === "oauth2") return false;

  const configuredPermissions = new Set<string>();
  for (const group of live.configuredPermissionGroups) {
    for (const permission of group.permissions ?? []) {
      configuredPermissions.add(permissionKey(group.name, permission));
    }
  }

  for (const group of requested.permissionGroups ?? []) {
    for (const permission of group.permissions ?? []) {
      if (!configuredPermissions.has(permissionKey(group.name, permission))) {
        return true;
      }
    }
  }

  const configuredSecrets = new Set(
    live.configuredSecrets.map((secret) => secret.toLowerCase()),
  );
  for (const secret of requested.secrets ?? []) {
    if (secret.required === false) continue;
    if (!configuredSecrets.has(secret.name.toLowerCase())) return true;
  }

  return false;
}

function findLiveIntegrationKey(
  requested: IntegrationSetupItem,
  liveKeys: AppIntegrationKeyStatus[] | null,
  appId: string,
): AppIntegrationKeyStatus | undefined {
  return liveKeys?.find(
    (candidate) =>
      normalizeDomain(candidate.domain) === normalizeDomain(requested.domain) &&
      (candidate.appId === undefined || candidate.appId === appId) &&
      (candidate.keySlug ?? "default") === (requested.keySlug ?? "default"),
  );
}

function IntegrationSetupComposerCallout({
  integrations,
  workspaceId,
  appId,
  canManageIntegrations,
  connectableOAuthIntegration,
  liveIntegrationKeys,
  onBeforeNavigate,
}: {
  integrations: IntegrationSetupItem[];
  workspaceId: string;
  appId: string;
  canManageIntegrations: boolean;
  connectableOAuthIntegration?: AppIntegrationKeyStatus | null;
  liveIntegrationKeys?: AppIntegrationKeyStatus[] | null;
  onBeforeNavigate?: () => void;
}) {
  if (integrations.length === 0) return null;

  const connectableOAuth = connectableOAuthIntegration;
  const appReturnTo = `/w/${workspaceId}/apps/${appId}`;
  const connectedAppsTarget = connectableOAuth
    ? `/w/${workspaceId}/settings/connected-apps?integration=${encodeURIComponent(connectableOAuth.id ?? connectableOAuth.domain)}&returnTo=${encodeURIComponent(appReturnTo)}`
    : null;
  const primaryIntegration = integrations[0] ?? null;
  const primaryLiveIntegration = primaryIntegration
    ? findLiveIntegrationKey(primaryIntegration, liveIntegrationKeys ?? null, appId)
    : undefined;
  const integrationSetupTarget = primaryIntegration
    ? primaryLiveIntegration && liveIntegrationKeys?.length
      ? `/w/${workspaceId}/settings/integrations/${encodeURIComponent(integrationRouteSegment(primaryLiveIntegration, liveIntegrationKeys))}?app=${encodeURIComponent(appId)}&returnTo=${encodeURIComponent(appReturnTo)}`
      : `/w/${workspaceId}/settings/integrations?app=${encodeURIComponent(appId)}&returnTo=${encodeURIComponent(appReturnTo)}`
    : `/w/${workspaceId}/settings/integrations?app=${encodeURIComponent(appId)}&returnTo=${encodeURIComponent(appReturnTo)}`;
  const trackSetupNavigation = () => {
    captureAnalyticsEvent("integration setup started", {
      workspace_id: workspaceId,
      app_id: appId,
      can_manage_integrations: canManageIntegrations,
      target_surface: connectedAppsTarget
        ? "connected_apps"
        : canManageIntegrations
          ? "integration_settings"
          : "review_needed",
      ...integrationSetupAnalyticsProperties(
        integrations,
        connectableOAuthIntegration,
      ),
    });
    onBeforeNavigate?.();
  };
  const content = (
    <div className="relative overflow-hidden rounded-t-2xl border border-b-0 border-border/60 bg-gradient-to-r from-[#f0eef5] via-[#eef2f7] to-[#f0eef5] px-4 pt-2 pb-8 shadow-sm transition-colors group-hover:from-[#e8e5f0] group-hover:via-[#e5ecf3] group-hover:to-[#e8e5f0] dark:from-[#252330] dark:via-[#222832] dark:to-[#252330] dark:group-hover:from-[#2d2a3a] dark:group-hover:via-[#2a3040] dark:group-hover:to-[#2d2a3a]">
      <div className="flex items-center gap-2">
        <p className="min-w-0 truncate text-[13px] leading-6 font-medium text-foreground/90">
          {connectableOAuth
            ? "Connect your "
            : canManageIntegrations
            ? "Connect "
            : "Mock data will be used until a reviewer approves the "}
          {integrations.map((integration, idx) => (
            <span
              key={`${normalizeDomain(integration.domain) || integration.name || "integration"}:${integration.keySlug ?? "default"}:${idx}`}
            >
              {idx > 0 ? (
                <span className="text-foreground/70">
                  {idx === integrations.length - 1 ? " and " : ", "}
                </span>
              ) : null}
              <span className="mx-0.5 inline-flex h-6 max-w-full items-center gap-1.5 rounded-lg border border-border/80 bg-background/90 px-2 align-middle text-xs leading-none font-semibold whitespace-nowrap text-foreground shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-sm">
                {integration.domain ? (
                  <span className="flex size-3.5 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-border/50 bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={integrationIconUrl(integration)}
                      alt=""
                      className="size-3.5 object-contain"
                    />
                  </span>
                ) : (
                  <PlugZapIcon className="size-3.5 text-muted-foreground" />
                )}
                {integration.name}
              </span>
            </span>
          ))}{" "}
          {connectableOAuth
            ? "account."
            : canManageIntegrations
              ? "to your app"
              : integrations.length === 1
              ? "integration."
              : "integrations."}
        </p>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground/75">
          {connectableOAuth
            ? "Connect"
            : canManageIntegrations
              ? "Open setup"
              : "Request review when ready"}
          {canManageIntegrations || connectableOAuth ? (
            <ExternalLinkIcon className="size-3" />
          ) : null}
        </span>
      </div>
    </div>
  );

  if (connectedAppsTarget) {
    return (
      <Link
        href={connectedAppsTarget}
        prefetch={false}
        onPointerDown={onBeforeNavigate}
        onClick={trackSetupNavigation}
        className="group relative mx-2 -mb-6 block translate-y-[-2px] animate-in fade-in-0 slide-in-from-bottom-1 duration-300 transition-transform hover:translate-y-[-5px]"
      >
        {content}
      </Link>
    );
  }

  if (!canManageIntegrations) {
    return (
      <div className="group relative mx-2 -mb-6 block translate-y-[-2px] animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
        {content}
      </div>
    );
  }

  return (
    <Link
      href={integrationSetupTarget}
      prefetch={false}
      onPointerDown={onBeforeNavigate}
      onClick={trackSetupNavigation}
      className="group relative mx-2 -mb-6 block translate-y-[-2px] animate-in fade-in-0 slide-in-from-bottom-1 duration-300 transition-transform hover:translate-y-[-5px]"
    >
      {content}
    </Link>
  );
}

function ToolRecoveryComposerCallout({
  status,
  toolName,
}: {
  status?: "fixing" | null;
  toolName?: string | null;
}) {
  if (status !== "fixing") return null;

  const label = toolName
    ? `${toolName} failed - builder is fixing it`
    : "Tool call failed - builder is fixing it";

  return (
    <div className="relative mx-2 -mb-6 translate-y-[-2px] animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <Alert className="rounded-t-2xl rounded-b-lg border-b-0 bg-card/95 px-4 pt-2 pb-8 shadow-sm">
        <HammerIcon className="size-3.5" />
        <AlertDescription className="flex min-w-0 items-center gap-2 text-[13px] leading-6 font-medium text-foreground">
          <span className="min-w-0 truncate">{label}</span>
          <AppLoader size="xs" />
        </AlertDescription>
      </Alert>
    </div>
  );
}

function formatToolInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  if (typeof obj.command === "string") return obj.command;
  if (typeof obj.file_path === "string") return obj.file_path;
  if (typeof obj.pattern === "string") return obj.pattern;
  if (typeof obj.url === "string") return obj.url;
  if (typeof obj.query === "string") return obj.query;
  // Fallback: show the first string value
  for (const val of Object.values(obj)) {
    if (typeof val === "string" && val.length < 200) return val;
  }
  return null;
}

function formatToolOutput(output: unknown): string | null {
  if (output == null) return null;
  const str = typeof output === "string" ? output : JSON.stringify(output);
  if (!str || str === '""' || str === "Completed") return null;
  // Truncate long output
  return str.length > 500 ? str.slice(0, 500) + "…" : str;
}

type BashDisplayTool = {
  toolName: "Read" | "List" | "Glob" | "Grep";
  input: Record<string, unknown>;
};

function shellWords(command: string): string[] {
  const words: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  for (const match of command.matchAll(pattern)) {
    words.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return words.filter(Boolean);
}

function lastPositional(words: string[]): string {
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    if (word && !word.startsWith("-")) return word;
  }
  return "";
}

function firstPositional(words: string[]): string {
  return words.find((word) => word && !word.startsWith("-")) ?? "";
}

function commandName(word: string | undefined): string {
  return (word ?? "").split("/").pop() ?? "";
}

function unwrapShellCommand(command: string): string {
  const words = shellWords(command.trim());
  const name = commandName(words[0]);
  if (
    (name === "bash" || name === "sh" || name === "zsh") &&
    (words[1] === "-lc" || words[1] === "-c") &&
    words[2]
  ) {
    return words.slice(2).join(" ");
  }
  return command.trim();
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];

    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      current += char;
      continue;
    }

    if ((char === "&" && next === "&") || (char === "|" && next === "|")) {
      if (current.trim()) segments.push(current.trim());
      current = "";
      index += 1;
      continue;
    }

    if (char === ";" || char === "|") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

function normalizeShellSegment(segment: string): string {
  let normalized = segment.trim();
  normalized = normalized.replace(/^\(+/, "").replace(/\)+$/, "").trim();
  normalized = normalized.replace(/^then\s+/, "").trim();
  normalized = normalized.replace(/^else\s+/, "").trim();
  normalized = normalized.replace(/^do\s+/, "").trim();
  normalized = normalized.replace(/\s+2?>\/dev\/null/g, "").trim();
  return normalized;
}

function isShellControlSegment(segment: string): boolean {
  return (
    segment === "" ||
    segment === "true" ||
    segment === ":" ||
    segment === "fi" ||
    segment === "done" ||
    segment.startsWith("if ") ||
    segment.startsWith("test ") ||
    segment.startsWith("[ ")
  );
}

function readCommandTarget(name: string, words: string[]): string {
  const positionals = words.slice(1).filter((word) => !word.startsWith("-"));
  if (name === "sed") {
    const target = [...positionals]
      .reverse()
      .find((word) => !/^[0-9,$]+[a-z]$/i.test(word));
    return target ?? "";
  }
  return lastPositional(words.slice(1));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function bashDisplayTool(command: string): BashDisplayTool | null {
  const unwrapped = unwrapShellCommand(command);
  if (!unwrapped) return null;

  const reads: string[] = [];
  const lists: string[] = [];
  let grepInput: Record<string, unknown> | null = null;
  let sawReadableCommand = false;

  for (const rawSegment of splitShellSegments(unwrapped)) {
    const segment = normalizeShellSegment(rawSegment);
    if (isShellControlSegment(segment)) continue;
    if (/[<>]/.test(segment)) return null;

    const words = shellWords(segment);
    const name = commandName(words[0]);
    if (!name) continue;

    if (name === "sort") {
      sawReadableCommand = true;
      continue;
    }

    if (name === "echo" && sawReadableCommand) {
      continue;
    }

    if (["cat", "sed", "head", "tail", "wc"].includes(name)) {
      const filePath = readCommandTarget(name, words);
      if (!filePath) return null;
      reads.push(filePath);
      sawReadableCommand = true;
      continue;
    }

    if (name === "ls") {
      lists.push(lastPositional(words.slice(1)) || ".");
      sawReadableCommand = true;
      continue;
    }

    if (name === "find") {
      lists.push(firstPositional(words.slice(1)) || ".");
      sawReadableCommand = true;
      continue;
    }

    if (name === "rg" || name === "grep") {
      const positionals = words.slice(1).filter((word) => !word.startsWith("-"));
      if (words.includes("--files")) {
        lists.push(positionals.at(-1) ?? ".");
      } else {
        const pattern = positionals[0] ?? "";
        const path = positionals[1];
        if (!pattern) return null;
        grepInput = { pattern, ...(path ? { path } : {}) };
      }
      sawReadableCommand = true;
      continue;
    }

    return null;
  }

  const filePaths = uniqueStrings(reads);
  if (filePaths.length === 1) {
    return { toolName: "Read", input: { file_path: filePaths[0] } };
  }
  if (filePaths.length > 1) {
    return { toolName: "Read", input: { file_paths: filePaths } };
  }

  const listPaths = uniqueStrings(lists);
  if (listPaths.length === 1) {
    return { toolName: "List", input: { path: listPaths[0] } };
  }
  if (listPaths.length > 1) {
    return { toolName: "List", input: { paths: listPaths } };
  }

  if (grepInput) return { toolName: "Grep", input: grepInput };
  return sawReadableCommand ? { toolName: "List", input: { path: "." } } : null;
}

function formatOutputForDetails(output: unknown): string | null {
  if (output == null) return null;
  const str = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  if (!str || str === '""' || str === "Completed") return null;
  return str.length > 4000 ? str.slice(0, 4000) + "\n…truncated" : str;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function DoneBuildingCard({
  toolCallId,
  state,
  output,
}: {
  toolCallId: string;
  state: string | undefined;
  output: unknown;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const isRunning = state === "input-available" || state === "input-streaming";
  const isDone = state === "output-available";

  const parsed = parseDoneBuildingOutput(output);
  const buildSucceeded = isDone && parsed?.status === "complete";
  const buildFailed = isDone && !buildSucceeded;
  // Only show raw output dump when parsing failed (e.g. build errors).
  // When parsed fields exist, they already cover everything cleanly.
  const outputDetails = parsed ? null : formatOutputForDetails(output);
  const hasDetails =
    Boolean(parsed?.summary) ||
    typeof parsed?.fileCount === "number" ||
    typeof parsed?.totalBytes === "number" ||
    typeof parsed?.warning === "string" ||
    Boolean(outputDetails);

  return (
    <Collapsible
      key={`tool-${toolCallId}`}
      className="not-prose"
      open={isOpen}
      onOpenChange={setIsOpen}
    >
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs",
          buildFailed ? "bg-destructive/10" : "bg-emerald-500/10",
          hasDetails ? "cursor-pointer" : "cursor-default",
        )}
        disabled={!hasDetails}
      >
        {isRunning ? (
          <AppLoader size="xs" interactive={false} />
        ) : buildFailed ? (
          <Info className="size-3 text-destructive" />
        ) : (
          <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
        )}
        <span
          className={cn(
            "font-medium",
            buildFailed
              ? "text-destructive"
              : "text-emerald-700 dark:text-emerald-300",
          )}
        >
          {isRunning
            ? "Preparing preview..."
            : buildFailed
              ? "Build failed — fix errors and rebuild"
              : "App ready — preview loading"}
        </span>
        {hasDetails ? (
          <ChevronDownIcon
            className={cn(
              "ml-auto size-3.5 text-muted-foreground transition-transform",
              isOpen ? "rotate-180" : "rotate-0",
            )}
          />
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-1 rounded-lg border border-border bg-background/80 p-3 text-xs">
          {parsed?.summary ? (
            <p className="text-foreground">
              <span className="text-muted-foreground">Summary:</span>{" "}
              {parsed.summary}
            </p>
          ) : null}
          {typeof parsed?.fileCount === "number" ? (
            <p className="text-foreground">
              <span className="text-muted-foreground">Files persisted:</span>{" "}
              {parsed.fileCount}
            </p>
          ) : null}
          {typeof parsed?.totalBytes === "number" ? (
            <p className="text-foreground">
              <span className="text-muted-foreground">Snapshot size:</span>{" "}
              {formatBytes(parsed.totalBytes)}
            </p>
          ) : null}
          {typeof parsed?.warning === "string" && parsed.warning ? (
            <p className="text-amber-700 dark:text-amber-400">
              <span className="text-muted-foreground">Warning:</span>{" "}
              {parsed.warning}
            </p>
          ) : null}
          {outputDetails ? (
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/30 p-2 font-mono text-[11px] text-foreground">
              {outputDetails}
            </pre>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Cross-tab sync via the workspace realtime bus
// ---------------------------------------------------------------------------

/**
 * Subscribes to the shared workspace realtime bus for run lifecycle events.
 *
 * When another tab starts a stream, this hook:
 *  1. Fetches current messages (so the user message appears immediately).
 *  2. Calls resumeStream() to join the live stream.
 *  3. If resume fails (204 / expired), falls back to polling GET /chat.
 *
 * Initial page-load resume is intentionally delayed until after first paint so
 * opening/backing into an app route does not compete with the initial render.
 *
 * Returns `isSyncLoading` — true while a remote stream is in progress
 * but useChat hasn't entered "streaming" status yet.
 */
function useRunSync({
  workspaceId,
  appId,
  runId,
  chatApiUrl,
  observerFetch,
  status,
  statusRef,
  setMessages,
  resumeStream,
  onSnapshot,
  initialRunStatus,
  initialMessageCount,
}: {
  workspaceId: string;
  appId: string;
  runId: string | null;
  chatApiUrl: string | null;
  observerFetch: typeof globalThis.fetch;
  status: string;
  statusRef: React.RefObject<string>;
  setMessages: (messages: UIMessage[]) => void;
  resumeStream: () => Promise<void>;
  onSnapshot?: (snapshot: ChatRunSnapshot) => void;
  initialRunStatus: string | null;
  initialMessageCount: number;
}): boolean {
  const [isSyncLoading, setIsSyncLoading] = useState(
    () => initialRunStatus === "streaming" && initialMessageCount > 0,
  );
  // When true, a setInterval polls GET /chat as a fallback for tabs
  // whose resumeStream() got 204 but the run is still active.
  const [shouldPoll, setShouldPoll] = useState(false);

  // Guards against concurrent resumeStream() calls, which can corrupt
  // useChat internal state if they overlap.
  const resumeActiveRef = useRef(false);
  const wasStreamingRef = useRef(false);
  const syncGenRef = useRef(0);
  const lastResumeAttemptAtRef = useRef(0);
  const deferredRunSyncRef = useRef<{
    pending: boolean;
    showLoading: boolean;
  }>({ pending: false, showLoading: false });

  // Refs for values accessed inside async callbacks (avoids stale closures
  // and keeps the event-subscription effect's dependency array stable).
  const chatApiUrlRef = useRef(chatApiUrl);
  useEffect(() => {
    chatApiUrlRef.current = chatApiUrl;
  }, [chatApiUrl]);

  const observerFetchRef = useRef(observerFetch);
  useEffect(() => {
    observerFetchRef.current = observerFetch;
  }, [observerFetch]);

  const fetchRunSnapshot = useCallback(
    (url: string, init?: RequestInit) =>
      observerFetchRef.current(url, { cache: "no-store", ...init }),
    [],
  );

  const setMessagesRef = useRef(setMessages);
  useEffect(() => {
    setMessagesRef.current = setMessages;
  }, [setMessages]);
  const onSnapshotRef = useRef(onSnapshot);
  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  }, [onSnapshot]);

  /** Ensures messages from the server won't crash useChat or rendering.
   *  Strips null/undefined parts that can appear after MongoDB round-trips. */
  const safeSetMessages = useCallback((msgs: UIMessage[]) => {
    setMessagesRef.current(sanitizeMessages(msgs));
  }, []);
  const safeSetMessagesIfIdle = useCallback(
    (msgs: UIMessage[]) => {
      const currentStatus = statusRef.current;
      if (currentStatus === "streaming" || currentStatus === "submitted") return;
      safeSetMessages(msgs);
    },
    [statusRef, safeSetMessages],
  );

  const resumeStreamRef = useRef(resumeStream);
  useEffect(() => {
    resumeStreamRef.current = resumeStream;
  }, [resumeStream]);

  const shouldPollRef = useRef(shouldPoll);
  useEffect(() => {
    shouldPollRef.current = shouldPoll;
  }, [shouldPoll]);

  const startLiveSyncRef = useRef<
    (options?: { force?: boolean; showLoading?: boolean }) => void
  >(
    () => {},
  );
  useEffect(() => {
    startLiveSyncRef.current = (options) => {
      const currentStatus = statusRef.current;
      if (currentStatus === "streaming" || currentStatus === "submitted") return;
      if (resumeActiveRef.current) return;
      if (shouldPollRef.current && !options?.force) return;

      syncGenRef.current += 1;
      const gen = syncGenRef.current;
      resumeActiveRef.current = true;
      lastResumeAttemptAtRef.current = Date.now();
      setShouldPoll(false);
      if (options?.showLoading) {
        setIsSyncLoading(true);
      }

      const beginResume = () => {
        if (syncGenRef.current !== gen) return;
        setIsSyncLoading(true);
        window.setTimeout(() => {
          if (syncGenRef.current !== gen) return;
          const liveStatus = statusRef.current;
          if (liveStatus === "streaming" || liveStatus === "submitted") return;
          // A reconnect request can sit behind old browser sockets. Keep
          // syncing in the background, but do not pin the chat on "Working".
          setIsSyncLoading(false);
          setShouldPoll(true);
        }, 10000);

        resumeStreamRef
          .current()
          .then(async () => {
            // If useChat attached to stream, it will transition to submitted/streaming.
            const liveStatus = statusRef.current;
            if (liveStatus === "streaming" || liveStatus === "submitted") {
              return;
            }

            const latestUrl = chatApiUrlRef.current;
            if (!latestUrl) {
              setIsSyncLoading(false);
              setShouldPoll(false);
              return;
            }

            try {
              const res = await fetchRunSnapshot(latestUrl);
              if (!res.ok) return;
              const snapshot = (await res.json()) as ChatRunSnapshot;
              onSnapshotRef.current?.(snapshot);
              const messages = snapshot.messages ?? [];
              const runStatus = snapshot.status ?? null;
              safeSetMessagesIfIdle(messages);
              if (runStatus === "streaming") {
                // Resume didn't attach; keep this tab fresh via polling fallback.
                setShouldPoll(true);
              } else {
                setShouldPoll(false);
                setIsSyncLoading(false);
              }
            } catch {
              setShouldPoll(true);
            }
          })
          .catch(() => {
            // Resume failed; polling fallback keeps this tab reasonably fresh.
            setShouldPoll(true);
          })
          .finally(() => {
            if (syncGenRef.current === gen) {
              resumeActiveRef.current = false;
            }
          });
      };

      const url = chatApiUrlRef.current;
      if (!url) {
        beginResume();
        return;
      }

      // Fetch current messages first so stale stream-ready events don't flash
      // a reconnect indicator after the run has already completed or failed.
      fetchRunSnapshot(url)
        .then((res) => (res.ok ? res.json() : null))
        .then((snapshot: ChatRunSnapshot | null) => {
          if (syncGenRef.current !== gen) return;
          if (!snapshot) {
            beginResume();
            return;
          }
          onSnapshotRef.current?.(snapshot);
          safeSetMessagesIfIdle(snapshot.messages ?? []);
          if (snapshot.status === "streaming") {
            beginResume();
          } else {
            resumeActiveRef.current = false;
            setShouldPoll(false);
            setIsSyncLoading(false);
          }
        })
        .catch(() => {
          beginResume();
        });
    };
  });

  // Check immediately on mount. This covers browser back/forward restoring
  // stale route props and avoids briefly enabling the composer for an active
  // run before the no-store status check catches up.
  useEffect(() => {
    let cancelled = false;
    let stateTimer: number | null = null;
    let initialCheckTimer: number | null = null;
    const url = chatApiUrlRef.current;

    const scheduleState = (update: () => void) => {
      stateTimer = window.setTimeout(() => {
        if (!cancelled) update();
      }, 0);
    };

    if (!url || initialRunStatus !== "streaming") {
      scheduleState(() => {
        setIsSyncLoading(false);
      });
      return () => {
        cancelled = true;
        if (stateTimer !== null) {
          window.clearTimeout(stateTimer);
        }
      };
    }

    initialCheckTimer = window.setTimeout(() => {
      if (!cancelled) setIsSyncLoading(false);
    }, 5000);

    scheduleState(() => {
      setIsSyncLoading(initialMessageCount > 0);
    });

    fetchRunSnapshot(url)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: ChatRunSnapshot | null,
        ) => {
          if (cancelled || !data) return;
          onSnapshotRef.current?.(data);

          const latestMessages = sanitizeMessages(data.messages ?? []);
          if (latestMessages.length > initialMessageCount) {
            safeSetMessagesIfIdle(latestMessages);
          }
          if (data.status === "streaming") {
            safeSetMessagesIfIdle(latestMessages);
            startLiveSyncRef.current({ force: true });
          } else {
            setShouldPoll(false);
            setIsSyncLoading(false);
          }
        },
      )
      .catch(() => {
        if (initialRunStatus !== "streaming") {
          setIsSyncLoading(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          if (initialCheckTimer !== null) {
            window.clearTimeout(initialCheckTimer);
          }
        }
      });

    return () => {
      cancelled = true;
      if (stateTimer !== null) {
        window.clearTimeout(stateTimer);
      }
      if (initialCheckTimer !== null) {
        window.clearTimeout(initialCheckTimer);
      }
    };
  }, [
    chatApiUrl,
    initialRunStatus,
    initialMessageCount,
    safeSetMessagesIfIdle,
    fetchRunSnapshot,
  ]);

  // ---- Detect when useChat streaming ends → clear loading ----
  useEffect(() => {
    if (status === "streaming" || status === "submitted") {
      wasStreamingRef.current = true;
      resumeActiveRef.current = false;
      // useChat is handling the stream directly — pause polling fallback.
      window.setTimeout(() => setShouldPoll(false), 0);
    }
    if (status === "ready" && wasStreamingRef.current && isSyncLoading) {
      wasStreamingRef.current = false;
      const gen = syncGenRef.current;
      const timer = setTimeout(() => {
        if (syncGenRef.current !== gen) return;
        const url = chatApiUrlRef.current;
        if (url) {
          fetchRunSnapshot(url)
            .then((res) => res.json())
            .then(
              (snapshot: ChatRunSnapshot) => {
                onSnapshotRef.current?.(snapshot);
                const messages = snapshot.messages ?? [];
                const runStatus = snapshot.status ?? null;
                safeSetMessagesIfIdle(messages);
                if (runStatus !== "streaming") {
                  setIsSyncLoading(false);
                  setShouldPoll(false);
                }
              },
            )
            .catch(() => {
              setIsSyncLoading(false);
              setShouldPoll(false);
            });
        } else {
          setIsSyncLoading(false);
          setShouldPoll(false);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [status, isSyncLoading, safeSetMessagesIfIdle, fetchRunSnapshot]);

  // A lifecycle event can arrive while this tab is still unwinding the previous
  // observer stream. Do not start a second resume then; catch up as soon as the
  // AI SDK returns to ready and only show loading if the run is still active.
  useEffect(() => {
    if (status !== "ready" || !deferredRunSyncRef.current.pending) return;

    const pendingShowLoading = deferredRunSyncRef.current.showLoading;
    deferredRunSyncRef.current = { pending: false, showLoading: false };
    const url = chatApiUrlRef.current;
    if (!url) return;

    let cancelled = false;
    fetchRunSnapshot(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((snapshot: ChatRunSnapshot | null) => {
        if (cancelled || !snapshot) return;
        onSnapshotRef.current?.(snapshot);
        safeSetMessagesIfIdle(snapshot.messages ?? []);
        if (snapshot.status === "streaming") {
          startLiveSyncRef.current({
            force: true,
            showLoading: pendingShowLoading,
          });
        } else {
          setShouldPoll(false);
          setIsSyncLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShouldPoll(false);
          setIsSyncLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [status, safeSetMessagesIfIdle, fetchRunSnapshot]);

  // ---- Polling observer sync ----
  useEffect(() => {
    if (!shouldPoll) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const releaseBusyTimer = setTimeout(() => {
      // If no resumable stream became available, keep polling in the
      // background but stop blocking the UI on a stale streaming run.
      setIsSyncLoading(false);
    }, 10000);

    const pollOnce = async () => {
      const url = chatApiUrlRef.current;
      if (!url) return;
      try {
        const res = await fetchRunSnapshot(url);
        if (res.ok) {
          const snapshot = (await res.json()) as ChatRunSnapshot;
          if (cancelled) return;
          onSnapshotRef.current?.(snapshot);
          const messages = snapshot.messages ?? [];
          const runStatus = snapshot.status ?? null;
          safeSetMessagesIfIdle(messages);
          if (runStatus === "streaming") {
            const currentStatus = statusRef.current;
            const canRetryResume =
              currentStatus !== "streaming" &&
              currentStatus !== "submitted" &&
              !resumeActiveRef.current;
            const retryDue =
              Date.now() - lastResumeAttemptAtRef.current >= 1500;

            if (canRetryResume && retryDue && !retryTimer) {
              retryTimer = setTimeout(() => {
                retryTimer = null;
                if (!cancelled) {
                  startLiveSyncRef.current({ force: true });
                }
              }, 0);
            }
          } else {
            setShouldPoll(false);
            setIsSyncLoading(false);
          }
        }
      } catch {
        // best effort
      }
    };

    void pollOnce();
    const interval = setInterval(pollOnce, 2000);
    return () => {
      cancelled = true;
      clearTimeout(releaseBusyTimer);
      clearInterval(interval);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [shouldPoll, statusRef, safeSetMessagesIfIdle, fetchRunSnapshot]);

  // ---- Event subscription (workspace realtime provider owns the SSE) ----
  useWorkspaceRealtimeEvent(useCallback((event) => {
    if (
      !runId ||
      event.workspaceId !== workspaceId ||
      event.scope !== "agent-runs" ||
      event.appId !== appId ||
      event.runId !== runId
    ) {
      return;
    }

    const currentStatus = statusRef.current;
    if (currentStatus === "streaming" || currentStatus === "submitted") {
      if (event.type === "run.starting" || event.type === "run.stream_ready") {
        deferredRunSyncRef.current = {
          pending: true,
          showLoading:
            deferredRunSyncRef.current.showLoading ||
            event.type === "run.starting",
        };
      }
      return;
    }

    // run.starting/run.stream_ready: another tab or a resumed POST is active.
    if (event.type === "run.starting") {
      startLiveSyncRef.current({ force: true, showLoading: true });
    } else if (event.type === "run.stream_ready") {
      startLiveSyncRef.current({ force: true });
    } else if (event.type === "run.completed" || event.type === "run.failed") {
      setShouldPoll(false);
      const url = chatApiUrlRef.current;
      if (url) {
        fetchRunSnapshot(url)
          .then((res) => res.json())
          .then((snapshot: ChatRunSnapshot) => {
            onSnapshotRef.current?.(snapshot);
            safeSetMessagesIfIdle(snapshot.messages ?? []);
            setIsSyncLoading(false);
          })
          .catch(() => setIsSyncLoading(false));
      } else {
        setIsSyncLoading(false);
      }
    }
  }, [
    appId,
    fetchRunSnapshot,
    runId,
    safeSetMessagesIfIdle,
    statusRef,
    workspaceId,
  ]));

  // A background tab can miss or delay BroadcastChannel-delivered workspace
  // events. When it becomes active again, catch up from the authorized run
  // snapshot and attach if the run is streaming.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const catchUpIfVisible = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (inFlight) return;
      const currentStatus = statusRef.current;
      if (currentStatus === "streaming" || currentStatus === "submitted") return;
      const url = chatApiUrlRef.current;
      if (!url) return;

      inFlight = true;
      try {
        const res = await fetchRunSnapshot(url);
        if (!res.ok || cancelled) return;
        const snapshot = (await res.json()) as ChatRunSnapshot;
        if (cancelled) return;
        onSnapshotRef.current?.(snapshot);
        safeSetMessagesIfIdle(snapshot.messages ?? []);
        if (snapshot.status === "streaming") {
          startLiveSyncRef.current({ force: true });
        } else {
          setShouldPoll(false);
          setIsSyncLoading(false);
        }
      } catch {
        // Focus catch-up is best-effort; realtime and later navigation can recover.
      } finally {
        inFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void catchUpIfVisible();
      }
    };
    const onFocus = () => {
      void catchUpIfVisible();
    };
    const onPageShow = () => {
      void catchUpIfVisible();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [fetchRunSnapshot, safeSetMessagesIfIdle, statusRef]);

  return isSyncLoading;
}

export function AppChat({
  workspaceId,
  appId,
  appName,
  initialPrompt,
  autoStartPrompt = null,
  autoStartKey = null,
  runId,
  initialMessages,
  initialRunAttachments = [],
  runStatus,
  initialRunFailure = null,
  toolRecoveryStatus = null,
  toolRecoveryToolName = null,
  panelMode = false,
  onBuildComplete,
  onStreamComplete,
  onStreamStart,
  onToolCallComplete,
  onReviewInvalidated,
  onDraftCreatedFromPublished,
  canApproveAgentConfig = false,
  agentConfigApprovalMode = "mock",
  agentsJsonApprovalSource = null,
  canManageIntegrations = false,
  initialRuntimeSettings,
  focusComposerKey = 0,
  dropEnabled = true,
}: AppChatProps) {

  const chatApi = runId
    ? `/api/workspaces/${workspaceId}/apps/${appId}/runs/${runId}/chat`
    : undefined;

  const [runtimeSettings, setRuntimeSettings] = useState(
    normalizeRuntimeSettings(initialRuntimeSettings ?? DEFAULT_RUNTIME_SETTINGS),
  );
  const [runFailure, setRunFailure] = useState<AgentRunFailure | null>(
    initialRunFailure,
  );
  const runtimeSettingsRef = useRef(runtimeSettings);
  useEffect(() => {
    runtimeSettingsRef.current = runtimeSettings;
  }, [runtimeSettings]);

  const notifyReviewInvalidated = useCallback(() => {
    onReviewInvalidated?.();
    toast.info("App changed. Review closed.", {
      description: "This app is back in draft. Send it for review again when ready.",
    });
  }, [onReviewInvalidated]);

  const notifyDraftCreated = useCallback(() => {
    onDraftCreatedFromPublished?.();
    toast.info("Editing draft.", {
      description: "The published app is unchanged. Publish or request review when this draft is ready.",
    });
  }, [onDraftCreatedFromPublished]);

  useEffect(() => {
    const normalized = normalizeRuntimeSettings(runtimeSettings);
    if (
      normalized.runtimeId !== runtimeSettings.runtimeId ||
      normalized.model !== runtimeSettings.model ||
      JSON.stringify(normalized.params) !== JSON.stringify(runtimeSettings.params)
    ) {
      setRuntimeSettings(normalized);
    }
  }, [runtimeSettings]);

  // Persist settings to the app document when they change
  const initialSettingsRef = useRef(runtimeSettings);
  useEffect(() => {
    const prev = initialSettingsRef.current;
    if (
      runtimeSettings.runtimeId === prev.runtimeId &&
      runtimeSettings.model === prev.model &&
      JSON.stringify(runtimeSettings.params) === JSON.stringify(prev.params)
    ) return;
    initialSettingsRef.current = runtimeSettings;
    fetch(`/api/workspaces/${workspaceId}/apps/${appId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runtimeId: runtimeSettings.runtimeId,
        runtimeModel: runtimeSettings.model,
        runtimeParams: runtimeSettings.params,
      }),
    }).catch(() => {});
  }, [runtimeSettings, workspaceId, appId]);

  // AbortController scoped to this component instance. Reconnect requests carry
  // its signal so unmount closes observer connections. Chat POST streams do not:
  // they are the authoritative path that drives onFinish persistence, so a
  // client-side route change must not explicitly abort them before MongoDB has
  // the final assistant/tool messages.
  const fetchAbortRef = useRef(new AbortController());
  const [liveSyncSuspended, setLiveSyncSuspended] = useState(false);
  useEffect(() => {
    // On each mount (including Strict-Mode remount) create a fresh
    // controller so that fetches after remount aren't pre-aborted.
    fetchAbortRef.current = new AbortController();
    return () => fetchAbortRef.current.abort();
  }, []);
  useEffect(() => {
    setLiveSyncSuspended(false);
    setRunFailure(initialRunFailure);
  }, [initialRunFailure, runId]);

  const releaseLiveObserversForNavigation = useCallback(() => {
    // A settings navigation can otherwise wait behind the current tab's
    // long-lived observer streams. Free those sockets before Next starts the
    // route transition; keep the authoritative chat POST alive so persistence
    // can still finish and replay can catch this tab up when it returns.
    fetchAbortRef.current.abort();
    fetchAbortRef.current = new AbortController();
    flushSync(() => setLiveSyncSuspended(true));
  }, []);

  const observerFetch = useCallback<typeof globalThis.fetch>(
    async (input, init) => {
      const timeoutController = new AbortController();
      const timeoutId = window.setTimeout(
        () => timeoutController.abort(),
        10000,
      );
      const signals = [
        timeoutController.signal,
        fetchAbortRef.current.signal,
        init?.signal,
      ].filter((signal): signal is AbortSignal => Boolean(signal));
      const signal =
        ((AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal })
          .any?.(signals) ?? signals[0]);

      try {
        return await globalThis.fetch(input, { ...init, signal });
      } finally {
        window.clearTimeout(timeoutId);
      }
    },
    [],
  );

  const transportFetch = useCallback<typeof globalThis.fetch>(
    async (input, init) => {
      const isChatPost = init?.method === "POST";
      const ownSignal = isChatPost ? undefined : fetchAbortRef.current.signal;
      const signal = ownSignal && init?.signal
        ? ((AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any?.([init.signal, ownSignal]) ?? ownSignal)
        : (ownSignal ?? init?.signal);

      const response = await globalThis.fetch(input, {
        ...init,
        signal,
      });
      if (
        isChatPost &&
        response.headers.get(REVIEW_INVALIDATED_HEADER) === "true"
      ) {
        notifyReviewInvalidated();
      } else if (
        isChatPost &&
        response.headers.get(DRAFT_CREATED_HEADER) === "true"
      ) {
        notifyDraftCreated();
      }
      return response;
    },
    [notifyDraftCreated, notifyReviewInvalidated],
  );

  const transport = useMemo(
    () =>
      chatApi
        ? new DefaultChatTransport({
            api: chatApi,
            fetch: (input, init) => transportFetch(input, init),
            prepareSendMessagesRequest: ({
              id,
              messages,
              trigger,
              messageId,
              body,
            }) => {
              const latest = runtimeSettingsRef.current;
              return {
                body: {
                  ...body,
                  id,
                  messages,
                  trigger,
                  messageId,
                  runtimeId: latest.runtimeId,
                  runtimeModel: latest.model,
                  runtimeParams: latest.params,
                },
              };
            },
            prepareReconnectToStreamRequest: ({ api }) => ({
              api: `${api}/stream`,
            }),
          })
        : undefined,
    [chatApi, transportFetch],
  );
  const { messages, sendMessage, status, error, setMessages, resumeStream, stop, clearError } =
    useChat({
      id: runId ?? undefined,
      messages: initialMessages,
      // Throttle how often useSyncExternalStore notifies React of new
      // messages. Without this, every streaming delta triggers a sync-priority
      // re-render that cancels any in-progress navigation transition, making
      // sidebar clicks unresponsive until the stream ends.
      experimental_throttle: 50,
      // Keep resume orchestration in useRunSync to avoid overlapping
      // resume-stream requests from multiple effects.
      ...(transport ? { transport } : {}),
    });

  // Defer message rendering so React can interrupt it for higher-priority
  // work like navigation. Live `messages` is still used by effects for
  // immediate callback dispatch (build-complete, tool-completion).
  const deferredMessages = useDeferredValue(messages);
  const displayMessages =
    status === "submitted" ? messages : deferredMessages;


  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const handleRunSnapshot = useCallback((snapshot: ChatRunSnapshot) => {
    if (!Object.prototype.hasOwnProperty.call(snapshot, "failure")) return;

    if (snapshot.status !== "failed") {
      setRunFailure(null);
      return;
    }

    const currentStatus = statusRef.current;
    if (currentStatus === "streaming" || currentStatus === "submitted") return;

    const snapshotMessageCount = snapshot.messages?.length;
    if (
      typeof snapshotMessageCount === "number" &&
      snapshotMessageCount < messagesRef.current.length
    ) {
      return;
    }

    setRunFailure(snapshot.failure ?? null);
  }, []);

  const isSyncLoading = useRunSync({
    workspaceId,
    appId,
    runId: liveSyncSuspended ? null : runId,
    chatApiUrl: chatApi ?? null,
    observerFetch,
    status,
    statusRef,
    setMessages,
    resumeStream,
    onSnapshot: handleRunSnapshot,
    initialRunStatus: runStatus,
    initialMessageCount: initialMessages.length,
  });
  const pendingApproval = useMemo(
    () => pendingBlockingApprovalFromMessages(messages),
    [messages],
  );
  const trackedApprovalShownRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!pendingApproval) return;

    const key = `${pendingApproval.kind}:${pendingApproval.toolCallId}`;
    if (trackedApprovalShownRef.current.has(key)) return;
    trackedApprovalShownRef.current.add(key);

    captureAnalyticsEvent("approval shown", {
      workspace_id: workspaceId,
      app_id: appId,
      run_id: runId,
      tool_call_id: pendingApproval.toolCallId,
      approval_type: pendingApproval.kind,
      ...pendingApproval.analytics,
    });
  }, [appId, pendingApproval, runId, workspaceId]);
  const latestAgentsToolCallId = useMemo(() => {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = messages[messageIndex];
      if (message.role !== "assistant") continue;
      const parts = message.parts ?? [];
      for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
        const part = parts[partIndex];
        const record = asRecord(part);
        if (
          record?.type === "dynamic-tool" &&
          record.toolName === "mcp__second__present_agents" &&
          record.state === "output-available" &&
          record.preliminary !== true &&
          typeof record.toolCallId === "string"
        ) {
          return record.toolCallId;
        }
      }
    }
    return null;
  }, [messages]);

  const requestedIntegrationSetup = useMemo(
    () => latestIntegrationSetupFromMessages(messages),
    [messages],
  );
  const requestedIntegrationSetupKey = useMemo(
    () =>
      requestedIntegrationSetup
        .map((integration) => {
          const permissions = integration.permissionGroups
            .flatMap((group) =>
              (group.permissions ?? []).map((permission) =>
                `${group.name}:${permission}`,
              ),
            )
            .join(",");
          const secrets = integration.secrets
            .map((secret) => `${secret.name}:${secret.required === false ? "optional" : "required"}`)
            .join(",");
          return `${normalizeDomain(integration.domain)}|${integration.keySlug ?? "default"}|${permissions}|${secrets}`;
        })
        .join(";"),
    [requestedIntegrationSetup],
  );
  const [appIntegrationKeys, setAppIntegrationKeys] = useState<
    AppIntegrationKeyStatus[] | null
  >(null);

  const fetchAppIntegrationKeys = useCallback(
    async (isCancelled?: () => boolean) => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/integrations`);
        if (!response.ok || isCancelled?.()) return;
        const data = await response.json();
        if (!isCancelled?.()) {
          setAppIntegrationKeys(normalizeAppIntegrationKeys(data));
        }
      } catch {
        // best effort: keep the callout visible until status can be checked
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (requestedIntegrationSetup.length === 0) {
      setAppIntegrationKeys(null);
      return;
    }

    let cancelled = false;
    void fetchAppIntegrationKeys(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [
    fetchAppIntegrationKeys,
    requestedIntegrationSetup.length,
    requestedIntegrationSetupKey,
  ]);

  useWorkspaceRealtimeEvent(useCallback((event) => {
    if (
      requestedIntegrationSetup.length === 0 ||
      event.workspaceId !== workspaceId ||
      event.scope !== "integrations"
    ) {
      return;
    }

    void fetchAppIntegrationKeys();
  }, [fetchAppIntegrationKeys, requestedIntegrationSetup.length, workspaceId]));

  const pendingIntegrationSetup = useMemo(() => {
    if (requestedIntegrationSetup.length === 0) return [];
    if (!appIntegrationKeys) return requestedIntegrationSetup;

    return requestedIntegrationSetup.filter((integration) => {
      const live = findLiveIntegrationKey(integration, appIntegrationKeys, appId);
      if (!live) return false;
      return integrationNeedsSetup(integration, live);
    });
  }, [appId, requestedIntegrationSetup, appIntegrationKeys]);

  const trackedIntegrationSetupCompletionKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (
      requestedIntegrationSetup.length === 0 ||
      !appIntegrationKeys ||
      pendingIntegrationSetup.length !== 0 ||
      trackedIntegrationSetupCompletionKeysRef.current.has(requestedIntegrationSetupKey)
    ) {
      return;
    }
    if (
      !requestedIntegrationSetup.every((integration) =>
        findLiveIntegrationKey(integration, appIntegrationKeys, appId),
      )
    ) {
      return;
    }

    trackedIntegrationSetupCompletionKeysRef.current.add(requestedIntegrationSetupKey);
    captureAnalyticsEvent("integration setup completed", {
      workspace_id: workspaceId,
      app_id: appId,
      ...integrationSetupAnalyticsProperties(requestedIntegrationSetup),
    });
  }, [
    appId,
    appIntegrationKeys,
    pendingIntegrationSetup.length,
    requestedIntegrationSetup,
    requestedIntegrationSetupKey,
    workspaceId,
  ]);

  const connectableOAuthIntegration = useMemo(() => {
    if (!appIntegrationKeys) return null;
    for (const integration of pendingIntegrationSetup) {
      const live = findLiveIntegrationKey(integration, appIntegrationKeys, appId);
      if (
        live?.authType === "oauth2" &&
        live.oauth?.providerConfigured &&
        live.oauth.providerConfigMatchesGrant &&
        !live.oauth.currentUserConnected
      ) {
        return live;
      }
    }
    return null;
  }, [appId, appIntegrationKeys, pendingIntegrationSetup]);

  const prevStatusRef = useRef(status);
  const buildCompleteNotified = useRef(false);
  const trackedDisplayedToolCallsRef = useRef<Set<string>>(new Set());
  const initializedDisplayedToolTrackingRef = useRef(false);
  const trackedBuildFailureRunIdsRef = useRef<Set<string>>(new Set());
  const trackedSuggestionToolCallsRef = useRef<Set<string>>(new Set());
  const initializedSuggestionToolTrackingRef = useRef(false);

  // Use refs for callbacks to avoid re-triggering the status effect
  const onStreamCompleteRef = useRef(onStreamComplete);
  const onStreamStartRef = useRef(onStreamStart);
  const onBuildCompleteRef = useRef(onBuildComplete);
  const onToolCallCompleteRef = useRef(onToolCallComplete);
  useEffect(() => {
    onStreamCompleteRef.current = onStreamComplete;
    onStreamStartRef.current = onStreamStart;
    onBuildCompleteRef.current = onBuildComplete;
    onToolCallCompleteRef.current = onToolCallComplete;
  });

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    // Notify parent when streaming starts
    if (
      (status === "streaming" || status === "submitted") &&
      prev === "ready"
    ) {
      onStreamStartRef.current?.();
    }

    // When streaming just finished, fetch fresh usage
    if (
      status === "ready" &&
      (prev === "streaming" || prev === "submitted") &&
      chatApi
    ) {
      fetch(chatApi)
        .then((res) => res.json())
        .then((data: ChatRunSnapshot) => {
          handleRunSnapshot(data);
          if (data.usage) {
            onStreamCompleteRef.current?.(data.usage);
          } else {
            onStreamCompleteRef.current?.(null);
          }
        })
        .catch(() => onStreamCompleteRef.current?.(null));
    }
  }, [status, chatApi, handleRunSnapshot]);

  // Detect done_building tool in messages
  useEffect(() => {
    if (buildCompleteNotified.current) return;
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const part of msg.parts ?? []) {
        if (
          part?.type === "dynamic-tool" &&
          part.toolName === "mcp__second__done_building" &&
          part.state === "output-available" &&
          part.preliminary !== true &&
          isDoneBuildingSuccessOutput(part.output)
        ) {
          buildCompleteNotified.current = true;
          onBuildCompleteRef.current?.();
          return;
        }
      }
    }
  }, [messages]);

  useEffect(() => {
    const displayedCalls: Array<{
      id: string;
      output: unknown;
    }> = [];

    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const part of msg.parts ?? []) {
        if (
          part?.type === "dynamic-tool" &&
          part.toolName === "mcp__second__done_building" &&
          part.state === "output-available" &&
          part.preliminary !== true &&
          typeof part.toolCallId === "string" &&
          isDoneBuildingSuccessOutput(part.output)
        ) {
          displayedCalls.push({ id: part.toolCallId, output: part.output });
        }
      }
    }

    if (!initializedDisplayedToolTrackingRef.current) {
      initializedDisplayedToolTrackingRef.current = true;
      trackedDisplayedToolCallsRef.current = new Set(
        displayedCalls.map((call) => call.id),
      );
      return;
    }

    for (const call of displayedCalls) {
      if (trackedDisplayedToolCallsRef.current.has(call.id)) continue;
      trackedDisplayedToolCallsRef.current.add(call.id);
      const payload = parseDoneBuildingOutput(call.output);
      captureAnalyticsEvent("build completed", {
        workspace_id: workspaceId,
        app_id: appId,
        run_id: runId,
        tool_call_id: call.id,
        runtime_id: runtimeSettings.runtimeId,
        runtime_model: runtimeSettings.model,
        runtime_model_family: runtimeModelFamily(runtimeSettings.model),
        file_count: payload?.fileCount,
        total_bytes: payload?.totalBytes,
        has_warning: Boolean(payload?.warning),
        ...chatAnalyticsSummary(messages),
      });
      captureAnalyticsEvent("app displayed", {
        workspace_id: workspaceId,
        app_id: appId,
        run_id: runId,
        tool_call_id: call.id,
        file_count: payload?.fileCount,
        total_bytes: payload?.totalBytes,
        has_warning: Boolean(payload?.warning),
      });
    }
  }, [appId, messages, runId, runtimeSettings.model, runtimeSettings.runtimeId, workspaceId]);

  useEffect(() => {
    if (!runId || trackedBuildFailureRunIdsRef.current.has(runId)) return;

    const streamError = error ?? null;
    const failedByStatus = runStatus === "failed";
    if (!streamError && !failedByStatus) return;

    trackedBuildFailureRunIdsRef.current.add(runId);
    captureAnalyticsEvent("build failed", {
      workspace_id: workspaceId,
      app_id: appId,
      run_id: runId,
      runtime_id: runtimeSettings.runtimeId,
      runtime_model: runtimeSettings.model,
      runtime_model_family: runtimeModelFamily(runtimeSettings.model),
      failure_phase: streamError ? "client_stream" : "run_status",
      error_code: streamError?.name ?? "run_failed",
      error: streamError?.message,
      ...chatAnalyticsSummary(messages),
    });
  }, [
    appId,
    error,
    messages,
    runId,
    runStatus,
    runtimeSettings.model,
    runtimeSettings.runtimeId,
    workspaceId,
  ]);

  const reportedChatErrorsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!error || !runId) return;
    const key = `${runId}:${error.name}:${error.message}`;
    if (reportedChatErrorsRef.current.has(key)) return;
    reportedChatErrorsRef.current.add(key);
    void reportClientError({
      source: "chat-stream",
      error,
      context: {
        component: "AppChat",
        workspaceId,
        appId,
        runId,
        runStatus,
        runtimeId: runtimeSettings.runtimeId,
        runtimeModel: runtimeSettings.model,
        chatStatus: status,
        online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
        visibilityState:
          typeof document !== "undefined" ? document.visibilityState : undefined,
      },
    });
  }, [
    appId,
    error,
    runId,
    runStatus,
    runtimeSettings.model,
    runtimeSettings.runtimeId,
    status,
    workspaceId,
  ]);

  useEffect(() => {
    const suggestionCalls: Array<{
      id: string;
      suggestions: BuildSuggestion[];
    }> = [];

    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const part of msg.parts ?? []) {
        if (
          part?.type !== "dynamic-tool" ||
          part.toolName !== "mcp__second__present_suggestions" ||
          part.state !== "output-available" ||
          part.preliminary === true ||
          typeof part.toolCallId !== "string"
        ) {
          continue;
        }

        const toolInput = part.input as Record<string, unknown> | undefined;
        const inputSuggestions = suggestionsFromPresentSuggestionsInput(
          toolInput,
        );
        const outputSuggestions = suggestionsFromPresentSuggestionsOutput(
          part.output,
        );
        const suggestions = inputSuggestions.length > 0
          ? inputSuggestions
          : outputSuggestions;

        if (suggestions.length > 0) {
          suggestionCalls.push({ id: part.toolCallId, suggestions });
        }
      }
    }

    if (!initializedSuggestionToolTrackingRef.current) {
      initializedSuggestionToolTrackingRef.current = true;
      trackedSuggestionToolCallsRef.current = new Set(
        suggestionCalls.map((call) => call.id),
      );
      return;
    }

    for (const call of suggestionCalls) {
      if (trackedSuggestionToolCallsRef.current.has(call.id)) continue;
      trackedSuggestionToolCallsRef.current.add(call.id);
      captureAnalyticsEvent("showed suggestions tool called", {
        workspace_id: workspaceId,
        app_id: appId,
        run_id: runId,
        tool_call_id: call.id,
        suggestion_count: call.suggestions.length,
        suggestion_titles: call.suggestions.map((suggestion) => suggestion.title),
        suggestions: call.suggestions,
      });
    }
  }, [appId, messages, runId, workspaceId]);

  // Detect tool completions and notify parent so it can refresh file explorer state.
  const seenCompletedToolCallsRef = useRef<Set<string>>(new Set());
  const initializedToolCompletionTrackingRef = useRef(false);
  useEffect(() => {
    const completedCalls: Array<{ id: string; name: string }> = [];
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const part of msg.parts ?? []) {
        if (
          part?.type === "dynamic-tool" &&
          part.state === "output-available" &&
          part.preliminary !== true &&
          typeof part.toolCallId === "string" &&
          part.toolCallId
        ) {
          completedCalls.push({ id: part.toolCallId, name: part.toolName });
        }
      }
    }

    if (!initializedToolCompletionTrackingRef.current) {
      initializedToolCompletionTrackingRef.current = true;
      seenCompletedToolCallsRef.current = new Set(completedCalls.map((c) => c.id));
      return;
    }

    for (const call of completedCalls) {
      if (seenCompletedToolCallsRef.current.has(call.id)) continue;
      seenCompletedToolCallsRef.current.add(call.id);
      onToolCallCompleteRef.current?.(call.name, call.id);
    }
  }, [messages]);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copiedMessageResetRef = useRef<number | null>(null);
  const hasSentInitial = useRef(false);
  const validatedInitialRunRef = useRef<string | null>(null);
  const hydratedRunRef = useRef<string | null>(null);
  const lastRunIdRef = useRef(runId);
  const lastAutoStartKeyRef = useRef<string | null>(autoStartKey);

  useEffect(() => {
    if (focusComposerKey <= 0) return;
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusComposerKey]);
  useEffect(() => {
    return () => {
      if (copiedMessageResetRef.current !== null) {
        window.clearTimeout(copiedMessageResetRef.current);
      }
    };
  }, []);
  const sendMessageSafely = useCallback(
    (
      text: string,
      attachmentsToSend: AttachmentReference[] = [],
      extraBody: Record<string, unknown> = {},
      messageId?: string,
    ) => {
      statusRef.current = "submitted";
      setLiveSyncSuspended(false);
      setRunFailure(null);
      clearError();
      const attachmentBody =
        attachmentsToSend.length > 0
          ? { attachments: attachmentsToSend }
          : undefined;
      const body = {
        ...extraBody,
        ...(attachmentBody ?? {}),
      };
      const metadata =
        attachmentsToSend.length > 0
          ? { attachments: attachmentsToSend }
          : undefined;
      void sendMessage(
        {
          text,
          ...(metadata ? { metadata } : {}),
          ...(messageId ? { messageId } : {}),
        },
        Object.keys(body).length > 0 ? { body } : undefined,
      );
    },
    [clearError, sendMessage],
  );
  const canStopActiveRun = useMemo(
    () => status === "streaming" && latestAssistantTurnHasStarted(messages),
    [messages, status],
  );
  const stopBuilderRun = useCallback(async () => {
    if (!canStopActiveRun) return;
    if (!chatApi) {
      stop();
      return;
    }

    setIsStopping(true);
    setLiveSyncSuspended(true);
    let stopSucceeded = false;
    try {
      const response = await fetch(`${chatApi}/stop`, {
        method: "POST",
        cache: "no-store",
      });
      const snapshot = (await response.json().catch(() => null)) as
        | { failure?: AgentRunFailure | null; workerCancelled?: boolean; error?: string }
        | null;
      if (snapshot?.failure) setRunFailure(snapshot.failure);
      if (!response.ok) {
        toast.error("Could not stop the run.", {
          description: snapshot?.error ?? "Please try again.",
        });
      } else {
        stopSucceeded = true;
      }
      if (response.ok && snapshot?.failure?.code === "worker_cancel_failed") {
        toast.info("Run stopped locally.", {
          description: "The worker did not confirm cancellation, so this was reported.",
        });
      }
    } catch (stopError) {
      toast.error("Could not stop the run.", {
        description:
          stopError instanceof Error ? stopError.message : "Network error.",
      });
      void reportClientError({
        source: "chat-stream",
        error: stopError,
        context: {
          component: "AppChat.stopBuilderRun",
          workspaceId,
          appId,
          runId,
        },
      });
    } finally {
      stop();
      clearError();
      setIsStopping(false);
      if (!stopSucceeded) {
        setLiveSyncSuspended(false);
      }
    }
  }, [appId, canStopActiveRun, chatApi, clearError, runId, stop, workspaceId]);
  const isBusy =
    status === "streaming" || status === "submitted" || isSyncLoading || isStopping;
  const [assistantActionsReady, setAssistantActionsReady] = useState(!isBusy);
  useEffect(() => {
    if (isBusy) {
      setAssistantActionsReady(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setAssistantActionsReady(true);
    }, 160);

    return () => window.clearTimeout(timer);
  }, [isBusy]);
  const isUploadingAttachments = attachments.some(
    (attachment) => attachment.status === "uploading",
  );
  const addFiles = useCallback((files: File[]) => {
    if (!chatApi) return;
    const remainingSlots = MAX_ATTACHMENT_FILES - attachments.length;
    if (remainingSlots <= 0) {
      toast.error(`You can attach up to ${MAX_ATTACHMENT_FILES} files.`);
      return;
    }

    const currentBytes = attachments.reduce((sum, item) => sum + item.size, 0);
    const accepted: File[] = [];
    let nextBytes = currentBytes;

    for (const file of files.slice(0, remainingSlots)) {
      if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
        toast.error(`${file.name} is too large.`, {
          description: `Each file can be up to ${formatAttachmentSize(MAX_ATTACHMENT_FILE_BYTES)}.`,
        });
        continue;
      }
      if (nextBytes + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
        toast.error("Attachment upload is too large.", {
          description: `Total attachments can be up to ${formatAttachmentSize(MAX_ATTACHMENT_TOTAL_BYTES)}.`,
        });
        break;
      }
      accepted.push(file);
      nextBytes += file.size;
    }

    if (files.length > remainingSlots) {
      toast.error(`Only ${remainingSlots} more file${remainingSlots === 1 ? "" : "s"} can be attached.`);
    }
    if (accepted.length === 0) return;

    const pendingAttachments = accepted.map((file) => ({
      ...createComposerAttachment(file),
      status: "uploading" as const,
    }));
    setAttachments((current) => [...current, ...pendingAttachments]);

    void uploadComposerAttachments({
      workspaceId,
      appId,
      attachments: pendingAttachments,
    })
      .then((uploaded) => {
        setAttachments((current) =>
          current.map((attachment) => {
            const match = uploaded.find((item) => item.id === attachment.id);
            return match
              ? {
                  ...attachment,
                  path: match.path,
                  size: match.size,
                  contentType: match.contentType,
                  status: "uploaded",
                }
              : attachment;
          }),
        );
      })
      .catch((error) => {
        const description =
          error instanceof Error ? error.message : "Upload failed.";
        setAttachments((current) =>
          current.map((attachment) =>
            pendingAttachments.some((item) => item.id === attachment.id)
              ? {
                  ...attachment,
                  status: "error",
                  error: description,
                }
              : attachment,
          ),
        );
        toast.error("Could not attach file.", { description });
      });
  }, [appId, attachments, chatApi, workspaceId]);

  const isDraggingFiles = useWindowFileDrop({
    enabled: dropEnabled && Boolean(chatApi) && !pendingApproval && !isBusy,
    onFiles: addFiles,
  });

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);
  const [mockApprovedToolCallIds, setMockApprovedToolCallIds] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    if (agentsJsonApprovalSource === "build_chat_mock") return;
    setMockApprovedToolCallIds(new Set());
  }, [agentsJsonApprovalSource]);

  const approveAgentsConfiguration = useCallback(async (
    agentsJson: AgentsCardData,
    toolCallId: string,
  ) => {
    if (!canApproveAgentConfig) {
      toast.error("Agent config approval requires a workspace admin.", {
        description:
          "You can keep editing the draft, but live agent tools need review before they run.",
      });
      return;
    }

    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/apps/${appId}/agents/approval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentsJson }),
        },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        toast.error("Could not approve agent config.", {
          description:
            json?.message ??
            (json?.error === "invalid_agents_json"
              ? "agents.json is invalid."
              : "Please review the draft and try again."),
        });
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | { mockOnly?: boolean }
        | null;
      const approvalMode =
        json?.mockOnly || agentConfigApprovalMode === "mock"
          ? "mock"
          : "live";
      captureAnalyticsEvent("approval acted", {
        workspace_id: workspaceId,
        app_id: appId,
        run_id: runId,
        tool_call_id: toolCallId,
        approval_type: "agents",
        action: "approved",
        approval_mode: approvalMode,
        agent_count: agentsJson.agents.length,
      });
      captureAnalyticsEvent("agents approved", {
        workspace_id: workspaceId,
        app_id: appId,
        run_id: runId,
        tool_call_id: toolCallId,
        approval_mode: approvalMode,
        agent_count: agentsJson.agents.length,
        agent_ids: agentsJson.agents.map((agent) => agent.id),
        agent_names: agentsJson.agents.map((agent) => agent.name),
        agents: agentsJson.agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          tool_count: agent.tools.length,
          data_collection_count: agent.dataCollections?.length ?? 0,
        })),
      });

      if (approvalMode === "mock") {
        setMockApprovedToolCallIds((current) => new Set(current).add(toolCallId));
        toast.success("Agents approved for mock-data development.", {
          description:
            "Real data from integrations still requires review by a workspace admin or owner.",
        });
        sendMessageSafely(
          "Agents approved for mock-data development. Continue building, but use mock data for integrations until live credentials are approved.",
        );
        return;
      }

      toast.success("Agent config approved.", {
        description: "This exact agents.json revision can use live runtime tools.",
      });
      sendMessageSafely(
        "Agents approved. Continue with integration setup and implementation.",
      );
    } catch {
      toast.error("Could not approve agent config.", {
        description: "Network error while saving the approval.",
      });
    }
  }, [agentConfigApprovalMode, appId, canApproveAgentConfig, runId, sendMessageSafely, workspaceId]);

  useEffect(() => {
    if (lastRunIdRef.current === runId) return;
    lastRunIdRef.current = runId;
    hasSentInitial.current = false;
    validatedInitialRunRef.current = null;
    hydratedRunRef.current = null;
    setEditingMessageId(null);
    setEditingText("");
    setCopiedMessageId(null);
  }, [runId]);

  useEffect(() => {
    if (!autoStartKey || lastAutoStartKeyRef.current === autoStartKey) return;
    lastAutoStartKeyRef.current = autoStartKey;
    hasSentInitial.current = false;
    validatedInitialRunRef.current = null;
  }, [autoStartKey]);

  useEffect(() => {
    if (!runId || !chatApi) return;
    if (initialMessages.length === 0 && runStatus === "pending") return;
    if (hydratedRunRef.current === runId) return;
    hydratedRunRef.current = runId;

    let cancelled = false;
    fetch(chatApi, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: ChatRunSnapshot | null,
        ) => {
          if (cancelled) return;
          if (!data) {
            hydratedRunRef.current = null;
            return;
          }
          handleRunSnapshot(data);
          if (
            statusRef.current === "streaming" ||
            statusRef.current === "submitted"
          ) {
            return;
          }

          const latestMessages = sanitizeMessages(data.messages ?? []);
          const latestStatus = data.status ?? null;
          if (
            latestMessages.length > initialMessages.length ||
            latestStatus !== runStatus
          ) {
            setMessages(latestMessages);
          }
        },
      )
      .catch(() => {
        hydratedRunRef.current = null;
      });

    return () => {
      cancelled = true;
      if (hydratedRunRef.current === runId) {
        hydratedRunRef.current = null;
      }
    };
  }, [runId, chatApi, handleRunSnapshot, initialMessages.length, runStatus, setMessages]);

  useEffect(() => {
    const hasScheduledAutoStart = Boolean(autoStartPrompt?.trim());
    if (
      runId &&
      chatApi &&
      runStatus === "pending" &&
      (initialMessages.length === 0 || hasScheduledAutoStart) &&
      !hasSentInitial.current
    ) {
      if (validatedInitialRunRef.current === runId) return;
      validatedInitialRunRef.current = runId;

      let cancelled = false;
      fetch(chatApi, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (
          data: ChatRunSnapshot | null,
        ) => {
          if (cancelled) return;
          if (!data) {
            validatedInitialRunRef.current = null;
            return;
          }
          handleRunSnapshot(data);

            const latestMessages = sanitizeMessages(data?.messages ?? []);
            const latestStatus = data?.status ?? null;
            const shouldAutoStart =
              latestStatus === "pending" &&
              (latestMessages.length === 0 || hasScheduledAutoStart);

            if (shouldAutoStart) {
              if (latestMessages.length > initialMessages.length) {
                setMessages(latestMessages);
              }
              hasSentInitial.current = true;
              sendMessageSafely(
                autoStartPrompt?.trim() || initialPrompt || appName,
                hasScheduledAutoStart ? [] : initialRunAttachments,
              );
              return;
            }

            if (latestMessages.length > 0 || latestStatus !== "pending") {
              setMessages(latestMessages);
            }
          },
        )
        .catch(() => {
          validatedInitialRunRef.current = null;
        });

      return () => {
        cancelled = true;
        if (!hasSentInitial.current && validatedInitialRunRef.current === runId) {
          validatedInitialRunRef.current = null;
        }
      };
    }
  }, [runId, chatApi, handleRunSnapshot, initialMessages.length, runStatus, autoStartPrompt, initialPrompt, appName, initialRunAttachments, setMessages, sendMessageSafely]);

  function handleSubmit() {
    const readyAttachments = attachments.filter(
      (attachment) => attachment.status === "uploaded",
    );
    const isUploadingAttachments = attachments.some(
      (attachment) => attachment.status === "uploading",
    );
    const text = input.trim() || (readyAttachments.length > 0 ? "Use the attached files." : "");
    if (
      !text ||
      pendingApproval ||
      status === "streaming" ||
      status === "submitted" ||
      isSyncLoading ||
      isUploadingAttachments ||
      !chatApi
    )
      return;
    captureAnalyticsEvent("chat initiated", {
      workspace_id: workspaceId,
      app_id: appId,
      run_id: runId,
      source: "app_chat",
      agent_type: "builder",
      runtime_id: runtimeSettings.runtimeId,
      runtime_model: runtimeSettings.model,
      runtime_model_family: runtimeModelFamily(runtimeSettings.model),
      attachment_count: readyAttachments.length,
      ...textAnalyticsProperties("message", text),
    });
    sendMessageSafely(text, readyAttachments.map(attachmentReference));
    setInput("");
    if (readyAttachments.length > 0) {
      setAttachments((current) =>
        current.filter((attachment) => attachment.status !== "uploaded"),
      );
    }
  }

  const readyAttachmentCount = attachments.filter(
    (attachment) => attachment.status === "uploaded",
  ).length;
  const pendingApprovalPlaceholder =
    pendingApproval?.kind === "plan"
      ? "Approve or request changes to the plan to continue..."
      : pendingApproval?.kind === "suggestions"
        ? "Choose a suggestion to continue..."
      : pendingApproval?.kind === "agents"
        ? "Approve or request changes to the agents to continue..."
        : "Send a message...";
  const firstUserMessageId = useMemo(
    () => messages.find((message) => message.role === "user")?.id ?? null,
    [messages],
  );
  const retryTurn = useMemo(() => latestUserTurn(messages), [messages]);
  const retryText = retryTurn?.text ?? "";
  const hasRenderedErrorPart = useMemo(
    () =>
      displayMessages
        .slice(retryTurn ? retryTurn.index + 1 : 0)
        .some((message) =>
          (message.parts ?? []).some((part) => asRecord(part)?.type === "error"),
        ),
    [displayMessages, retryTurn],
  );
  const routeFailureStillCurrent =
    runStatus === "failed" && messages.length <= initialMessages.length;
  const isUserStopped = isUserStoppedFailure(runFailure);
  const visibleFailureMessage = useMemo(() => {
    if (isUserStopped) return "Second's response was stopped by the user.";
    if (runFailure?.message) return runFailure.message;
    if (error instanceof TypeError) {
      return "The stream disconnected. Retry the last message to continue.";
    }
    if (error?.message) return error.message;
    if (routeFailureStillCurrent) {
      return "The run failed. Retry the last message to continue.";
    }
    return null;
  }, [error, isUserStopped, routeFailureStillCurrent, runFailure]);
  const failureRetryable =
    Boolean(retryText) &&
    (runFailure?.retryable ?? (Boolean(error) || routeFailureStillCurrent));
  const showFailureRow =
    !isBusy &&
    !hasRenderedErrorPart &&
    Boolean(visibleFailureMessage) &&
    (Boolean(error) || Boolean(runFailure) || routeFailureStillCurrent);
  const messageMutationDisabled = isBusy || Boolean(pendingApproval) || !chatApi;
  const attachmentsForUserMessage = useCallback(
    (message: UIMessage): AttachmentReference[] => {
      const attachmentsForRetry = messageAttachments(message);
      if (attachmentsForRetry.length > 0) return attachmentsForRetry;
      return message.id === firstUserMessageId ? initialRunAttachments : [];
    },
    [firstUserMessageId, initialRunAttachments],
  );
  const markMessageCopied = useCallback((messageId: string) => {
    if (copiedMessageResetRef.current !== null) {
      window.clearTimeout(copiedMessageResetRef.current);
    }
    setCopiedMessageId(messageId);
    copiedMessageResetRef.current = window.setTimeout(() => {
      setCopiedMessageId((current) => current === messageId ? null : current);
      copiedMessageResetRef.current = null;
    }, 1400);
  }, []);
  const copyMessageText = useCallback(async (messageId: string, text: string) => {
    if (!text.trim()) {
      toast.info("Nothing to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      markMessageCopied(messageId);
    } catch (copyError) {
      toast.error("Could not copy message.", {
        description:
          copyError instanceof Error ? copyError.message : "Clipboard access failed.",
      });
    }
  }, [markMessageCopied]);
  const rerunUserMessage = useCallback(
    (
      messageId: string,
      options: {
        text?: string;
        source: "failure_retry" | "assistant_retry" | "user_edit";
      },
    ) => {
      if (messageMutationDisabled) return;
      const messageIndex = messages.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) return;

      const currentMessage = messages[messageIndex];
      if (currentMessage.role !== "user") return;
      const nextText = (options.text ?? messageText(currentMessage)).trim();
      if (!nextText) return;

      const attachmentsForRetry = attachmentsForUserMessage(currentMessage);
      const nextUserMessage = messageWithEditedText(currentMessage, nextText);
      const nextMessages = [
        ...messages.slice(0, messageIndex),
        nextUserMessage,
      ];

      setRunFailure(null);
      clearError();
      setEditingMessageId(null);
      setEditingText("");
      flushSync(() => setMessages(nextMessages));
      sendMessageSafely(
        nextText,
        attachmentsForRetry,
        { retryLastMessageId: currentMessage.id },
        currentMessage.id,
      );
      captureAnalyticsEvent(
        options.source === "user_edit" ? "chat edit submitted" : "chat retry clicked",
        {
          workspace_id: workspaceId,
          app_id: appId,
          run_id: runId,
          retry_mode: "rerun_user_turn",
          action_source: options.source,
          failure_code: runFailure?.code ?? error?.name ?? null,
        },
      );
    },
    [
      appId,
      attachmentsForUserMessage,
      clearError,
      error,
      messageMutationDisabled,
      messages,
      runFailure,
      runId,
      sendMessageSafely,
      setMessages,
      workspaceId,
    ],
  );
  const retryLastTurn = useCallback(() => {
    if (!retryTurn) return;
    rerunUserMessage(retryTurn.message.id, { source: "failure_retry" });
  }, [rerunUserMessage, retryTurn]);
  const submitEditedMessage = useCallback(() => {
    if (!editingMessageId) return;
    rerunUserMessage(editingMessageId, {
      text: editingText,
      source: "user_edit",
    });
  }, [editingMessageId, editingText, rerunUserMessage]);
  const cancelEditingMessage = useCallback(() => {
    setEditingMessageId(null);
    setEditingText("");
  }, []);
  const startEditingMessage = useCallback((message: UIMessage) => {
    if (messageMutationDisabled) return;
    setEditingMessageId(message.id);
    setEditingText(messageText(message));
  }, [messageMutationDisabled]);

  // Auto-grow textarea before paint so the empty composer does not flash short.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(
      COMPOSER_TEXTAREA_MIN_HEIGHT,
      Math.min(ta.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT),
    )}px`;
  }, [input, pendingApprovalPlaceholder, panelMode]);

  return (
    <div className="relative min-h-0 flex-1">
      <AttachmentDropOverlay visible={isDraggingFiles} />
      {/* Scrollable message area — absolute so it doesn't push the input */}
      <div className="absolute inset-0 flex flex-col">
        <StickToBottom
          className="relative flex-1 overflow-y-hidden"
          resize="smooth"
        >
          <StickToBottom.Content className={`mx-auto space-y-6 p-4 pb-48 ${panelMode ? "max-w-full px-3" : "max-w-[720px] sm:p-6 sm:pb-48"}`}>
            {displayMessages.map((msg, messageIndex) => {
              if (msg.role === "user") {
                const attachmentsForMessage = messageAttachments(msg);
                const displayAttachments =
                  attachmentsForMessage.length > 0
                    ? attachmentsForMessage
                    : msg.id === firstUserMessageId
                      ? initialRunAttachments
                      : [];
                const textParts = msg.parts
                  .filter((p) => p.type === "text")
                  .filter((p) =>
                    !isAttachmentOnlyPlaceholder(p.text, displayAttachments),
                  );
                const userText = messageText(msg);
                if (editingMessageId === msg.id) {
                  return (
                    <div key={msg.id} className="flex w-full justify-end">
                      <UserMessageEditor
                        value={editingText}
                        attachments={displayAttachments}
                        disabled={messageMutationDisabled}
                        onChange={setEditingText}
                        onCancel={cancelEditingMessage}
                        onSubmit={submitEditedMessage}
                      />
                    </div>
                  );
                }
                return (
                  <div key={msg.id} className="group flex justify-end">
                    <div className="flex max-w-[80%] flex-col items-end">
                      <div className="flex max-w-full flex-col gap-2 rounded-2xl bg-[#F4F4F4] px-4 py-2.5 text-sm text-foreground dark:bg-[#2A2B2F]">
                        {textParts.length > 0 ? (
                          <div>
                            {textParts.map((p, i) => (
                              <span key={i} className="whitespace-pre-wrap">
                                {p.text}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <UserMessageAttachments attachments={displayAttachments} />
                      </div>
                      <div className="mt-1 flex h-8 items-center justify-end gap-1 opacity-0 transition-opacity duration-300 ease-out pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                        <MessageActionButton
                          label="Copy message"
                          icon={CopyIcon}
                          active={copiedMessageId === msg.id}
                          activeIcon={CheckIcon}
                          onClick={() => void copyMessageText(msg.id, userText)}
                        />
                        <MessageActionButton
                          label="Edit message"
                          icon={PencilIcon}
                          disabled={messageMutationDisabled}
                          onClick={() => startEditingMessage(msg)}
                        />
                      </div>
                    </div>
                  </div>
                );
              }

              const seenReasoning = new Set<string>();
              const assistantText = messageText(msg);
              const assistantHasContent = assistantHasVisibleContent(msg);
              const assistantTurnEnded =
                assistantTurnHasEnded(displayMessages, messageIndex) ||
                assistantActionsReady;
              const canShowAssistantActions =
                assistantActionsReady &&
                assistantHasContent &&
                assistantTurnEnded;
              const retryUserTurn = findUserTurnBeforeMessage(messages, msg.id);

              return (
                <PartErrorBoundary key={msg.id}>
                  <div className="space-y-3.5">
                    {(msg.parts ?? []).map((part, i) => {
                      if (!part || typeof part !== "object") return null;
                      const partRecord = asRecord(part);

                      if (partRecord?.type === "error") {
                        const errorText =
                          typeof partRecord.errorText === "string"
                            ? partRecord.errorText
                            : "The run failed. Retry the last message to continue.";
                        return (
                          <ChatFailureRow
                            key={`error-${msg.id}:${i}`}
                            message={errorText}
                            retryable={failureRetryable}
                            retryDisabled={isBusy || !retryText}
                            onRetry={retryLastTurn}
                          />
                        );
                      }

                      if (part.type === "text" && part.text.trim()) {
                        return (
                          <div key={i} className="prose prose-sm dark:prose-invert max-w-none leading-relaxed prose-code:before:content-none prose-code:after:content-none text-foreground prose-strong:text-foreground prose-blockquote:border-border prose-hr:border-border prose-headings:font-semibold">
                            <MemoMarkdown text={part.text} />
                          </div>
                        );
                      }

                      if (part.type === "reasoning" && part.text.trim()) {
                        const parts = msg.parts ?? [];
                        const trimmed = part.text.trim();
                        if (seenReasoning.has(trimmed)) return null;
                        seenReasoning.add(trimmed);
                        const reasoningDone =
                          part.state === "done" ||
                          i < parts.length - 1 ||
                          (part.state !== "streaming" && status !== "streaming");

                        return (
                          <Reasoning
                            key={`reasoning-${i}`}
                            done={reasoningDone}
                            storageKey={`${msg.id}:reasoning:${i}`}
                          >
                            <ReasoningTrigger />
                            <ReasoningContent>{part.text}</ReasoningContent>
                          </Reasoning>
                        );
                      }

                      if (part.type === "dynamic-tool") {
                        const toolState = part.state ?? "input-streaming";
                        const isPreliminary =
                          part.state === "output-available" &&
                          part.preliminary === true;
                        const isRunning =
                          toolState === "input-available" ||
                          toolState === "input-streaming" ||
                          isPreliminary;
                        const isStreaming = toolState === "input-streaming";
                        const isDone = toolState === "output-available" && !isPreliminary;
                        const toolInput = part.input as Record<string, unknown> | undefined;
                        const outputText = toolState === "output-available"
                          ? formatToolOutput(part.output)
                          : null;
                        const toolPartKey =
                          typeof part.toolCallId === "string" && part.toolCallId
                            ? part.toolCallId
                            : `${msg.id}:${i}`;

                        // Hide internal SDK tools (ToolSearch, etc.)
                        if (part.toolName === "ToolSearch") return null;

                        if (part.toolName === "Skill") {
                          return (
                            <SkillToolCard
                              key={`tool-${toolPartKey}`}
                              input={toolInput}
                              isRunning={isRunning}
                              isDone={isDone}
                            />
                          );
                        }

                        // Done building → compact status card
                        if (part.toolName === "mcp__second__done_building") {
                          return (
                            <DoneBuildingCard
                              key={`tool-${toolPartKey}`}
                              toolCallId={part.toolCallId}
                              state={part.state}
                              output={part.output}
                            />
                          );
                        }

                        // Suggestions tool → clickable build suggestion cards
                        if (part.toolName === "mcp__second__present_suggestions") {
                          const inputSuggestions = suggestionsFromPresentSuggestionsInput(
                            toolInput,
                          );
                          const outputSuggestions = suggestionsFromPresentSuggestionsOutput(
                            part.output,
                          );
                          const suggestions = inputSuggestions.length > 0
                            ? inputSuggestions
                            : outputSuggestions;
                          const isCurrentApproval =
                            pendingApproval?.toolCallId === part.toolCallId;

                          return (
                            <SuggestionsCard
                              key={`tool-${toolPartKey}`}
                              suggestions={suggestions}
                              actionsEnabled={
                                isCurrentApproval && suggestions.length > 0 && !isBusy
                              }
                              onSelectSuggestion={(title) => {
                                captureAnalyticsEvent("approval acted", {
                                  workspace_id: workspaceId,
                                  app_id: appId,
                                  run_id: runId,
                                  tool_call_id: part.toolCallId,
                                  approval_type: "suggestions",
                                  action: "picked_suggestion",
                                  suggestion_count: suggestions.length,
                                });
                                captureAnalyticsEvent("suggestion picked", {
                                  workspace_id: workspaceId,
                                  app_id: appId,
                                  run_id: runId,
                                  tool_call_id: part.toolCallId,
                                  suggestion_title: title,
                                  suggestion_titles: suggestions.map(
                                    (suggestion) => suggestion.title,
                                  ),
                                });
                                sendMessageSafely(`Please build ${title}`);
                              }}
                            />
                          );
                        }

                        // Plan tool → PlanCard
                        if (part.toolName === "mcp__second__present_plan") {
                          const plan = planDataFromPresentPlanInput(toolInput);
                          const isCurrentApproval =
                            pendingApproval?.toolCallId === part.toolCallId;
                          return (
                            <PlanCard
                              key={`tool-${toolPartKey}`}
                              plan={plan}
                              isStreaming={isStreaming}
                              actionsEnabled={isCurrentApproval && !isBusy}
                              onApprove={() => {
                                captureAnalyticsEvent("approval acted", {
                                  workspace_id: workspaceId,
                                  app_id: appId,
                                  run_id: runId,
                                  tool_call_id: part.toolCallId,
                                  approval_type: "plan",
                                  action: "approved",
                                });
                                sendMessageSafely(
                                  "Plan approved. Continue with the build.",
                                );
                              }}
                              onRequestChanges={(fb) => {
                                captureAnalyticsEvent("approval acted", {
                                  workspace_id: workspaceId,
                                  app_id: appId,
                                  run_id: runId,
                                  tool_call_id: part.toolCallId,
                                  approval_type: "plan",
                                  action: "requested_changes",
                                  feedback_length: fb.trim().length,
                                });
                                sendMessageSafely(
                                  `Please revise the plan with this feedback:\n\n${fb}`,
                                );
                              }}
                            />
                          );
                        }

                        // Agents config tool → AgentsCard
                        if (part.toolName === "mcp__second__present_agents") {
                          const inputAgents = agentsFromPresentAgentsInput(
                            toolInput,
                          );
                          const outputAgents = agentsFromPresentAgentsOutput(
                            part.output,
                          );
                          const agentsData: AgentsCardData = {
                            agents: inputAgents.length > 0
                              ? inputAgents
                              : outputAgents,
                          };
                          const isCurrentApproval =
                            pendingApproval?.toolCallId === part.toolCallId;
                          return (
                            <AgentsCard
                              key={`tool-${toolPartKey}`}
                              data={agentsData}
                              isStreaming={isStreaming || (agentsData.agents.length === 0 && !isDone)}
                              actionsEnabled={isCurrentApproval && !isBusy}
                              mockApprovalAcknowledged={
                                mockApprovedToolCallIds.has(part.toolCallId) ||
                                (agentsJsonApprovalSource === "build_chat_mock" &&
                                  latestAgentsToolCallId === part.toolCallId)
                              }
                              onApprove={() =>
                                void approveAgentsConfiguration(
                                  agentsData,
                                  part.toolCallId,
                                )
                              }
                              onRequestChanges={(fb) => {
                                captureAnalyticsEvent("approval acted", {
                                  workspace_id: workspaceId,
                                  app_id: appId,
                                  run_id: runId,
                                  tool_call_id: part.toolCallId,
                                  approval_type: "agents",
                                  action: "requested_changes",
                                  feedback_length: fb.trim().length,
                                  agent_count: agentsData.agents.length,
                                });
                                sendMessageSafely(
                                  `Please revise agents.json with this feedback and present the agents again:\n\n${fb}`,
                                );
                              }}
                            />
                          );
                        }

                        if (part.toolName === "mcp__second__present_integration_setup") {
                          return null;
                        }

                        if (part.toolName === "mcp__second__list_app_integration_keys") {
                          return (
                            <AppIntegrationKeysToolCard
                              key={`tool-${toolPartKey}`}
                              input={toolInput}
                              output={part.output}
                              isRunning={isRunning}
                              isDone={isDone}
                            />
                          );
                        }

                        // Bash / shell tools → terminal style
                        if (part.toolName === "Bash") {
                          const command = typeof toolInput?.command === "string"
                            ? toolInput.command
                            : "";
                          const displayTool = command
                            ? bashDisplayTool(command)
                            : null;
                          if (displayTool) {
                            return (
                              <ToolCard
                                key={`tool-${toolPartKey}`}
                                toolName={displayTool.toolName}
                                input={displayTool.input}
                                output={part.output}
                                isRunning={isRunning}
                                isDone={isDone}
                              />
                            );
                          }

                          return (
                            <Terminal
                              key={`tool-${toolPartKey}`}
                              command={command || undefined}
                              output={outputText}
                              isRunning={isRunning}
                            />
                          );
                        }

                        // File tools (Write, Edit, Read, Glob, Grep, WebSearch, WebFetch)
                        if (hasToolCard(part.toolName)) {
                          return (
                            <ToolCard
                              key={`tool-${toolPartKey}`}
                              toolName={part.toolName}
                              input={toolInput}
                              output={part.output}
                              isRunning={isRunning}
                              isDone={isDone}
                            />
                          );
                        }

                        if (part.toolName.startsWith("mcp__app_tools__")) {
                          return (
                            <CustomToolCard
                              key={`tool-${toolPartKey}`}
                              toolName={part.toolName}
                              input={toolInput}
                              output={part.output}
                              isRunning={isRunning}
                              isDone={isDone}
                            />
                          );
                        }

                        if (
                          part.toolName === "mcp__app_data__update_app_data" ||
                          part.toolName === "mcp__app_data__read_app_data"
                        ) {
                          return (
                            <AppDataToolCard
                              key={`tool-${toolPartKey}`}
                              toolName={part.toolName}
                              input={toolInput}
                              output={part.output}
                              isRunning={isRunning}
                              isDone={isDone}
                            />
                          );
                        }

                        // All other tools → compact card
                        const inputSummary = formatToolInput(part.input);
                        return (
                          <div
                            key={`tool-${toolPartKey}`}
                            className="not-prose flex items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2 text-xs font-mono"
                          >
                            {isRunning && (
                              <AppLoader size="xs" />
                            )}
                            <span className="font-semibold">
                              {part.toolName}
                            </span>
                            {inputSummary && (
                              <span className="text-muted-foreground truncate max-w-[300px]">
                                {inputSummary}
                              </span>
                            )}
                            {isDone && (
                              <CheckIcon className="ml-auto size-3 text-emerald-600 dark:text-emerald-400" />
                            )}
                          </div>
                        );
                      }

                      return null;
                    })}
                    {assistantHasContent ? (
                      <div
                        className={cn(
                          "not-prose -ml-0.5 -mt-2 flex h-8 items-center gap-1 transition-opacity duration-300 ease-out",
                          canShowAssistantActions
                            ? "pointer-events-auto opacity-100"
                            : "pointer-events-none opacity-0",
                        )}
                        aria-hidden={!canShowAssistantActions}
                      >
                        <MessageActionButton
                          label="Copy message"
                          icon={CopyIcon}
                          disabled={!canShowAssistantActions}
                          active={copiedMessageId === msg.id}
                          activeIcon={CheckIcon}
                          onClick={() => void copyMessageText(msg.id, assistantText)}
                        />
                        <MessageActionButton
                          label="Try again"
                          icon={RotateCcw}
                          disabled={
                            !canShowAssistantActions ||
                            messageMutationDisabled ||
                            !retryUserTurn
                          }
                          onClick={() => {
                            if (!retryUserTurn) return;
                            rerunUserMessage(retryUserTurn.message.id, {
                              source: "assistant_retry",
                            });
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                </PartErrorBoundary>
              );
            })}

            {isBusy && displayMessages.length > 0 && (() => {
              // Waiting to join a stream started by another tab.
              if (isSyncLoading && status === "ready") {
                return (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AppLoader size="sm" />
                    <span>Connecting to stream...</span>
                  </div>
                );
              }
              const lastMsg = displayMessages[displayMessages.length - 1];
              // Before first assistant response.
              if (lastMsg?.role === "user") {
                return <WorkingIndicator />;
              }
              // During assistant response — only show loader during dead
              // periods where no part provides its own visual feedback.
              const lastPart = lastMsg?.parts?.at(-1);
              const hasOwnFeedback = lastPart && (
                ((lastPart.type === "text" || lastPart.type === "reasoning") &&
                  lastPart.state === "streaming") ||
                (lastPart.type === "dynamic-tool" &&
                  (lastPart.state !== "output-available" || lastPart.preliminary === true))
              );
              if (hasOwnFeedback) return null;
              return <WorkingIndicator />;
            })()}

            {showFailureRow && visibleFailureMessage ? (
              <ChatFailureRow
                message={visibleFailureMessage}
                retryable={failureRetryable}
                retryDisabled={isBusy || !retryText}
                onRetry={retryLastTurn}
                tone={isUserStopped ? "neutral" : "danger"}
              />
            ) : null}
          </StickToBottom.Content>
        </StickToBottom>
      </div>

      {/* Separator to hide scroll under input */}
      <div className="absolute inset-x-0 bottom-0 z-10 h-4 bg-background" />

      {/* Input — absolutely stuck to bottom */}
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-4 ${panelMode ? "px-2" : "px-4"}`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className={`pointer-events-auto w-full ${panelMode ? "max-w-full" : "max-w-[720px]"}`}
        >
          <ToolRecoveryComposerCallout
            status={toolRecoveryStatus}
            toolName={toolRecoveryToolName}
          />
          <IntegrationSetupComposerCallout
            integrations={pendingIntegrationSetup}
            workspaceId={workspaceId}
            appId={appId}
            canManageIntegrations={canManageIntegrations}
            connectableOAuthIntegration={connectableOAuthIntegration}
            liveIntegrationKeys={appIntegrationKeys}
            onBeforeNavigate={releaseLiveObserversForNavigation}
          />
          <div className="relative rounded-2xl">
            <div className="composer-gradient-border-short absolute -inset-[1px] rounded-2xl" />
            <div
              className="relative flex flex-col rounded-2xl bg-[var(--composer-bg)]"
              style={{ boxShadow: "var(--composer-shadow)" }}
            >
              <ComposerAttachmentList
                attachments={attachments}
                onRemove={removeAttachment}
                className="px-[14px] pt-3"
              />
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={pendingApprovalPlaceholder}
                rows={1}
                disabled={isBusy || Boolean(pendingApproval)}
                className="min-h-[72px] w-full resize-none overflow-hidden bg-transparent px-[22px] pt-[14px] pb-1 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-50"
                style={{ fontFamily: "inherit" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
              />
              <div className="flex items-center justify-between px-3.5 pb-3 pt-0.5">
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full text-muted-foreground"
                    aria-label="Attach files"
                    disabled={isBusy || Boolean(pendingApproval) || isUploadingAttachments}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus className="size-4" strokeWidth={1.5} />
                  </Button>
                  <ModelSelector
                    value={runtimeSettings}
                    onChange={setRuntimeSettings}
                  />
                  <RuntimeParameterSelectors
                    value={runtimeSettings}
                    onChange={setRuntimeSettings}
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  className="rounded-full"
                  disabled={
                    isStopping ||
                    (isBusy
                      ? !canStopActiveRun
                      : Boolean(pendingApproval) ||
                        isUploadingAttachments ||
                        (!input.trim() && readyAttachmentCount === 0) ||
                        !chatApi)
                  }
                  onClick={() => {
                    if (isBusy) {
                      void stopBuilderRun();
                    } else {
                      handleSubmit();
                    }
                  }}
                >
                  {isBusy ? (
                    <Pause className="size-4" fill="currentColor" />
                  ) : (
                    <ArrowUp className="size-4" strokeWidth={2.5} />
                  )}
                </Button>
              </div>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              addFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
        </form>
      </div>
    </div>
  );
}
