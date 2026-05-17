"use client";

import {
  Component,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { StickToBottom } from "use-stick-to-bottom";
import {
  ArrowRightIcon,
  Building2Icon,
  CheckIcon,
  FileTextIcon,
  PauseIcon,
  PencilLineIcon,
  RefreshCcwIcon,
  SearchIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { AppLoader } from "@/components/app-loader";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { LinkChip } from "@/components/ai-elements/link-chip";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { ToolCard } from "@/components/ai-elements/tool-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DEFAULT_RUNTIME_SETTINGS,
  normalizeRuntimeSettings,
  readPreferredRuntimeSettings,
} from "@/lib/agent/runtime-registry";
import { reportClientError } from "@/lib/client-error-reporting";
import { cn } from "@/lib/utils";

type StarterOnboardingProps = {
  workspaceId: string;
  workspaceName: string;
  displayName: string;
  email: string;
  profileRole?: string | null;
  initialCompanyContext?: string | null;
  initialUserContext?: string | null;
};

type ContextDraft = {
  companyContext: string;
  userContext: string;
};

const ONBOARDING_CLAUDE_MODEL = "claude-opus-4-6";
const ONBOARDING_CLAUDE_PARAMS = {
  effort: "high",
  thinking: "adaptive",
};
const THATS_ENOUGH_DELAY_MS = 20 * 60 * 1000;
const THATS_ENOUGH_MESSAGE =
  "OK. That's enough. Stop researching and show your findings so far.";

const REMARK_PLUGINS = [remarkGfm];
const MD_COMPONENTS = {
  code: CodeBlock,
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  a: LinkChip,
};

function normalizeMarkdownSectionSpacing(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  const spacedLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    const isBoldSectionLabel = /^\*\*[^*\n]{1,80}\*\*:?\s*$/.test(trimmedLine);

    if (isBoldSectionLabel) {
      if (
        spacedLines.length > 0 &&
        spacedLines[spacedLines.length - 1]?.trim()
      ) {
        spacedLines.push("");
      }
      spacedLines.push(trimmedLine);
      spacedLines.push("");
      continue;
    }

    spacedLines.push(line);
  }

  return spacedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const MemoMarkdown = memo(function MemoMarkdown({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
      {normalizeMarkdownSectionSpacing(text)}
    </Markdown>
  );
});

class PartErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[OnboardingContextPart]", error.message, info.componentStack);
    void reportClientError({
      source: "component-error-boundary",
      error,
      componentStack: info.componentStack,
      context: { component: "StarterOnboarding.PartErrorBoundary" },
    });
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseToolTextOutput(output: unknown): unknown {
  const contentText = textFromToolContent(output);
  if (contentText) return parseToolTextOutput(contentText);

  if (typeof output !== "string") return output;
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

function textFromToolContent(value: unknown): string | null {
  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        const record = asRecord(item);
        return typeof record?.text === "string" ? record.text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    return text || null;
  }

  const record = asRecord(value);
  if (Array.isArray(record?.content)) {
    return textFromToolContent(record.content);
  }

  return null;
}

function contextFromValue(value: unknown): ContextDraft | null {
  const record = asRecord(parseToolTextOutput(value));
  if (!record) return null;

  const companyContext =
    typeof record.companyContext === "string" ? record.companyContext.trim() : "";
  const userContext =
    typeof record.userContext === "string" ? record.userContext.trim() : "";
  if (!companyContext && !userContext) return null;

  return { companyContext, userContext };
}

function MissingContextCard({
  onSkip,
  onRetry,
  retryDisabled,
}: {
  onSkip: () => Promise<void>;
  onRetry: () => void;
  retryDisabled: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skipAndContinue = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSkip();
    } catch {
      setError("Could not continue without context. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <Card className="onboarding-bento-surface rounded-[14px]">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md border bg-background">
            <FileTextIcon className="size-4 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-sm font-medium">No context was saved</p>
            <p className="text-xs text-muted-foreground">
              The agent finished without a usable company/user context draft.
              Retry the research or continue without saved context.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onRetry}
              disabled={submitting || retryDisabled}
            >
              <RefreshCcwIcon data-icon="inline-start" />
              Retry
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void skipAndContinue()}
              disabled={submitting}
            >
              {submitting ? "Continuing..." : "Continue without context"}
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function latestContextDraft(messages: UIMessage[]): ContextDraft | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    const parts = message.parts ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = asRecord(parts[partIndex]);
      if (
        part?.type !== "dynamic-tool" ||
        part.toolName !== "mcp__second__set_onboarding_context"
      ) {
        continue;
      }

      return contextFromValue(part.output) ?? contextFromValue(part.input);
    }
  }

  return null;
}

function contextDraftLengths(value: unknown) {
  const draft = contextFromValue(value);
  return {
    parsed: Boolean(draft),
    companyContextChars: draft?.companyContext.length ?? 0,
    userContextChars: draft?.userContext.length ?? 0,
  };
}

function missingContextDiagnostics(input: {
  messages: UIMessage[];
  status: string;
  hasInitialDraft: boolean;
  errorMessage?: string;
}) {
  const toolCalls: Array<{
    messageId: string;
    toolName: string;
    state: string | null;
    hasInput: boolean;
    hasOutput: boolean;
    input: ReturnType<typeof contextDraftLengths>;
    output: ReturnType<typeof contextDraftLengths>;
  }> = [];

  for (const message of input.messages) {
    for (const part of message.parts ?? []) {
      const record = asRecord(part);
      if (record?.type !== "dynamic-tool") continue;

      toolCalls.push({
        messageId: message.id,
        toolName:
          typeof record.toolName === "string" ? record.toolName : "unknown",
        state: typeof record.state === "string" ? record.state : null,
        hasInput: "input" in record,
        hasOutput: "output" in record,
        input: contextDraftLengths(record.input),
        output: contextDraftLengths(record.output),
      });
    }
  }

  const contextToolCalls = toolCalls.filter(
    (tool) => tool.toolName === "mcp__second__set_onboarding_context",
  );
  const reason =
    contextToolCalls.length === 0
      ? "context_tool_not_in_ui_messages"
      : contextToolCalls.some((tool) => tool.input.parsed || tool.output.parsed)
        ? "context_tool_parsed_but_latest_draft_missing"
        : "context_tool_present_but_empty_or_unparseable";

  return {
    reason,
    status: input.status,
    messageCount: input.messages.length,
    hasInitialDraft: input.hasInitialDraft,
    errorMessage: input.errorMessage,
    toolNames: [...new Set(toolCalls.map((tool) => tool.toolName))],
    toolCallCount: toolCalls.length,
    contextToolCalls,
  };
}

function navigateWithShell(href: string) {
  document.dispatchEvent(
    new CustomEvent("second:onboarding-navigate", {
      detail: { href },
    }),
  );
}

function MarkdownSurface({
  text,
  isPending = false,
}: {
  text: string;
  isPending?: boolean;
}) {
  const trimmed = text.trim();

  if (!trimmed) {
    return (
      <p
        className={cn(
          "text-xs leading-5 text-muted-foreground",
          isPending && "font-medium working-text-shimmer",
        )}
      >
        {isPending ? "Researching..." : "No context yet."}
      </p>
    );
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-foreground prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-strong:font-medium prose-strong:text-foreground prose-a:text-foreground prose-a:no-underline hover:prose-a:text-foreground prose-code:before:content-none prose-code:after:content-none">
      <MemoMarkdown text={trimmed} />
    </div>
  );
}

function ContextSection({
  title,
  icon: Icon,
  value,
  isPending,
  onChange,
}: {
  title: string;
  icon: typeof Building2Icon;
  value: string;
  isPending?: boolean;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [original, setOriginal] = useState(value);

  const closeEdit = () => {
    onChange(draft);
    setEditing(false);
  };

  return (
    <section className="onboarding-bento-surface flex min-w-0 flex-col gap-2 rounded-[14px] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
          <h4 className="truncate text-xs font-medium">{title}</h4>
        </div>
        {editing ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setDraft(original);
                onChange(original);
                setEditing(false);
              }}
              aria-label={`Cancel editing ${title}`}
            >
              <XIcon />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closeEdit}
            >
              <CheckIcon data-icon="inline-start" />
              Done
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(value);
              setOriginal(value);
              setEditing(true);
            }}
          >
            <PencilLineIcon data-icon="inline-start" />
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            onChange(event.target.value);
          }}
          rows={9}
          maxLength={3000}
          className="min-h-52 resize-none rounded-md border bg-background px-3 py-2 text-xs leading-5 outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-foreground/25"
        />
      ) : (
        <div className="onboarding-bento-inset rounded-lg px-3 py-2">
          <MarkdownSurface text={value} isPending={isPending} />
        </div>
      )}
    </section>
  );
}

function ContextReviewCard({
  draft,
  isRunning,
  onContinue,
  onSkip,
  onRetry,
  retryDisabled,
}: {
  draft: ContextDraft;
  isRunning: boolean;
  onContinue: (draft: ContextDraft) => Promise<void>;
  onSkip: () => Promise<void>;
  onRetry: () => void;
  retryDisabled: boolean;
}) {
  const [companyContextEdit, setCompanyContextEdit] = useState<string | null>(
    null,
  );
  const [userContextEdit, setUserContextEdit] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"save" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const companyContext = companyContextEdit ?? draft.companyContext;
  const userContext = userContextEdit ?? draft.userContext;

  const saveAndContinue = async () => {
    if (submitting || isRunning) return;
    setSubmitting("save");
    setError(null);
    try {
      await onContinue({ companyContext, userContext });
    } catch {
      setError("Could not save this context. Edit it and try again.");
      setSubmitting(null);
    }
  };

  const skipAndContinue = async () => {
    if (submitting || isRunning) return;
    setSubmitting("skip");
    setError(null);
    try {
      await onSkip();
    } catch {
      setError("Could not clear this context. Try again.");
      setSubmitting(null);
    }
  };

  return (
    <Card className="onboarding-bento-surface overflow-hidden rounded-[14px]">
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
              <FileTextIcon className="size-4 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm">Workspace context</CardTitle>
              <CardDescription className="text-xs">
                Review what future agents will receive in their system prompt.
              </CardDescription>
            </div>
          </div>
          <Badge variant={isRunning ? "secondary" : "outline"}>
            {isRunning ? "Saving" : "Ready"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <ContextSection
            title="Company context"
            icon={Building2Icon}
            value={companyContext}
            isPending={isRunning}
            onChange={setCompanyContextEdit}
          />

          <ContextSection
            title="User context"
            icon={UserRoundIcon}
            value={userContext}
            isPending={isRunning}
            onChange={setUserContextEdit}
          />
        </div>

        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-3 border-t bg-[var(--onboarding-bento-inset-bg)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={Boolean(submitting) || isRunning}
            onClick={() => void skipAndContinue()}
          >
            {submitting === "skip" ? "Clearing..." : "Skip context"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={Boolean(submitting) || isRunning || retryDisabled}
            onClick={onRetry}
          >
            <RefreshCcwIcon data-icon="inline-start" />
            Retry
          </Button>
        </div>
        <Button
          type="button"
          disabled={Boolean(submitting) || isRunning}
          onClick={() => void saveAndContinue()}
        >
          {submitting === "save" ? "Saving..." : "Looks good"}
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </CardFooter>
    </Card>
  );
}

function PendingContextCard() {
  return (
    <Card className="onboarding-bento-surface rounded-[14px]">
      <CardContent className="flex items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md border bg-background">
            <SearchIcon className="size-4 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-sm font-medium">Researching context</p>
            <p className="text-xs text-muted-foreground">
              The agent will save a company and user draft when it has enough.
            </p>
          </div>
        </div>
        <AppLoader size="sm" />
      </CardContent>
    </Card>
  );
}

function OnboardingWorkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <AppLoader size="sm" />
      <span className="working-text-shimmer">Working</span>
    </div>
  );
}

export function StarterOnboarding({
  workspaceId,
  workspaceName,
  displayName,
  email,
  initialCompanyContext,
  initialUserContext,
}: StarterOnboardingProps) {
  const [runtimeSettings] = useState(() => {
    try {
      const preferred = readPreferredRuntimeSettings();
      if (preferred.runtimeId !== "claude-code") return preferred;
      return normalizeRuntimeSettings({
        ...preferred,
        model: ONBOARDING_CLAUDE_MODEL,
        params: {
          ...preferred.params,
          ...ONBOARDING_CLAUDE_PARAMS,
        },
      });
    } catch {
      return normalizeRuntimeSettings({
        ...DEFAULT_RUNTIME_SETTINGS,
        model: ONBOARDING_CLAUDE_MODEL,
        params: {
          ...DEFAULT_RUNTIME_SETTINGS.params,
          ...ONBOARDING_CLAUDE_PARAMS,
        },
      });
    }
  });
  const startedRef = useRef(false);
  const missingContextLogKeyRef = useRef<string | null>(null);
  const initialDraft = useMemo<ContextDraft | null>(() => {
    const companyContext = initialCompanyContext?.trim() ?? "";
    const userContext = initialUserContext?.trim() ?? "";
    return companyContext || userContext ? { companyContext, userContext } : null;
  }, [initialCompanyContext, initialUserContext]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/onboarding/context/stream",
        prepareSendMessagesRequest: ({
          id,
          messages,
          trigger,
          messageId,
          body,
        }) => {
          return {
            body: {
              ...body,
              id,
              messages,
              trigger,
              messageId,
              runtimeId: runtimeSettings.runtimeId,
              runtimeModel: runtimeSettings.model,
              runtimeParams: runtimeSettings.params,
            },
          };
        },
      }),
    [runtimeSettings],
  );

  const {
    messages,
    sendMessage,
    stop,
    status,
    error,
  } = useChat({
    transport,
    messages: [],
    experimental_throttle: 50,
  });
  const deferredMessages = useDeferredValue(messages);
  const isBusy = status === "submitted" || status === "streaming";
  const latestDraft = latestContextDraft(deferredMessages) ?? initialDraft;
  const [showEnoughButton, setShowEnoughButton] = useState(false);
  const [enoughRequested, setEnoughRequested] = useState(false);
  const enoughButtonEligible = isBusy && !latestDraft && !enoughRequested;

  useEffect(() => {
    if (latestDraft || isBusy || deferredMessages.length === 0) return;

    const diagnostics = missingContextDiagnostics({
      messages: deferredMessages,
      status,
      hasInitialDraft: Boolean(initialDraft),
      errorMessage:
        error instanceof Error ? error.message : error ? String(error) : undefined,
    });
    const logKey = JSON.stringify({
      reason: diagnostics.reason,
      status: diagnostics.status,
      messageCount: diagnostics.messageCount,
      toolCallCount: diagnostics.toolCallCount,
      contextToolCallCount: diagnostics.contextToolCalls.length,
    });
    if (missingContextLogKeyRef.current === logKey) return;
    missingContextLogKeyRef.current = logKey;

    console.warn(
      "[onboarding-context-ui] rendering missing context card",
      diagnostics,
    );
  }, [deferredMessages, error, initialDraft, isBusy, latestDraft, status]);

  useEffect(() => {
    if (!enoughButtonEligible) return;

    const timeout = window.setTimeout(
      () => setShowEnoughButton(true),
      THATS_ENOUGH_DELAY_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [enoughButtonEligible]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void sendMessage({
      text: `Research concise onboarding context for ${displayName} (${email}) at ${workspaceName}. Use the email and email domain to disambiguate the company and user.`,
    });
  }, [displayName, email, sendMessage, workspaceName]);

  const saveContext = useCallback(
    async (draft: ContextDraft) => {
      const response = await fetch("/api/onboarding/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error("context_save_failed");

      const complete = await fetch("/api/onboarding/complete", { method: "POST" });
      if (!complete.ok) throw new Error("onboarding_complete_failed");

      navigateWithShell(`/w/${workspaceId}`);
    },
    [workspaceId],
  );

  const skipContext = useCallback(async () => {
    await saveContext({ companyContext: "", userContext: "" });
  }, [saveContext]);

  const retryResearch = useCallback(() => {
    if (isBusy) return;
    setEnoughRequested(false);
    setShowEnoughButton(false);
    void sendMessage({
      text: `Try again. Research concise onboarding context for ${displayName} (${email}) at ${workspaceName}. Use the email and email domain to disambiguate the company and user.`,
    });
  }, [displayName, email, isBusy, sendMessage, workspaceName]);

  const requestEnough = useCallback(() => {
    if (!isBusy || enoughRequested) return;
    setEnoughRequested(true);
    setShowEnoughButton(false);
    void stop();
    window.setTimeout(() => {
      void sendMessage({ text: THATS_ENOUGH_MESSAGE });
    }, 0);
  }, [enoughRequested, isBusy, sendMessage, stop]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
          <SearchIcon className="size-4 text-foreground" strokeWidth={1.75} />
          <span className={cn("text-sm font-medium", isBusy && "working-text-shimmer")}>
            Researching (~30s)
          </span>
          {enoughButtonEligible && showEnoughButton ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-2.5 text-xs animate-in fade-in-0 duration-300"
              disabled={!isBusy || enoughRequested}
              onClick={requestEnough}
            >
              <PauseIcon data-icon="inline-start" />
              That&apos;s enough
            </Button>
          ) : null}
        </div>

        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0 flex flex-col">
            <StickToBottom
              className="relative flex-1 overflow-y-hidden"
              resize="smooth"
            >
              <StickToBottom.Content className="flex min-h-full flex-col gap-5 px-1 py-2">
            {deferredMessages.map((message) => (
              <PartErrorBoundary key={message.id}>
                <div
                  className={cn(
                    "flex flex-col gap-3",
                    message.role === "user" ? "items-end" : "items-start",
                  )}
                >
                  <div
                    className={cn(
                      "text-sm",
                      message.role === "user"
                        ? "onboarding-bento-surface max-w-[80%] rounded-2xl px-4 py-2.5 text-foreground"
                        : "w-full text-foreground",
                    )}
                  >
                    <div className="flex flex-col gap-3">
                      {(message.parts ?? []).map((part, index) => {
                        if (!part || typeof part !== "object") return null;

                        if (part.type === "text" && part.text.trim()) {
                          return (
                            <div
                              key={index}
                              className="prose prose-sm dark:prose-invert max-w-none leading-relaxed text-foreground prose-strong:font-medium prose-strong:text-foreground prose-a:text-foreground prose-a:no-underline hover:prose-a:text-foreground prose-code:before:content-none prose-code:after:content-none"
                            >
                              <MemoMarkdown text={part.text} />
                            </div>
                          );
                        }

                        if (part.type === "reasoning" && part.text.trim()) {
                          return (
                            <Reasoning
                              key={index}
                              done={part.state === "done" || !isBusy}
                              storageKey={`${message.id}:onboarding-reasoning:${index}`}
                            >
                              <ReasoningTrigger />
                              <ReasoningContent>{part.text}</ReasoningContent>
                            </Reasoning>
                          );
                        }

                        if (part.type === "dynamic-tool") {
                          const state = part.state ?? "input-streaming";
                          const isPreliminary =
                            state === "output-available" &&
                            asRecord(part)?.preliminary === true;
                          const isRunning =
                            state === "input-available" ||
                            state === "input-streaming" ||
                            isPreliminary;
                          const isDone = state === "output-available" && !isPreliminary;
                          const toolInput = part.input as
                            | Record<string, unknown>
                            | undefined;

                          if (part.toolName === "mcp__second__set_onboarding_context") {
                            const draft =
                              contextFromValue(part.output) ??
                              contextFromValue(part.input);
                            return draft ? (
                              <div key={part.toolCallId} className="not-prose w-full">
                                <ContextReviewCard
                                  draft={draft}
                                  isRunning={isRunning}
                                  onContinue={saveContext}
                                  onSkip={skipContext}
                                  onRetry={retryResearch}
                                  retryDisabled={isBusy}
                                />
                              </div>
                            ) : (
                              <div key={part.toolCallId} className="not-prose w-full">
                                <PendingContextCard />
                              </div>
                            );
                          }

                          return (
                            <ToolCard
                              key={part.toolCallId}
                              toolName={part.toolName}
                              input={toolInput}
                              output={part.output}
                              isRunning={isRunning}
                              isDone={isDone}
                            />
                          );
                        }

                        return null;
                      })}
                    </div>
                  </div>
                </div>
              </PartErrorBoundary>
            ))}

            {deferredMessages.length === 0 ? (
              <PendingContextCard />
            ) : null}

            {isBusy && deferredMessages.length > 0
              ? (() => {
                  const lastMessage =
                    deferredMessages[deferredMessages.length - 1];
                  if (lastMessage?.role === "user") {
                    return <OnboardingWorkingIndicator />;
                  }

                  const lastPart = lastMessage?.parts?.at(-1);
                  const lastPartRecord = asRecord(lastPart);
                  const lastPartType =
                    typeof lastPartRecord?.type === "string"
                      ? lastPartRecord.type
                      : null;
                  const lastPartState =
                    typeof lastPartRecord?.state === "string"
                      ? lastPartRecord.state
                      : null;
                  const hasOwnFeedback =
                    ((lastPartType === "text" ||
                      lastPartType === "reasoning") &&
                      lastPartState === "streaming") ||
                    (lastPartType === "dynamic-tool" &&
                      (lastPartState !== "output-available" ||
                        lastPartRecord?.preliminary === true));

                  if (hasOwnFeedback) return null;
                  return <OnboardingWorkingIndicator />;
                })()
              : null}

            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Could not stream onboarding context. You can continue without it.
              </div>
            ) : null}
              </StickToBottom.Content>
            </StickToBottom>
          </div>
        </div>
      </div>

      {!latestDraft && !isBusy ? (
        <div className="shrink-0">
          <MissingContextCard
            onSkip={skipContext}
            onRetry={retryResearch}
            retryDisabled={isBusy}
          />
        </div>
      ) : null}
    </div>
  );
}
