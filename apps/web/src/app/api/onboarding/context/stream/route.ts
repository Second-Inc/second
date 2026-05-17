import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireReadyState,
} from "@/lib/auth";
import { findWorkspaceById } from "@/lib/db";
import { streamFromWorker } from "@/lib/agent/worker-bridge";
import {
  DEFAULT_RUNTIME_SETTINGS,
  normalizeRuntimeSettings,
  parseRuntimeSettings,
} from "@/lib/agent/runtime-registry";
import { getWorkerUrl, workerFetch } from "@/lib/worker-client";

type OnboardingContextBody = {
  messages?: UIMessage[];
  runtimeId?: unknown;
  runtimeModel?: unknown;
  runtimeParams?: unknown;
};

const ONBOARDING_CONTEXT_TOOL = "mcp__second__set_onboarding_context";
const ONBOARDING_CLAUDE_MODEL = "claude-opus-4-6";
const ONBOARDING_CLAUDE_PARAMS = {
  effort: "high",
  thinking: "adaptive",
};
const THATS_ENOUGH_PATTERN =
  /\b(that'?s enough|stop researching|show your findings so far|show your findings)\b/i;

function logId() {
  return Math.random().toString(36).slice(2, 8);
}

function textFromMessage(message: UIMessage | undefined): string {
  if (!message?.parts) return "";
  return message.parts
    .flatMap((part) =>
      part?.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n")
    .trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isThatsEnoughRequest(text: string): boolean {
  return THATS_ENOUGH_PATTERN.test(text);
}

function onboardingTranscriptSummary(messages: UIMessage[]): string | null {
  const lines: string[] = [];

  for (const message of messages.slice(-12)) {
    if (message.role === "user") {
      const text = textFromMessage(message);
      if (text) lines.push(`User: ${truncateText(text, 500)}`);
      continue;
    }

    if (message.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (part?.type === "text" && part.text.trim()) {
        lines.push(`Assistant: ${truncateText(part.text.trim(), 900)}`);
        continue;
      }

      if (part?.type !== "dynamic-tool") continue;
      const input = part.input && typeof part.input === "object" && !Array.isArray(part.input)
        ? (part.input as Record<string, unknown>)
        : {};

      if (part.toolName === "WebSearch") {
        const query = typeof input.query === "string" ? input.query : "";
        if (query) lines.push(`WebSearch query: ${truncateText(query, 300)}`);
        continue;
      }

      if (part.toolName === "WebFetch") {
        const url = typeof input.url === "string" ? input.url : "";
        if (url) lines.push(`WebFetch URL: ${truncateText(url, 300)}`);
      }
    }
  }

  const summary = lines.join("\n").trim();
  return summary ? truncateText(summary, 6000) : null;
}

function emailDomain(email: string): string | null {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  return domain || null;
}

function uniqueToolNames(toolCalls: Array<{ toolName: string }>): string[] {
  return [...new Set(toolCalls.map((tool) => tool.toolName))];
}

function runtimeSettingsFromBody(body: OnboardingContextBody) {
  const parsed = parseRuntimeSettings({
    runtimeId: body.runtimeId,
    runtimeModel: body.runtimeModel,
    runtimeParams: body.runtimeParams,
  });
  const normalized = normalizeRuntimeSettings(parsed ?? DEFAULT_RUNTIME_SETTINGS);

  if (normalized.runtimeId === "claude-code") {
    return normalizeRuntimeSettings({
      ...normalized,
      model: ONBOARDING_CLAUDE_MODEL,
      params: {
        ...normalized.params,
        ...ONBOARDING_CLAUDE_PARAMS,
      },
    });
  }

  if (normalized.runtimeId !== "codex-cli") return normalized;

  return {
    ...normalized,
    params: {
      ...normalized.params,
      sandbox: "read-only",
    },
  };
}

function systemPrompt() {
  return [
    "You are Second's onboarding context agent.",
    "Your job is to gather useful, concise professional context about the current user and their company/workspace for future internal app and agent builds.",
    "",
    "Use public web research when it is helpful. Prefer official company pages, professional profiles, product pages, and reputable sources. Do not infer protected traits, private personal details, secrets, or anything sensitive. If a fact is uncertain, say that it is inferred or unknown.",
    "Use the current user's work email and email domain as important disambiguation signals when researching the user and company. Do not ignore the email address.",
    "First identify reliable company/user identifiers: email address, email domain, official company domain, public profile URLs, social handles, and exact name matches. Then only connect facts when those identifiers clearly link to each other.",
    "Never assume that two companies, people, domains, or social accounts are related just because they share a similar name. If the link is not explicit, either leave it out or label it as uncertain.",
    "Do not invent likely needs, recommendations, sales tactics, content ideas, or work the user might want. Only include factual professional context that is supported by known onboarding data or public sources.",
    "Do not over-research. Once the official domain/profile and a small number of relevant corroborating sources are enough, stop searching and call the context tool.",
    "Crucial: do not over-research; limit research to about 6-10 sources and that's it (before calling the context tool).",
    "",
    "You must call mcp__second__set_onboarding_context exactly once after research is complete.",
    "Do not return JSON, do not write files, and do not ask the user to paste private data.",
    "",
    "The tool arguments are shown to the user for review and editing before onboarding finishes, so write them in clean, readable prose or short bullets.",
    "Format each section as a bold-only Markdown label on its own line, then a blank line, then the content. Add a blank line before every later bold-only section label.",
    "Keep both fields compact and directly useful for future agents.",
  ].join("\n");
}

function userPrompt(input: {
  requestedText: string;
  workspaceName: string;
  displayName: string;
  email: string;
  profileRole?: string | null;
  existingCompanyContext?: string | null;
  existingUserContext?: string | null;
  transcriptSummary?: string | null;
}) {
  const domain = emailDomain(input.email);
  return [
    input.requestedText || "Research and prepare onboarding context.",
    "",
    "Known onboarding data:",
    `- Company/workspace name: ${input.workspaceName}`,
    `- Current user name: ${input.displayName}`,
    `- Current user email: ${input.email}`,
    domain ? `- Current user email domain: ${domain}` : null,
    input.profileRole ? `- Current user role: ${input.profileRole}` : null,
    input.existingCompanyContext
      ? `- Existing company context: ${input.existingCompanyContext}`
      : null,
    input.existingUserContext
      ? `- Existing user context: ${input.existingUserContext}`
      : null,
    input.transcriptSummary
      ? `- Visible work so far:\n${input.transcriptSummary}`
      : null,
    "",
    "Research guidance:",
    "- Use the email address and email domain to disambiguate the company and current user from similarly named people or organizations.",
    "- If the email domain points to a company website, inspect that domain or search for official pages for that domain.",
    "- Quickly identify identifiers that tie the user and company together: email domain, official website, public profile URLs, social handles, and exact company/user names.",
    "- Only include information when the source is clearly tied to those identifiers. Do not merge same-name companies, unrelated domains, or unrelated social accounts.",
    "- If public information about the exact user is not available, keep userContext limited to known onboarding data and clearly avoid guessing.",
    "- Do not include phrases like 'likely needs include' or lists of inferred tasks. Future agents can infer tasks later from the user's actual request.",
    "- Avoid broad research. Search just enough to establish reliable identifiers and useful factual context, then call the context tool.",
    input.transcriptSummary
      ? "- If the user asked to stop researching, do not continue broad research. Use the visible work so far plus known onboarding data and call the context tool with the best supported draft you can."
      : null,
    "",
    "Research from this information, then call the context tool with:",
    "- companyContext: what the company does, its market/product, and useful operating context for future Builder runs.",
    "- userContext: factual professional context about this current user, such as name, role, responsibilities, public work, and professional background. Avoid speculative needs or recommendations.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(request: Request) {
  let readyState: Awaited<ReturnType<typeof requireReadyState>>;
  try {
    readyState = await requireReadyState({ headers: request.headers });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const workspaceId = readyState.memberships[0]?.workspaceId;
  if (!workspaceId) {
    return Response.json({ error: "workspace_required" }, { status: 403 });
  }

  const workspace = await findWorkspaceById(workspaceId);
  if (!workspace) {
    return Response.json({ error: "workspace_not_found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as OnboardingContextBody;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const latestUserText = textFromMessage(latestUserMessage);
  const isEnoughRequest = isThatsEnoughRequest(latestUserText);
  const runtimeSettings = runtimeSettingsFromBody(body);
  const sessionId = `onboarding-${workspaceId}-${readyState.user._id}`;
  const requestId = logId();
  const startedAt = Date.now();
  const prompt = userPrompt({
    requestedText: latestUserText,
    workspaceName: workspace.name,
    displayName: readyState.user.displayName,
    email: readyState.user.email,
    profileRole: readyState.user.profileRole,
    existingCompanyContext: workspace.companyContext,
    existingUserContext: readyState.user.userContext,
    transcriptSummary: isEnoughRequest
      ? onboardingTranscriptSummary(messages)
      : null,
  });

  console.info("[onboarding-context] stream prepared", {
    requestId,
    workspaceId,
    userId: readyState.user._id,
    emailDomain: emailDomain(readyState.user.email),
    runtimeId: runtimeSettings.runtimeId,
    runtimeModel: runtimeSettings.model,
    runtimeParams: runtimeSettings.params,
    messageCount: messages.length,
    promptChars: prompt.length,
    isEnoughRequest,
    hasExistingCompanyContext: Boolean(workspace.companyContext?.trim()),
    hasExistingUserContext: Boolean(readyState.user.userContext?.trim()),
    allowedTools: [
      "WebSearch",
      "WebFetch",
      ONBOARDING_CONTEXT_TOOL,
    ],
    maxTurns: null,
  });

  if (isEnoughRequest) {
    await workerFetch(`/sessions/${encodeURIComponent(sessionId)}`, {
      workerUrl: getWorkerUrl(),
      method: "DELETE",
    }).catch((error) => {
      console.warn("[onboarding-context] failed to clear active research session", {
        requestId,
        sessionId,
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      console.info("[onboarding-context] worker stream start", {
        requestId,
        sessionId,
        workspaceId,
        runtimeId: runtimeSettings.runtimeId,
        runtimeModel: runtimeSettings.model,
      });

      try {
        const result = await streamFromWorker(writer, {
          workerUrl: getWorkerUrl(),
          appId: sessionId,
          workspaceId,
          requestedByUserId: readyState.user._id,
          requestedByUserName: readyState.user.displayName,
          prompt,
          systemPrompt: systemPrompt(),
          runtimeSettings,
          runtimeMode: "workspace_agent",
          allowedTools: [
            "WebSearch",
            "WebFetch",
            ONBOARDING_CONTEXT_TOOL,
          ],
        });

        const contextToolCalls = result.toolCalls.filter(
          (tool) => tool.toolName === ONBOARDING_CONTEXT_TOOL,
        );
        const finishDetails = {
          requestId,
          sessionId,
          workspaceId,
          runtimeId: runtimeSettings.runtimeId,
          runtimeModel: runtimeSettings.model,
          elapsedMs: Date.now() - startedAt,
          toolNames: uniqueToolNames(result.toolCalls),
          toolCallCount: result.toolCalls.length,
          contextToolCalls,
          usage: result.usage
            ? {
                numTurns: result.usage.numTurns,
                durationMs: result.usage.durationMs,
                totalCostUsd: result.usage.totalCostUsd,
              }
            : null,
          maxTurns: null,
        };

        if (contextToolCalls.length === 0) {
          console.warn("[onboarding-context] finished without context tool call", {
            ...finishDetails,
            likelyReason: "model_finished_without_required_context_tool",
          });
          return;
        }

        const incompleteContextToolCalls = contextToolCalls.filter(
          (tool) => !tool.outputAvailable || tool.flushedWithoutOutput,
        );
        if (incompleteContextToolCalls.length > 0) {
          console.warn("[onboarding-context] context tool did not resolve cleanly", {
            ...finishDetails,
            incompleteContextToolCalls,
          });
          return;
        }

        console.info("[onboarding-context] finished with context tool", finishDetails);
      } catch (error) {
        console.error("[onboarding-context] worker stream failed", {
          requestId,
          sessionId,
          workspaceId,
          runtimeId: runtimeSettings.runtimeId,
          runtimeModel: runtimeSettings.model,
          elapsedMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
