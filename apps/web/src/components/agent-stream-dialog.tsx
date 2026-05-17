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
  type ReactNode,
  type ErrorInfo,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { StickToBottom } from "use-stick-to-bottom";
import {
  AlertTriangleIcon,
  BotIcon,
  CheckIcon,
  XIcon,
} from "lucide-react";
import { AppLoader } from "@/components/app-loader";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { LinkChip } from "@/components/ai-elements/link-chip";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import { Terminal } from "@/components/ai-elements/terminal";
import { ToolCard, hasToolCard } from "@/components/ai-elements/tool-card";
import {
  AppDataToolCard,
  CustomToolCard,
  type CustomToolMeta,
} from "@/components/ai-elements/custom-tool-card";
import { reportClientError } from "@/lib/client-error-reporting";

// ---------------------------------------------------------------------------
// Shared rendering helpers (same as app-chat.tsx)
// ---------------------------------------------------------------------------

const REMARK_PLUGINS = [remarkGfm];
const MD_COMPONENTS = {
  code: CodeBlock,
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  a: LinkChip,
};

const MemoMarkdown = memo(function MemoMarkdown({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
      {text}
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
    console.warn("[PartErrorBoundary]", error.message, info.componentStack);
    void reportClientError({
      source: "component-error-boundary",
      error,
      componentStack: info.componentStack,
      context: { component: "AgentStreamDialog.PartErrorBoundary" },
    });
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function formatToolInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  if (typeof obj.command === "string") return obj.command;
  if (typeof obj.file_path === "string") return obj.file_path;
  if (typeof obj.pattern === "string") return obj.pattern;
  if (typeof obj.url === "string") return obj.url;
  if (typeof obj.query === "string") return obj.query;
  for (const val of Object.values(obj)) {
    if (typeof val === "string" && val.length < 200) return val;
  }
  return null;
}

function hasAssistantResponse(messages: UIMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      Array.isArray(message.parts) &&
      message.parts.length > 0,
  );
}

type AgentCustomToolSpec = {
  type: string;
  name: string;
  displayName?: string;
  description?: string;
  integration?: {
    name: string;
    domain: string;
    auth?: {
      type?: string;
      providerKey?: string;
      scopes?: string[];
    } | null;
  } | null;
  endpoint?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    queryParams?: Record<string, string>;
    body?: unknown;
  } | null;
};

function collectTemplateNames(value: unknown, names: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) {
      if (match[1]) names.add(match[1]);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectTemplateNames(item, names);
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectTemplateNames(item, names);
  }
}

function isSecretPlaceholderName(name: string): boolean {
  return name.startsWith("secrets.") && name.length > "secrets.".length;
}

function isSecretLikePlaceholderName(name: string): boolean {
  if (isSecretPlaceholderName(name)) return false;
  return /(^|[_.-])(api[_-]?key|key|secret|token|password|bearer|auth)([_.-]|$)/i.test(
    name,
  );
}

function endpointDeclaresAuthorizationHeader(
  endpoint: AgentCustomToolSpec["endpoint"],
): boolean {
  return Object.keys(endpoint?.headers ?? {}).some(
    (name) => name.toLowerCase() === "authorization",
  );
}

function isPublicUnauthenticatedTool(tool: AgentCustomToolSpec): boolean {
  if (tool.type !== "custom") return false;
  if (!tool.endpoint) return false;
  if (tool.integration?.auth && tool.integration.auth.type !== "none") return false;
  if (endpointDeclaresAuthorizationHeader(tool.endpoint)) return false;

  const templateNames = new Set<string>();
  collectTemplateNames(tool.endpoint, templateNames);
  return (
    ![...templateNames].some(isSecretPlaceholderName) &&
    ![...templateNames].some(isSecretLikePlaceholderName)
  );
}

function AgentWorkingIndicator({ starting = false }: { starting?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <AppLoader size="sm" />
      <span className="working-text-shimmer">
        {starting ? "Starting agent" : "Working"}
      </span>
    </div>
  );
}

class AbortableTransportFetch {
  private controllers = new Set<AbortController>();

  fetch: typeof globalThis.fetch = (input, init) => {
    const controller = new AbortController();
    this.controllers.add(controller);

    const upstreamSignal = init?.signal;
    let removeUpstreamAbortListener: (() => void) | undefined;
    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        controller.abort(upstreamSignal.reason);
      } else {
        const abortFromUpstream = () => controller.abort(upstreamSignal.reason);
        upstreamSignal.addEventListener("abort", abortFromUpstream, {
          once: true,
        });
        removeUpstreamAbortListener = () => {
          upstreamSignal.removeEventListener("abort", abortFromUpstream);
        };
      }
    }

    return globalThis
      .fetch(input, { ...init, signal: controller.signal })
      .then((response) => {
        removeUpstreamAbortListener?.();
        // Keep the controller registered after the headers arrive. Reconnect
        // streams can stay open for minutes, and aborting after close must
        // cancel the response body, not only the initial fetch handshake.
        if (!response.body) {
          this.controllers.delete(controller);
        }
        return response;
      })
      .catch((error) => {
        removeUpstreamAbortListener?.();
        this.controllers.delete(controller);
        throw error;
      });
  };

  abortAll() {
    for (const controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentStreamDialogProps = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  appId: string;
  runId: string;
  agentName: string;
  prompt: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentStreamDialog({
  open,
  onClose,
  workspaceId,
  appId,
  runId,
  agentName,
  prompt,
}: AgentStreamDialogProps) {
  // Fetch initial run data
  const [initialData, setInitialData] = useState<{
    runId: string;
    messages: UIMessage[];
    status: string;
    agentId: string;
  } | null>(null);
  const [fetchError, setFetchError] = useState<{
    runId: string;
    message: string;
  } | null>(null);
  const fetchedRef = useRef<string | null>(null);

  // Unconfigured integrations for this agent
  const [unconfiguredIntegrations, setUnconfiguredIntegrations] =
    useState<{ runId: string; names: string[] } | null>(null);
  const [customToolCatalog, setCustomToolCatalog] =
    useState<{ runId: string; catalog: Record<string, CustomToolMeta> } | null>(
      null,
    );
  const currentInitialData =
    initialData?.runId === runId ? initialData : null;
  const currentFetchError =
    fetchError?.runId === runId ? fetchError.message : null;
  const currentUnconfiguredIntegrations =
    unconfiguredIntegrations?.runId === runId
      ? unconfiguredIntegrations.names
      : [];
  const currentCustomToolCatalog =
    customToolCatalog?.runId === runId ? customToolCatalog.catalog : {};

  useEffect(() => {
    if (!open || !runId) return;
    if (fetchedRef.current === runId) return;
    fetchedRef.current = runId;
    let cancelled = false;
    const controller = new AbortController();

    fetch(`/api/workspaces/${workspaceId}/apps/${appId}/agent-runs/${runId}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then(
        (data: {
          messages: UIMessage[];
          status: string;
          agentId: string;
        }) => {
          if (cancelled) return;
          setInitialData({
            runId,
            messages: data.messages ?? [],
            status: data.status,
            agentId: data.agentId,
          });
          // Check integration status for this agent's custom tools
          checkIntegrationStatus(data.agentId);
        },
      )
      .catch((err) => {
        if (cancelled) return;
        if (controller.signal.aborted) return;
        setFetchError({ runId, message: String(err) });
      });

    async function checkIntegrationStatus(agentId: string) {
      try {
        const [agentsRes, integrationsRes] = await Promise.all([
          fetch(`/api/workspaces/${workspaceId}/apps/${appId}/agents`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(`/api/workspaces/${workspaceId}/integrations`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        if (cancelled) return;
        if (!agentsRes.ok || !integrationsRes.ok) return;

        const agentsData = (await agentsRes.json()) as {
          agents: Array<{
            id: string;
            tools?: AgentCustomToolSpec[];
          }>;
        };
        const integrationsData = (await integrationsRes.json()) as {
          integrations: Array<{
            domain: string;
            configured: boolean;
          }>;
        };

        const agent = agentsData.agents?.find((a) => a.id === agentId);
        if (!agent) return;

        const catalog: Record<string, CustomToolMeta> = {};
        for (const tool of agent.tools ?? []) {
          if (tool.type !== "custom") continue;
          catalog[`mcp__app_tools__${tool.name}`] = {
            name: tool.name,
            displayName: tool.displayName,
            description: tool.description,
            integration: tool.integration,
            endpoint: tool.endpoint,
          };
        }
        setCustomToolCatalog({ runId, catalog });

        const configuredDomains = new Set(
          integrationsData.integrations
            .filter((i) => i.configured)
            .map((i) => i.domain),
        );

        const missing: string[] = [];
        for (const tool of agent.tools ?? []) {
          if (isPublicUnauthenticatedTool(tool)) continue;
          if (
            tool.type === "custom" &&
            tool.integration?.domain &&
            !configuredDomains.has(tool.integration.domain)
          ) {
            missing.push(tool.integration.name);
          }
        }
        setUnconfiguredIntegrations({ runId, names: [...new Set(missing)] });
      } catch {
        // best effort
      }
    }

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, runId, workspaceId, appId]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      fetchedRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 animate-in fade-in-0"
        onClick={onClose}
      />

      {/* Panel — slides in from right */}
      <div className="ml-auto relative w-full max-w-[680px] flex flex-col bg-background border-l border-border animate-in slide-in-from-right-full duration-200">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border shrink-0">
          <BotIcon className="size-4 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{agentName}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {prompt}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground shrink-0"
            onClick={onClose}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>

        {/* Mock data callout */}
        {currentUnconfiguredIntegrations.length > 0 && (
          <div className="flex items-start gap-2.5 px-4 py-2.5 border-b border-border bg-amber-500/5 shrink-0">
            <AlertTriangleIcon className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-400">
              <span className="font-medium">Using mock data</span>
              <span className="text-amber-600/80 dark:text-amber-400/70">
                {" "}&mdash; {currentUnconfiguredIntegrations.join(", ")}{" "}
                {currentUnconfiguredIntegrations.length === 1 ? "is" : "are"} not
                configured. Results are simulated.{" "}
                <a
                  href={`/w/${workspaceId}/settings/integrations`}
                  className="underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-300"
                >
                  Set up integrations
                </a>
              </span>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {currentFetchError ? (
            <div className="flex items-center justify-center h-full p-4">
              <p className="text-sm text-destructive">{currentFetchError}</p>
            </div>
          ) : !currentInitialData ? (
            <div className="flex items-center justify-center h-full">
              <AppLoader size="sm" />
            </div>
          ) : (
            <AgentStreamContent
              key={runId}
              workspaceId={workspaceId}
              appId={appId}
              runId={runId}
              prompt={prompt}
              initialMessages={currentInitialData.messages}
              initialStatus={currentInitialData.status}
              customToolCatalog={currentCustomToolCatalog}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stream content — uses useChat for real-time streaming
// ---------------------------------------------------------------------------

function AgentStreamContent({
  workspaceId,
  appId,
  runId,
  prompt,
  initialMessages,
  initialStatus,
  customToolCatalog,
}: {
  workspaceId: string;
  appId: string;
  runId: string;
  prompt: string;
  initialMessages: UIMessage[];
  initialStatus: string;
  customToolCatalog: Record<string, CustomToolMeta>;
}) {
  const streamUrl = `/api/workspaces/${workspaceId}/apps/${appId}/agent-runs/${runId}/stream`;
  const runUrl = `/api/workspaces/${workspaceId}/apps/${appId}/agent-runs/${runId}`;
  const needsStart = initialStatus === "pending";
  const needsFinalReplay =
    initialStatus === "completed" && !hasAssistantResponse(initialMessages);
  const abortableTransportFetch = useMemo(
    () => new AbortableTransportFetch(),
    [],
  );

  // Transport: POST to /stream starts the agent (returns SSE), GET /stream resumes
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: streamUrl,
        fetch: abortableTransportFetch.fetch,
        prepareReconnectToStreamRequest: ({ api }) => ({ api }),
      }),
    [streamUrl, abortableTransportFetch],
  );

  const { messages, status, setMessages, sendMessage, resumeStream, stop } = useChat({
    id: runId,
    messages: initialMessages,
    experimental_throttle: 50,
    transport,
  });
  const hasAssistantMessages = hasAssistantResponse(messages);

  const deferredMessages = useDeferredValue(messages);
  const statusRef = useRef<string>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    return () => {
      stop();
      abortableTransportFetch.abortAll();
    };
  }, [abortableTransportFetch, stop]);
  const resumeActiveRef = useRef(false);
  const attachLiveStream = useCallback(() => {
    const currentStatus = statusRef.current;
    if (currentStatus === "streaming" || currentStatus === "submitted") return;
    if (resumeActiveRef.current) return;

    resumeActiveRef.current = true;
    resumeStream()
      .catch(() => {})
      .finally(() => {
        resumeActiveRef.current = false;
      });
  }, [resumeStream]);

  // Start the agent by sending a message via useChat (triggers POST to /stream)
  // OR resume if it's already streaming.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (needsStart) {
      // Send the prompt — useChat will POST to /stream, which starts
      // the agent and returns SSE events directly.
      sendMessage({ text: prompt });
    } else if (
      initialStatus === "streaming" ||
      initialStatus === "running" ||
      needsFinalReplay
    ) {
      // Already streaming — try to resume the SSE connection
      attachLiveStream();
    }
    // completed/failed with persisted messages: nothing to do.
  }, [needsStart, needsFinalReplay, initialStatus, prompt, sendMessage, attachLiveStream]);

  // Track the DB run status so we know when it completes (for the badge)
  const [runStatus, setRunStatus] = useState(initialStatus);

  // Poll DB for status changes (and final messages when done)
  useEffect(() => {
    let activeController: AbortController | null = null;

    async function fetchRun() {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      try {
        const res = await fetch(runUrl, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok || controller.signal.aborted) return;
        const data = (await res.json()) as {
          messages: UIMessage[];
          status: string;
        };
        setRunStatus(data.status);
        // When run finishes, load final messages from DB
        if (
          (data.status === "completed" || data.status === "failed") &&
          data.messages?.length &&
          statusRef.current !== "streaming" &&
          statusRef.current !== "submitted"
        ) {
          setMessages(data.messages);
        }
      } catch {
        // best effort
      } finally {
        if (activeController === controller) {
          activeController = null;
        }
      }
    }

    const waitingForFinalMessages =
      runStatus === "completed" && !hasAssistantMessages;
    if (
      (runStatus === "completed" || runStatus === "failed") &&
      !waitingForFinalMessages
    ) {
      return;
    }

    const interval = setInterval(fetchRun, 2000);

    return () => {
      clearInterval(interval);
      activeController?.abort();
    };
  }, [hasAssistantMessages, runStatus, runUrl, setMessages]);

  // When useChat finishes streaming, fetch final messages from DB
  const prevStatus = useRef(status);
  useEffect(() => {
    if (
      status === "ready" &&
      (prevStatus.current === "streaming" || prevStatus.current === "submitted")
    ) {
      const controller = new AbortController();
      fetch(runUrl, { cache: "no-store", signal: controller.signal })
        .then((r) => r.json())
        .then((data: { messages: UIMessage[]; status: string }) => {
          if (controller.signal.aborted) return;
          if (data.messages?.length) setMessages(data.messages);
          setRunStatus(data.status);
        })
        .catch(() => {});
      prevStatus.current = status;
      return () => controller.abort();
    }
    prevStatus.current = status;
  }, [status, runUrl, setMessages]);

  useEffect(() => {
    const shouldAttach =
      runStatus === "streaming" || runStatus === "running" || needsFinalReplay;
    if (!shouldAttach || hasAssistantMessages) return;

    const interval = setInterval(() => {
      attachLiveStream();
    }, 2000);

    return () => clearInterval(interval);
  }, [runStatus, needsFinalReplay, hasAssistantMessages, attachLiveStream]);

  const isBusy =
    status === "streaming" ||
    status === "submitted" ||
    (needsFinalReplay && !hasAssistantMessages) ||
    (runStatus !== "completed" && runStatus !== "failed" && status === "ready");
  return (
    <div className="relative h-full">
      <div className="absolute inset-0 flex flex-col">
        <StickToBottom
          className="relative flex-1 overflow-y-hidden"
          resize="smooth"
        >
          <StickToBottom.Content className="mx-auto space-y-6 p-4 pb-12 max-w-full">
            {/* Prompt bubble */}
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl bg-[#F4F4F4] dark:bg-[#2A2B2F] text-foreground px-4 py-2.5 text-sm whitespace-pre-wrap">
                {(() => {
                  const userMsg = deferredMessages.find((m) => m.role === "user");
                  if (userMsg) {
                    const textParts = userMsg.parts.filter(
                      (p): p is { type: "text"; text: string } => p.type === "text",
                    );
                    if (textParts.length > 0) {
                      return textParts.map((p, i) => (
                        <span key={i}>{p.text}</span>
                      ));
                    }
                  }
                  return prompt;
                })()}
              </div>
            </div>

            {/* Messages */}
            {deferredMessages.map((msg) => {
              if (msg.role === "user") return null;

              const seenReasoning = new Set<string>();

              return (
                <PartErrorBoundary key={msg.id}>
                  <div className="space-y-3.5">
                    {(msg.parts ?? []).map((part, i) => {
                      if (!part || typeof part !== "object") return null;

                      if (part.type === "text" && part.text.trim()) {
                        return (
                          <div
                            key={i}
                            className="prose prose-sm dark:prose-invert max-w-none leading-relaxed prose-code:before:content-none prose-code:after:content-none text-foreground prose-strong:text-foreground prose-blockquote:border-border prose-hr:border-border prose-headings:font-semibold"
                          >
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
                        const isRunning =
                          toolState === "input-available" ||
                          toolState === "input-streaming";
                        const isDone = toolState === "output-available";
                        const toolInput = part.input as
                          | Record<string, unknown>
                          | undefined;
                        const inputSummary = formatToolInput(part.input);

                        // Hide internal SDK tools
                        if (part.toolName === "ToolSearch") return null;

                        // Bash → terminal style
                        if (part.toolName === "Bash") {
                          const outputText = isDone
                            ? (() => {
                                const str =
                                  typeof part.output === "string"
                                    ? part.output
                                    : JSON.stringify(part.output);
                                if (
                                  !str ||
                                  str === '""' ||
                                  str === "Completed"
                                )
                                  return null;
                                return str.length > 500
                                  ? str.slice(0, 500) + "…"
                                  : str;
                              })()
                            : null;

                          return (
                            <Terminal
                              key={`tool-${part.toolCallId}`}
                              command={
                                typeof toolInput?.command === "string"
                                  ? toolInput.command
                                  : undefined
                              }
                              output={outputText}
                              isRunning={isRunning}
                            />
                          );
                        }

                        // File/search tools
                        if (hasToolCard(part.toolName)) {
                          return (
                            <ToolCard
                              key={`tool-${part.toolCallId}`}
                              toolName={part.toolName}
                              input={toolInput}
                              output={part.output}
                              isRunning={isRunning}
                              isDone={isDone}
                            />
                          );
                        }

                        // app data tools → data card
                        if (
                          part.toolName === "mcp__app_data__update_app_data" ||
                          part.toolName === "mcp__app_data__read_app_data"
                        ) {
                          return (
                            <AppDataToolCard
                              key={`tool-${part.toolCallId}`}
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
                              key={`tool-${part.toolCallId}`}
                              toolName={part.toolName}
                              input={toolInput}
                              output={part.output}
                              isRunning={isRunning}
                              isDone={isDone}
                              meta={customToolCatalog[part.toolName]}
                            />
                          );
                        }

                        // All other tools → compact card
                        return (
                          <div
                            key={`tool-${part.toolCallId}`}
                            className="not-prose flex items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2 text-xs font-mono"
                          >
                            {isRunning && (
                              <AppLoader size="xs" interactive={false} />
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
                  </div>
                </PartErrorBoundary>
              );
            })}

            {/* Loading indicator */}
            {isBusy &&
              (() => {
                const lastMsg =
                  deferredMessages[deferredMessages.length - 1];
                if (!lastMsg || lastMsg.role === "user") {
                  return (
                    <AgentWorkingIndicator starting={status === "submitted"} />
                  );
                }
                const lastPart = lastMsg?.parts?.at(-1);
                const hasOwnFeedback =
                  lastPart &&
                  (lastPart.type === "text" ||
                    lastPart.type === "reasoning" ||
                    (lastPart.type === "dynamic-tool" &&
                      lastPart.state !== "output-available"));
                if (hasOwnFeedback) return null;
                return <AgentWorkingIndicator />;
              })()}

            {/* Completed indicator */}
            {!isBusy && runStatus === "completed" && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs">
                <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
                <span className="font-medium text-emerald-700 dark:text-emerald-300">
                  Agent completed
                </span>
              </div>
            )}

            {!isBusy && runStatus === "failed" && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs">
                <XIcon className="size-3 text-destructive" />
                <span className="font-medium text-destructive">
                  Agent failed
                </span>
              </div>
            )}
          </StickToBottom.Content>
        </StickToBottom>
      </div>
    </div>
  );
}
