import {
  query,
  tool,
  createSdkMcpServer,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { awaitDependencyWarmup } from "./dep-warmup.js";
import { RUNTIME_FORBIDDEN_ENV_KEYS } from "./runtimes/process-env.js";
import {
  claudeSubprocessEnvScrubValue,
  claudeSubprocessIsolationStatus,
} from "./runtimes/claude-env.js";

export type AgentToolSpec = {
  type: "builtin" | "custom";
  name: string;
  displayName?: string;
  description?: string;
  enabled: boolean;
  integration?: {
    name: string;
    domain: string;
    keySlug?: string;
    auth?: {
      type: "static_secret" | "oauth2";
      providerKey?: string;
      identity?: "triggering_user";
      authorizationUrl?: string;
      tokenUrl?: string;
      scopes?: string[];
      tokenAuthMethod?: "client_secret_post" | "client_secret_basic" | "none";
      authorizationParams?: Record<string, string>;
      tokenParams?: Record<string, string>;
      accessTokenPlacement?: { type: "bearer_authorization_header" };
    };
  } | null;
  endpoint?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    queryParams?: Record<string, string>;
    body?: unknown;
  } | null;
  mockData?: unknown;
};

export type AgentConfig = {
  id: string;
  name: string;
  systemPrompt: string;
  tools: AgentToolSpec[];
  dataCollections?: string[];
};

export type ToolCallFailureDetails = {
  id: string;
  toolName: string;
  toolDisplayName?: string;
  toolDescription?: string;
  capturedAt: string;
  rawInput?: string;
  parsedInput: Record<string, unknown>;
  toolSpec: {
    endpoint?: AgentToolSpec["endpoint"];
    integration?: AgentToolSpec["integration"];
  };
  failure: {
    kind: "tool_execute_error" | "tool_execute_non_json_response";
    toolExecuteHttpStatus: number;
    error: string;
    statusCode?: number;
    response?: unknown;
  };
};

export type ToolFailureContext = {
  failures: ToolCallFailureDetails[];
};

export type SessionConfig = {
  systemPrompt: string;
  workingDirectory: string;
  runtimeMode?: "builder" | "workspace_agent";
  allowedTools?: string[];
  maxTurns?: number;
  model?: string;
  /** When running an app agent, the agent config from agents.json */
  agentConfig?: AgentConfig;
  /** URL of the web server's internal tool-execute endpoint */
  toolExecuteUrl?: string;
  /** Shared token for worker→web internal API auth */
  internalApiToken?: string;
  /** Workspace ID for tool execution */
  workspaceId?: string;
  /** App ID for tool execution */
  appId?: string;
  /** Server-created app-agent run ID. Used by web to resolve the triggering user. */
  runId?: string;
  /** Draft runs use isolated draft data; governed tools still enforce the approved agents.json hash. */
  sourceVersion?: "draft" | "published";
  /** App/user metadata for integration requirement sync. No secret values are included. */
  appName?: string;
  requestedByUserId?: string;
  requestedByUserName?: string;
  /** Stable key for runtime-local auth/session/config state. */
  runtimeSessionKey?: string;
  /** Captures hidden app metadata generation tool calls. */
  appMetadataResult?: {
    called: boolean;
    name: string | null;
    description: string | null;
  };
  /** Per app-agent run capture of failed custom integration tool calls. */
  toolFailureContext?: ToolFailureContext;
};

export type SecondToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
};

export type PresentPlanArgs = {
  title: string;
  overview: string;
  features: Array<{ name: string; description: string; emoji?: string }>;
  dataFlow: string;
  agents: string | null;
  backend: string | null;
};

export type PresentSuggestionItem = {
  emoji?: string;
  icon?: string;
  title: string;
  subtitle: string;
};

export type PresentSuggestionsArgs = {
  suggestions: PresentSuggestionItem[];
};

export type SetOnboardingContextArgs = {
  companyContext: string;
  userContext: string;
};

export type ReportToolCallFailedArgs = {
  description: string;
  attemptedTask?: string;
  toolName?: string;
};

export const APP_TOOL_FAILURE_REPORT_TOOL_NAME = "report_tool_call_failed";

export function executePresentPlanTool(
  args: PresentPlanArgs,
): SecondToolTextResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: true,
          status: "presented",
          title: args.title,
          overview: args.overview,
          features: args.features,
          dataFlow: args.dataFlow,
          agents: args.agents,
          backend: args.backend,
          message:
            "Plan presented to the user. Stop here and wait for the user's approval or requested changes before writing code.",
        }),
      },
    ],
  };
}

export function executePresentSuggestionsTool(
  args: PresentSuggestionsArgs,
): SecondToolTextResult {
  const suggestions = args.suggestions
    .map((suggestion) => ({
      emoji: suggestionEmojiFromInput(suggestion),
      title: typeof suggestion.title === "string" ? suggestion.title.trim() : "",
      subtitle: typeof suggestion.subtitle === "string" ? suggestion.subtitle.trim() : "",
    }))
    .filter((suggestion) => suggestion.title && suggestion.subtitle)
    .slice(0, 6);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: suggestions.length > 0,
          status: suggestions.length > 0 ? "presented" : "invalid",
          suggestions,
          message: suggestions.length > 0
            ? "Suggestions presented to the user. Stop here and wait for the user to pick a suggestion before planning or writing code."
            : "No valid suggestions were provided. Call present_suggestions again with 2 to 6 suggestions.",
        }),
      },
    ],
  };
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

function suggestionEmojiFromInput(suggestion: PresentSuggestionItem): string {
  const emoji = typeof suggestion.emoji === "string" ? suggestion.emoji.trim() : "";
  const icon = typeof suggestion.icon === "string" ? suggestion.icon.trim() : "";
  if (emoji) {
    return LEGACY_SUGGESTION_ICON_EMOJI[legacySuggestionIconKey(emoji)] ?? emoji;
  }
  if (icon) {
    return LEGACY_SUGGESTION_ICON_EMOJI[legacySuggestionIconKey(icon)] ?? "✨";
  }
  return "✨";
}

// ---------------------------------------------------------------------------
// Custom tools — exposed via an in-process MCP server
// ---------------------------------------------------------------------------

function createPresentPlanTool() {
  return tool(
    "present_plan",
    "Present a structured build plan to the user for approval before writing any code. After this tool returns, stop and wait for the user to approve or request changes from the plan card. Use this tool the FIRST time you build something new.",
    {
      title: z.string().describe("Short, clear name for the app (e.g. 'Lead Enrichment Dashboard')"),
      overview: z.string().describe("2-3 sentence high-level summary of what will be built"),
      features: z
        .array(
          z.object({
            name: z.string().describe("Feature name"),
            description: z.string().describe("Short description of what the feature does"),
            emoji: z
              .string()
              .optional()
              .describe("Emoji that represents this feature (e.g. '🔍', '🤖', '📊')"),
          }),
        )
        .describe("Main features / capabilities of the app"),
      dataFlow: z.string().describe("How data moves through the app — state, APIs, storage"),
      agents: z
        .string()
        .nullable()
        .describe("Agent definitions if applicable, null if not available"),
      backend: z
        .string()
        .nullable()
        .describe("Custom backend logic if applicable, null if not available"),
    },
    async (args) => executePresentPlanTool(args),
  );
}

function createPresentSuggestionsTool() {
  return tool(
    "present_suggestions",
    "Present 2 to 6 app ideas as clickable suggestion cards when the user asks you to suggest something to build. After this tool returns, stop and wait for the user to choose a suggestion. Do not call present_plan or write code in the same turn.",
    {
      suggestions: z
        .array(
          z.object({
            emoji: z
              .string()
              .describe("Single emoji that visually represents this suggestion, for example 📊, ✅, 📅, ✉️, 🤖, 🔎, 🛡️, ⚙️, or ✨."),
            title: z
              .string()
              .min(1)
              .max(80)
              .describe("Short app idea title."),
            subtitle: z
              .string()
              .min(1)
              .max(220)
              .describe("One-sentence description of what this app would do."),
          }),
        )
        .min(2)
        .max(6)
        .describe("Clickable app suggestions to show the user."),
    },
    async (args) => executePresentSuggestionsTool(args),
  );
}

// ---------------------------------------------------------------------------
// Collect workspace source files (excluding node_modules, .git, etc.)
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".cache",
  ".claude",
  "attachments",
]);
const MAX_FILE_SIZE = 512 * 1024; // 512KB per file
const SNAPSHOT_WARN_SIZE = 8 * 1024 * 1024; // 8MB warning
const SNAPSHOT_MAX_SIZE = 12 * 1024 * 1024; // 12MB hard fail

export class SnapshotLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotLimitError";
  }
}

export type WorkspaceSnapshot = {
  files: Record<string, string>;
  totalBytes: number;
  warnings: string[];
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

export function collectWorkspaceSnapshot(
  dir: string,
  base?: string,
): WorkspaceSnapshot {
  const root = base ?? dir;
  const files: Record<string, string> = {};
  let totalBytes = 0;

  function walk(currentDir: string): void {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const rel = relative(root, fullPath);
      const stat = statSync(fullPath);
      if (stat.size > MAX_FILE_SIZE) {
        throw new SnapshotLimitError(
          `Cannot persist "${rel}" (${formatBytes(stat.size)}). Per-file limit is ${formatBytes(MAX_FILE_SIZE)}.`,
        );
      }

      const content = readFileSync(fullPath, "utf-8");
      if (content.includes("\0")) {
        throw new SnapshotLimitError(
          `Cannot persist binary file "${rel}". Snapshot persistence currently supports text files only.`,
        );
      }

      const contentBytes = Buffer.byteLength(content, "utf-8");
      if (contentBytes > MAX_FILE_SIZE) {
        throw new SnapshotLimitError(
          `Cannot persist "${rel}" (${formatBytes(contentBytes)}). Per-file limit is ${formatBytes(MAX_FILE_SIZE)}.`,
        );
      }

      totalBytes += contentBytes;
      if (totalBytes > SNAPSHOT_MAX_SIZE) {
        throw new SnapshotLimitError(
          `Snapshot is too large (${formatBytes(totalBytes)}). Maximum allowed is ${formatBytes(SNAPSHOT_MAX_SIZE)}. Reduce build output or move large assets to external storage.`,
        );
      }

      files[rel] = content;
    }
  }

  walk(dir);

  const warnings: string[] = [];
  if (totalBytes >= SNAPSHOT_WARN_SIZE) {
    warnings.push(
      `Snapshot is large (${formatBytes(totalBytes)}). Consider reducing build output before it reaches the ${formatBytes(SNAPSHOT_MAX_SIZE)} hard limit.`,
    );
  }

  return { files, totalBytes, warnings };
}

function shouldInstallDependencies(workingDirectory: string): boolean {
  const packageJsonPath = join(workingDirectory, "package.json");
  if (!existsSync(packageJsonPath)) return false;

  const nodeModulesPath = join(workingDirectory, "node_modules");
  if (!existsSync(nodeModulesPath)) return true;

  const lockPath = join(workingDirectory, "package-lock.json");
  if (!existsSync(lockPath)) return true;

  try {
    const packageJsonMtime = statSync(packageJsonPath).mtimeMs;
    const lockMtime = statSync(lockPath).mtimeMs;
    if (packageJsonMtime > lockMtime) return true;
  } catch {
    return true;
  }

  return hasMissingDeclaredDependencies(workingDirectory);
}

function hasMissingDeclaredDependencies(workingDirectory: string): boolean {
  const packageJsonPath = join(workingDirectory, "package.json");

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const packageNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];

    return packageNames.some(
      (packageName) => {
        const packageJson = join(
          workingDirectory,
          "node_modules",
          ...packageName.split("/"),
          "package.json",
        );
        return !existsSync(packageJson);
      },
    );
  } catch {
    return true;
  }
}

function runNpmCommand(
  args: string[],
  workingDirectory: string,
): { ok: true; output: string } | { ok: false; output: string } {
  try {
    const output = execFileSync("npm", args, {
      cwd: workingDirectory,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (error) {
    const stdout =
      typeof error === "object" && error && "stdout" in error
        ? String((error as { stdout?: string | Buffer }).stdout ?? "")
        : "";
    const stderr =
      typeof error === "object" && error && "stderr" in error
        ? String((error as { stderr?: string | Buffer }).stderr ?? "")
        : "";
    const message =
      typeof error === "object" && error && "message" in error
        ? String((error as { message?: string }).message ?? "")
        : String(error);

    const output = [stdout.trim(), stderr.trim(), message.trim()]
      .filter(Boolean)
      .join("\n\n");

    return {
      ok: false,
      output: output || `npm ${args.join(" ")} failed.`,
    };
  }
}

function runCommandAsync(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ ok: true; output: string } | { ok: false; output: string }> {
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const output = [stdout?.trim(), stderr?.trim()]
          .filter(Boolean)
          .join("\n\n");
        resolve({ ok: false, output: output || `${command} ${args.join(" ")} failed.` });
      } else {
        resolve({ ok: true, output: stdout || "" });
      }
    });
  });
}

function ensureNodeTypesForViteWorkspace(workingDirectory: string): string | null {
  const packageJsonPath = join(workingDirectory, "package.json");
  if (!existsSync(packageJsonPath)) return null;

  try {
    const packageJsonRaw = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonRaw) as {
      devDependencies?: Record<string, string>;
    };

    const devDependencies = packageJson.devDependencies ?? {};
    let packageChanged = false;

    if (typeof devDependencies["@types/node"] !== "string") {
      devDependencies["@types/node"] = "^20.19.0";
      packageChanged = true;
    }

    if (packageChanged) {
      packageJson.devDependencies = devDependencies;
      writeFileSync(
        packageJsonPath,
        `${JSON.stringify(packageJson, null, 2)}\n`,
        "utf-8",
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Failed to update package.json for Node typings: ${msg}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// done_building tool — agent calls this when the app is ready to preview
// ---------------------------------------------------------------------------

export async function executeDoneBuildingTool(
  workingDirectory: string,
  args: { summary: string },
): Promise<SecondToolTextResult> {
  const requiredFiles = ["package.json", "index.html", "src/main.tsx"];
  const missingFiles = requiredFiles.filter(
    (file) => !existsSync(join(workingDirectory, file)),
  );

  if (missingFiles.length > 0) {
    return {
      content: [
        {
          type: "text",
          text: `Build failed — required project files are missing:\n${missingFiles.map((file) => `- ${file}`).join("\n")}\n\nRestore the Vite project structure and call done_building again.`,
        },
      ],
    };
  }

  const nodeTypesPatchError = ensureNodeTypesForViteWorkspace(workingDirectory);
  if (nodeTypesPatchError) {
    return {
      content: [
        {
          type: "text",
          text: `Build failed before install/build:\n\n${nodeTypesPatchError}`,
        },
      ],
    };
  }

  await awaitDependencyWarmup(workingDirectory);

  if (shouldInstallDependencies(workingDirectory)) {
    const installResult = runNpmCommand(
      ["install", "--include=dev", "--no-audit", "--no-fund"],
      workingDirectory,
    );
    if (!installResult.ok) {
      return {
        content: [
          {
            type: "text",
            text: `Build failed while installing dependencies. Fix the issue below, then call done_building again:\n\n${installResult.output}`,
          },
        ],
      };
    }
  }

  let hasTypecheckScript = false;
  try {
    const pkg = JSON.parse(readFileSync(join(workingDirectory, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    hasTypecheckScript = typeof pkg.scripts?.typecheck === "string";
  } catch {
    // proceed with build only
  }

  const buildPromise = runCommandAsync("npm", ["run", "build"], workingDirectory);
  const typecheckPromise = hasTypecheckScript
    ? runCommandAsync("npm", ["run", "typecheck"], workingDirectory)
    : null;

  const [buildResult, typecheckResult] = await Promise.all([
    buildPromise,
    typecheckPromise,
  ]);

  if ((typecheckResult && !typecheckResult.ok) || !buildResult.ok) {
    const errors: string[] = [];
    if (typecheckResult && !typecheckResult.ok) {
      errors.push(`TypeScript errors:\n${typecheckResult.output}`);
    }
    if (!buildResult.ok) errors.push(`Build errors:\n${buildResult.output}`);
    return {
      content: [
        {
          type: "text",
          text: `Build failed — fix these errors then call done_building again:\n\n${errors.join("\n\n")}`,
        },
      ],
    };
  }

  if (!existsSync(join(workingDirectory, "dist", "index.html"))) {
    return {
      content: [
        {
          type: "text",
          text: "Build failed — dist/index.html was not produced. Ensure your Vite build outputs dist/index.html, then call done_building again.",
        },
      ],
    };
  }

  let snapshot: WorkspaceSnapshot;
  try {
    snapshot = collectWorkspaceSnapshot(workingDirectory);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Build finished but snapshot persistence failed:\n\n${msg}\n\nReduce snapshot size and call done_building again.`,
        },
      ],
    };
  }

  if (snapshot.warnings.length > 0) {
    console.warn("[done_building] snapshot warning:", snapshot.warnings.join(" "));
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          status: "complete",
          summary: args.summary,
          fileCount: Object.keys(snapshot.files).length,
          totalBytes: snapshot.totalBytes,
          warning: snapshot.warnings[0] ?? null,
        }),
      },
    ],
  };
}

function createDoneBuildingTool(workingDirectory: string) {
  return tool(
    "done_building",
    "Signal that you have finished building the app and it is ready to preview. This runs npm run build and persists the built artifact. If there are TypeScript, Vite, or snapshot-size errors, you will receive them and must fix before calling again.",
    {
      summary: z
        .string()
        .describe("A 1-2 sentence summary of what was built or changed"),
    },
    async (args) => executeDoneBuildingTool(workingDirectory, args),
  );
}

export function executeSetAppMetadataTool(
  config: SessionConfig,
  args: { name: string; description: string },
): SecondToolTextResult {
  const name = args.name.trim().replace(/\s+/g, " ");
  const description = args.description.trim().replace(/\s+/g, " ");

  if (config.appMetadataResult) {
    config.appMetadataResult.called = true;
    config.appMetadataResult.name = name;
    config.appMetadataResult.description = description;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: true,
          status: "captured",
          name,
          description,
        }),
      },
    ],
  };
}

function createSetAppMetadataTool(config: SessionConfig) {
  return tool(
    "set_app_metadata",
    "Set the generated app name and app description. Use this exactly once when asked to generate app metadata.",
    {
      name: z
        .string()
        .min(2)
        .max(80)
        .describe("Human-readable app name. Do not include duplicate suffixes like (1)."),
      description: z
        .string()
        .min(2)
        .max(300)
        .describe("One concise sentence explaining what the app does."),
    },
    async (args) => executeSetAppMetadataTool(config, args),
  );
}

function getOnboardingContextUrl(config: SessionConfig): string {
  const toolExecuteUrl =
    config.toolExecuteUrl ??
    `${process.env.WEB_URL ?? "http://localhost:3000"}/api/internal/tool-execute`;
  return toolExecuteUrl.replace(
    /\/api\/internal\/tool-execute$/,
    "/api/internal/onboarding-context",
  );
}

export async function executeSetOnboardingContextTool(
  config: SessionConfig,
  args: SetOnboardingContextArgs,
): Promise<SecondToolTextResult> {
  const logDetails = {
    workspaceId: config.workspaceId ?? null,
    userId: config.requestedByUserId ?? null,
    appId: config.appId ?? null,
    companyContextChars: args.companyContext?.length ?? 0,
    userContextChars: args.userContext?.length ?? 0,
  };
  console.info("[worker:onboarding-context-tool] called", logDetails);

  if (!config.workspaceId) {
    console.warn("[worker:onboarding-context-tool] missing workspaceId", logDetails);
    return {
      content: [{
        type: "text",
        text: "Cannot save onboarding context because workspaceId is not available.",
      }],
    };
  }
  if (!config.requestedByUserId) {
    console.warn("[worker:onboarding-context-tool] missing userId", logDetails);
    return {
      content: [{
        type: "text",
        text: "Cannot save onboarding context because userId is not available.",
      }],
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.internalApiToken) {
    headers.Authorization = `Bearer ${config.internalApiToken}`;
  }

  try {
    const response = await fetch(getOnboardingContextUrl(config), {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: config.workspaceId,
        userId: config.requestedByUserId,
        companyContext: args.companyContext,
        userContext: args.userContext,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      console.warn("[worker:onboarding-context-tool] save failed", {
        ...logDetails,
        status: response.status,
        responseChars: text.length,
      });
      return {
        content: [{
          type: "text",
          text: `Failed to save onboarding context (HTTP ${response.status}): ${text || "Request failed"}`,
        }],
      };
    }

    console.info("[worker:onboarding-context-tool] save succeeded", {
      ...logDetails,
      status: response.status,
      responseChars: text.length,
    });

    return {
      content: [{
        type: "text",
        text,
      }],
    };
  } catch (err) {
    console.warn("[worker:onboarding-context-tool] save threw", {
      ...logDetails,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      content: [{
        type: "text",
        text: `Failed to save onboarding context: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }
}

function createSetOnboardingContextTool(config: SessionConfig) {
  return tool(
    "set_onboarding_context",
    "Save concise company context and current-user context gathered during onboarding. Call this exactly once after public research is complete. After this tool returns, stop and wait for the user to approve, edit, retry, or skip from the context card. Do not include secrets, private contact data, protected-class inferences, or unverified claims.",
    {
      companyContext: z
        .string()
        .min(1)
        .max(3000)
        .describe("Concise company/workspace context useful for future app building. Include uncertainty when facts are inferred."),
      userContext: z
        .string()
        .min(1)
        .max(3000)
        .describe("Concise context about the current user who is onboarding, useful for future agents. Include only relevant professional context and uncertainty when inferred."),
    },
    async (args) => executeSetOnboardingContextTool(config, args),
  );
}

function getIntegrationRequirementsUrl(config: SessionConfig): string {
  const toolExecuteUrl =
    config.toolExecuteUrl ??
    `${process.env.WEB_URL ?? "http://localhost:3000"}/api/internal/tool-execute`;
  return toolExecuteUrl.replace(
    /\/api\/internal\/tool-execute$/,
    "/api/internal/integration-requirements",
  );
}

function getIntegrationSetupTelemetryUrl(config: SessionConfig): string {
  const toolExecuteUrl =
    config.toolExecuteUrl ??
    `${process.env.WEB_URL ?? "http://localhost:3000"}/api/internal/tool-execute`;
  return toolExecuteUrl.replace(
    /\/api\/internal\/tool-execute$/,
    "/api/internal/integration-setup-telemetry",
  );
}

function getAppIntegrationKeysUrl(config: SessionConfig): string {
  const toolExecuteUrl =
    config.toolExecuteUrl ??
    `${process.env.WEB_URL ?? "http://localhost:3000"}/api/internal/tool-execute`;
  return toolExecuteUrl.replace(
    /\/api\/internal\/tool-execute$/,
    "/api/internal/workspace-integrations",
  );
}

export async function executeListAppIntegrationKeysTool(
  config: SessionConfig,
  args: { domain?: string },
): Promise<SecondToolTextResult> {
  if (!config.workspaceId) {
    return {
      content: [{
        type: "text",
        text: "Cannot list integrations because workspaceId is not available.",
      }],
    };
  }
  if (!config.appId) {
    return {
      content: [{
        type: "text",
        text: "Cannot list integrations because appId is not available.",
      }],
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.internalApiToken) {
    headers["Authorization"] = `Bearer ${config.internalApiToken}`;
  }

  try {
    const response = await fetch(getAppIntegrationKeysUrl(config), {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: config.workspaceId,
        appId: config.appId,
        domain: args.domain,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      return {
        content: [{
          type: "text",
          text: `Failed to list app integration grants (HTTP ${response.status}): ${text || "Request failed"}`,
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text,
      }],
    };
  } catch (err) {
    return {
      content: [{
        type: "text",
        text: `Failed to list app integration grants: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }
}

function createListAppIntegrationKeysTool(config: SessionConfig) {
  return tool(
    "list_app_integration_keys",
    "List only this app's app-scoped integration key grants without secret values. Static grants report configured secrets/permissions; OAuth grants report approved auth metadata and whether the workspace provider client is configured. The response may include workspace summary counts, but those counts do not satisfy this app. Call this before deciding whether setup instructions are needed and again whenever you add or change a custom tool, permission/scope, secret requirement, or OAuth auth metadata. A credential configured for another app does not satisfy this app. Treat an integration as configured only when this tool reports a configured grant for the current app, domain, keySlug, and auth mode.",
    {
      domain: z
        .string()
        .optional()
        .describe("Optional integration domain to filter by, e.g. slack.com"),
    },
    async (args) => executeListAppIntegrationKeysTool(config, args),
  );
}

type IntegrationSyncGrant = {
  id?: string;
  name?: string;
  domain: string;
  keySlug: string;
};

type IntegrationSyncResult =
  | {
      ok: true;
      status: number;
      grants: IntegrationSyncGrant[];
      syncedCount: number;
      requestedCount?: number;
      skippedCount?: number;
      deletedStaleCount?: number;
    }
  | {
      ok: false;
      status?: number;
      message: string;
    };

const INTEGRATION_SYNC_ATTEMPTS = 3;
const DEFAULT_POSTHOG_TOKEN = "phc_Xg1Id4ZaOowXb3UWqiPo8z3XTRXwTUgY0bD3zD7xWex";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const DEFAULT_SENTRY_DSN =
  "https://e520b21c4c457cf44bc5f69717b6f3a0@o4510307894165504.ingest.us.sentry.io/4511401492217856";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envValue(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function telemetryDisabled(): boolean {
  return (
    process.env.SECOND_TELEMETRY_DISABLED === "1" ||
    process.env.SECOND_POSTHOG_DISABLED === "1"
  );
}

function errorMessageForTelemetry(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.replace(/\s+/g, " ").trim().slice(0, 500);
  }
  if (typeof error === "string" && error.trim()) {
    return error.replace(/\s+/g, " ").trim().slice(0, 500);
  }
  return null;
}

function integrationTelemetryProperties(input: {
  status: "failed" | "verification_failed";
  reason: string;
  config: SessionConfig;
  httpStatus?: number | null;
  errorMessage?: string | null;
  expectedGrants: IntegrationSyncGrant[];
  persistedGrants?: IntegrationSyncGrant[];
  requestedCount?: number | null;
  syncedCount?: number | null;
  skippedCount?: number | null;
  deletedStaleCount?: number | null;
  attemptCount?: number | null;
}) {
  return {
    second_oss: true,
    status: input.status,
    source: "worker",
    reason: input.reason,
    workspace_id: input.config.workspaceId ?? null,
    app_id: input.config.appId ?? null,
    run_id: input.config.runId ?? null,
    runtime_mode: input.config.runtimeMode ?? "builder",
    http_status: input.httpStatus ?? null,
    requested_count: input.requestedCount ?? input.expectedGrants.length,
    synced_count: input.syncedCount ?? null,
    skipped_count: input.skippedCount ?? null,
    deleted_stale_count: input.deletedStaleCount ?? null,
    attempt_count: input.attemptCount ?? null,
    error_message: input.errorMessage ?? null,
    expected_integrations: input.expectedGrants,
    persisted_integrations: input.persistedGrants ?? [],
    worker_pid: process.pid,
    worker_uptime_seconds: Math.round(process.uptime()),
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 3000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function reportIntegrationSyncToWebTelemetry(
  config: SessionConfig,
  properties: Record<string, unknown>,
): Promise<void> {
  if (!config.workspaceId || !config.appId) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.internalApiToken) {
    headers["Authorization"] = `Bearer ${config.internalApiToken}`;
  }

  await fetchWithTimeout(getIntegrationSetupTelemetryUrl(config), {
    method: "POST",
    headers,
    body: JSON.stringify(properties),
  }).catch(() => undefined);
}

async function reportIntegrationSyncToPostHog(
  properties: Record<string, unknown>,
): Promise<void> {
  if (telemetryDisabled()) return;
  const token =
    envValue(["SECOND_POSTHOG_TOKEN", "NEXT_PUBLIC_POSTHOG_TOKEN"]) ||
    DEFAULT_POSTHOG_TOKEN;
  const host =
    envValue(["SECOND_POSTHOG_HOST", "NEXT_PUBLIC_POSTHOG_HOST"]) ||
    DEFAULT_POSTHOG_HOST;
  if (!token) return;

  const event =
    properties.status === "verification_failed"
      ? "integration_setup_sync_verification_failed"
      : "integration_setup_sync_failed";
  await fetchWithTimeout(new URL("/i/v0/e/", host).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: token,
      event,
      distinct_id:
        typeof properties.run_id === "string" && properties.run_id
          ? properties.run_id
          : typeof properties.app_id === "string" && properties.app_id
            ? properties.app_id
            : "unknown-worker",
      properties,
    }),
  }).catch(() => undefined);
}

function readWorkerSentryDsn(): string {
  if (
    process.env.SECOND_TELEMETRY_DISABLED === "1" ||
    process.env.SECOND_ERROR_REPORTING_DISABLED === "1" ||
    process.env.SECOND_SENTRY_DISABLED === "1"
  ) {
    return "";
  }
  return envValue(["SECOND_SENTRY_DSN", "SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"]) ||
    DEFAULT_SENTRY_DSN;
}

function sentryEnvelopeUrl(dsn: string): string | null {
  try {
    const parsed = new URL(dsn);
    const projectId = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (!parsed.username || !projectId) return null;
    return `${parsed.origin}/api/${projectId}/envelope/?sentry_key=${encodeURIComponent(parsed.username)}`;
  } catch {
    return null;
  }
}

async function reportIntegrationSyncToSentry(
  properties: Record<string, unknown>,
): Promise<void> {
  const dsn = readWorkerSentryDsn();
  const url = dsn ? sentryEnvelopeUrl(dsn) : null;
  if (!url) return;

  const eventId = randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();
  const message =
    typeof properties.error_message === "string" && properties.error_message
      ? properties.error_message
      : `Integration setup sync ${properties.status}`;
  const envelope = [
    JSON.stringify({ event_id: eventId, dsn, sent_at: now }),
    JSON.stringify({ type: "event" }),
    JSON.stringify({
      event_id: eventId,
      timestamp: now,
      platform: "node",
      level: "warning",
      logger: "second.worker",
      message,
      environment:
        envValue(["SENTRY_ENVIRONMENT", "SECOND_ENVIRONMENT", "NODE_ENV"]) ||
        "development",
      release:
        envValue(["SENTRY_RELEASE", "SECOND_RELEASE_VERSION", "VERCEL_GIT_COMMIT_SHA"]) ||
        undefined,
      tags: {
        "second.error_source": "integration_setup_sync",
        "second.source": "worker",
        "second.status": String(properties.status ?? "unknown"),
        "second.reason": String(properties.reason ?? "unknown"),
      },
      contexts: {
        integration_setup_sync: properties,
      },
    }),
  ].join("\n");

  await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope" },
    body: envelope,
  }).catch(() => undefined);
}

async function reportIntegrationSyncFailure(input: {
  status: "failed" | "verification_failed";
  reason: string;
  config: SessionConfig;
  httpStatus?: number | null;
  errorMessage?: string | null;
  expectedGrants: IntegrationSyncGrant[];
  persistedGrants?: IntegrationSyncGrant[];
  requestedCount?: number | null;
  syncedCount?: number | null;
  skippedCount?: number | null;
  deletedStaleCount?: number | null;
  attemptCount?: number | null;
}): Promise<void> {
  const properties = integrationTelemetryProperties(input);
  console.warn("[worker] integration setup sync failed", JSON.stringify(properties));
  await Promise.all([
    reportIntegrationSyncToWebTelemetry(input.config, properties),
    reportIntegrationSyncToPostHog(properties),
    reportIntegrationSyncToSentry(properties),
  ]);
}

function normalizeIntegrationDomainForSync(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

function normalizeIntegrationKeySlugForSync(value: unknown): string {
  const normalized = (typeof value === "string" ? value : "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "default";
}

function extractExpectedIntegrationGrants(setupConfig: unknown): IntegrationSyncGrant[] {
  const record = asRecord(setupConfig);
  const integrations = Array.isArray(record?.integrations)
    ? record.integrations
    : [];
  const seen = new Set<string>();
  const expected: IntegrationSyncGrant[] = [];

  for (const item of integrations) {
    const integration = asRecord(item);
    const domainInput = integration?.domain;
    if (typeof domainInput !== "string" || !domainInput.trim()) continue;
    const domain = normalizeIntegrationDomainForSync(domainInput);
    if (!domain) continue;
    const keySlug = normalizeIntegrationKeySlugForSync(integration?.keySlug);
    const key = `${domain}|${keySlug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    expected.push({
      domain,
      keySlug,
      name:
        typeof integration?.name === "string" && integration.name.trim()
          ? integration.name.trim()
          : domain,
    });
  }

  return expected;
}

function parseIntegrationSyncResponse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeIntegrationSyncGrants(value: unknown): IntegrationSyncGrant[] {
  if (!Array.isArray(value)) return [];

  const grants: IntegrationSyncGrant[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const domainInput = record?.domain;
    if (typeof domainInput !== "string" || !domainInput.trim()) continue;
    const grant: IntegrationSyncGrant = {
      domain: normalizeIntegrationDomainForSync(domainInput),
      keySlug: normalizeIntegrationKeySlugForSync(record?.keySlug),
    };
    if (typeof record?.id === "string" && record.id.trim()) {
      grant.id = record.id.trim();
    }
    if (typeof record?.name === "string" && record.name.trim()) {
      grant.name = record.name.trim();
    }
    grants.push(grant);
  }

  return grants;
}

function integrationSyncErrorFromBody(
  body: Record<string, unknown> | null,
  fallback: string,
): string {
  const error = body?.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  const message = body?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  return fallback;
}

function missingIntegrationGrants(
  expected: IntegrationSyncGrant[],
  actual: IntegrationSyncGrant[],
): IntegrationSyncGrant[] {
  const actualKeys = new Set(
    actual.map((grant) => `${grant.domain}|${grant.keySlug}`),
  );
  return expected.filter(
    (grant) => !actualKeys.has(`${grant.domain}|${grant.keySlug}`),
  );
}

function formatIntegrationGrantRefs(grants: IntegrationSyncGrant[]): string {
  return grants
    .map((grant) => `${grant.name ?? grant.domain} (${grant.domain}/${grant.keySlug})`)
    .join(", ");
}

async function syncIntegrationRequirements(
  config: SessionConfig,
  payload: {
    setupConfig?: unknown;
  },
): Promise<IntegrationSyncResult> {
  if (!config.workspaceId || !config.appId) {
    return {
      ok: false,
      message: "workspaceId or appId is not available",
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.internalApiToken) {
    headers["Authorization"] = `Bearer ${config.internalApiToken}`;
  }

  try {
    const response = await fetch(getIntegrationRequirementsUrl(config), {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: config.workspaceId,
        appId: config.appId,
        runId: config.runId,
        appName: config.appName,
        requestedByUserId: config.requestedByUserId,
        requestedByUserName: config.requestedByUserName,
        ...payload,
      }),
    });

    const text = await response.text().catch(() => "");
    const body = parseIntegrationSyncResponse(text);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: `HTTP ${response.status}: ${integrationSyncErrorFromBody(body, "request failed")}`,
      };
    }

    if (!body) {
      return {
        ok: false,
        status: response.status,
        message: "sync route returned a non-JSON response",
      };
    }

    if (body.success !== true) {
      return {
        ok: false,
        status: response.status,
        message: integrationSyncErrorFromBody(body, "sync route returned success=false"),
      };
    }

    if (!Array.isArray(body.grants)) {
      return {
        ok: false,
        status: response.status,
        message: "sync route did not return persisted integration grants",
      };
    }

    const grants = normalizeIntegrationSyncGrants(body.grants);
    return {
      ok: true,
      status: response.status,
      grants,
      syncedCount:
        typeof body.syncedCount === "number"
          ? body.syncedCount
          : grants.length,
      requestedCount:
        typeof body.requestedCount === "number" ? body.requestedCount : undefined,
      skippedCount:
        typeof body.skippedCount === "number" ? body.skippedCount : undefined,
      deletedStaleCount:
        typeof body.deletedStaleCount === "number"
          ? body.deletedStaleCount
          : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function syncIntegrationRequirementsWithRetry(
  config: SessionConfig,
  payload: { setupConfig?: unknown },
  expectedGrants: IntegrationSyncGrant[],
): Promise<
  | {
      ok: true;
      result: Extract<IntegrationSyncResult, { ok: true }>;
      attemptCount: number;
    }
  | {
      ok: false;
      result: IntegrationSyncResult;
      missingGrants: IntegrationSyncGrant[];
      attemptCount: number;
    }
> {
  let lastResult: IntegrationSyncResult | null = null;
  let lastMissingGrants: IntegrationSyncGrant[] = [];
  let attemptCount = 0;

  for (let attempt = 1; attempt <= INTEGRATION_SYNC_ATTEMPTS; attempt += 1) {
    attemptCount = attempt;
    const result = await syncIntegrationRequirements(config, payload);
    lastResult = result;

    if (result.ok) {
      lastMissingGrants = missingIntegrationGrants(expectedGrants, result.grants);
      if ((result.skippedCount ?? 0) === 0 && lastMissingGrants.length === 0) {
        return { ok: true, result, attemptCount };
      }
    } else if (result.message === "workspaceId or appId is not available") {
      break;
    }

    if (attempt < INTEGRATION_SYNC_ATTEMPTS) {
      await sleep(150 * attempt);
    }
  }

  return {
    ok: false,
    result: lastResult ?? {
      ok: false,
      message: "sync was not attempted",
    },
    missingGrants: lastMissingGrants,
    attemptCount,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

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

  const record = asRecord(value);
  if (record) {
    for (const item of Object.values(record)) collectTemplateNames(item, names);
  }
}

function isSecretLikePlaceholder(name: string): boolean {
  if (isSecretPlaceholderName(name)) return false;
  return /(^|[_.-])(api[_-]?key|key|secret|token|password|bearer|auth)([_.-]|$)/i.test(
    name,
  );
}

function isSecretPlaceholderName(name: string): boolean {
  return name.startsWith("secrets.") && name.length > "secrets.".length;
}

function isTokenPlaceholderName(name: string): boolean {
  return /(^|[_.-])(oauth|access[_-]?token|refresh[_-]?token|bearer|token|secret)([_.-]|$)/i.test(
    name,
  );
}

function endpointDeclaresAuthorizationHeader(endpoint: Record<string, unknown>): boolean {
  const headers = asRecord(endpoint.headers);
  return !!headers && Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isOAuthToolAuth(value: unknown): value is Record<string, unknown> {
  return asRecord(value)?.type === "oauth2";
}

function oauthValidationIssues(input: {
  prefix: string;
  auth: Record<string, unknown>;
  endpoint: Record<string, unknown>;
  templateNames: Set<string>;
}): string[] {
  const issues: string[] = [];
  const scopes = Array.isArray(input.auth.scopes)
    ? input.auth.scopes.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0)
    : [];

  if (typeof input.auth.providerKey !== "string" || !input.auth.providerKey.trim()) {
    issues.push(`${input.prefix}: OAuth tools require integration.auth.providerKey.`);
  }
  if (input.auth.identity !== "triggering_user") {
    issues.push(`${input.prefix}: OAuth tools must use integration.auth.identity "triggering_user".`);
  }
  if (!isHttpsUrl(input.auth.authorizationUrl)) {
    issues.push(`${input.prefix}: OAuth tools require an HTTPS integration.auth.authorizationUrl.`);
  }
  if (!isHttpsUrl(input.auth.tokenUrl)) {
    issues.push(`${input.prefix}: OAuth tools require an HTTPS integration.auth.tokenUrl.`);
  }
  if (scopes.length === 0) {
    issues.push(`${input.prefix}: OAuth tools require at least one exact scope in integration.auth.scopes.`);
  }

  const rejectedPlaceholders = [...input.templateNames].filter(
    (name) => isSecretPlaceholderName(name) || isTokenPlaceholderName(name),
  );
  if (rejectedPlaceholders.length > 0) {
    issues.push(
      `${input.prefix}: OAuth tools must not include token or secret placeholders (${rejectedPlaceholders.map((name) => `{{${name}}}`).join(", ")}). Second injects the access token server-side.`,
    );
  }

  const headers = asRecord(input.endpoint.headers);
  if (
    headers &&
    Object.keys(headers).some((name) => name.toLowerCase() === "authorization")
  ) {
    issues.push(`${input.prefix}: OAuth tools must not declare an Authorization header. Second injects it.`);
  }

  return issues;
}

function customToolValidationIssues(agents: unknown[]): string[] {
  const issues: string[] = [];

  for (const agent of agents) {
    const agentRecord = asRecord(agent);
    if (!agentRecord) continue;
    const agentName =
      typeof agentRecord.name === "string"
        ? agentRecord.name
        : typeof agentRecord.id === "string"
          ? agentRecord.id
          : "Agent";
    const tools = Array.isArray(agentRecord.tools) ? agentRecord.tools : [];

    for (const toolSpec of tools) {
      const toolRecord = asRecord(toolSpec);
      if (!toolRecord || toolRecord.type !== "custom") continue;

      const toolName =
        typeof toolRecord.displayName === "string"
          ? toolRecord.displayName
          : typeof toolRecord.name === "string"
            ? toolRecord.name
            : "custom tool";
      const prefix = `${agentName} / ${toolName}`;
      if (toolRecord.name === APP_TOOL_FAILURE_REPORT_TOOL_NAME) {
        issues.push(
          `${prefix}: "${APP_TOOL_FAILURE_REPORT_TOOL_NAME}" is reserved for Second's automatic tool-failure recovery tool. Rename this custom tool.`,
        );
      }
      const integration = asRecord(toolRecord.integration);
      const endpoint = asRecord(toolRecord.endpoint);
      const auth = isOAuthToolAuth(integration?.auth)
        ? asRecord(integration?.auth)
        : null;

      if (
        !integration ||
        typeof integration.name !== "string" ||
        !integration.name.trim() ||
        typeof integration.domain !== "string" ||
        !integration.domain.trim()
      ) {
        issues.push(`${prefix}: custom tools must include integration.name and integration.domain.`);
      }

      if (!endpoint) {
        issues.push(`${prefix}: custom tools must include endpoint.method and endpoint.url.`);
        continue;
      }

      if (typeof endpoint.method !== "string" || !endpoint.method.trim()) {
        issues.push(`${prefix}: endpoint.method is required.`);
      }
      if (typeof endpoint.url !== "string" || !endpoint.url.trim()) {
        issues.push(`${prefix}: endpoint.url is required.`);
      }

      const templateNames = new Set<string>();
      collectTemplateNames(endpoint, templateNames);
      if (auth) {
        issues.push(...oauthValidationIssues({
          prefix,
          auth,
          endpoint,
          templateNames,
        }));
      } else {
        const usesNamedSecret = [...templateNames].some(isSecretPlaceholderName);
        const secretLikeNames = [...templateNames].filter(isSecretLikePlaceholder);
        if (secretLikeNames.length > 0) {
          issues.push(
            `${prefix}: use {{secrets.SECRET_NAME}} for configured integration secrets, not ${secretLikeNames.map((name) => `{{${name}}}`).join(", ")}.`,
          );
        }
        if (!usesNamedSecret && endpointDeclaresAuthorizationHeader(endpoint)) {
          issues.push(
            `${prefix}: unauthenticated public tools must not declare an Authorization header. Use {{secrets.SECRET_NAME}} for static credentials or integration.auth for OAuth.`,
          );
        }
      }
    }
  }

  return issues;
}

export async function executePresentAgentsTool(
  config: SessionConfig,
): Promise<SecondToolTextResult> {
  const agentsPath = join(config.workingDirectory, "agents.json");
  if (!existsSync(agentsPath)) {
    return {
      content: [{
        type: "text",
        text: "Agent configuration was not accepted because agents.json does not exist. Write agents.json first, then call present_agents again.",
      }],
    };
  }

  let agentsConfig: unknown;
  let fileAgents: unknown[];
  let fileAppTools: unknown[];
  try {
    agentsConfig = JSON.parse(readFileSync(agentsPath, "utf-8")) as unknown;
    const agentsRecord = asRecord(agentsConfig);
    fileAgents = Array.isArray(agentsRecord?.agents)
      ? agentsRecord.agents
      : [];
    fileAppTools = Array.isArray(agentsRecord?.appTools)
      ? agentsRecord.appTools
      : [];
  } catch (err) {
    return {
      content: [{
        type: "text",
        text: `Agent configuration was not accepted because agents.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }

  if (fileAgents.length === 0 && fileAppTools.length === 0) {
    return {
      content: [{
        type: "text",
        text: "Agent configuration was not accepted because agents.json does not contain any agents or appTools. Fix agents.json and call present_agents again.",
      }],
    };
  }

  const validationSubjects = fileAppTools.length > 0
    ? [
        ...fileAgents,
        {
          id: "app-tools",
          name: "App actions",
          tools: fileAppTools,
        },
      ]
    : fileAgents;
  const validationIssues = customToolValidationIssues(validationSubjects).map(
    (issue) => `agents.json: ${issue}`,
  );
  if (validationIssues.length > 0) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          status: "changes_required",
          source: "agents.json",
          agents: fileAgents,
          appTools: fileAppTools,
          validationIssues,
          message:
            "Agent configuration needs changes before approval. Fix agents.json and call present_agents again. For static custom integrations, saved secrets must use named placeholders like {{secrets.SLACK_BOT_TOKEN}}. For OAuth custom integrations, declare integration.auth and do not include token placeholders; Second injects the access token server-side. Public unauthenticated APIs may omit secrets and auth metadata.",
        }),
      }],
    };
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        ok: true,
        status: "presented",
        source: "agents.json",
        agents: fileAgents,
        appTools: fileAppTools,
        message:
          `${fileAgents.length} agent(s) and ${fileAppTools.length} app action(s) presented to the user. Stop here and wait for the user's approval or requested changes before implementing app code or presenting integration setup.`,
      }),
    }],
  };
}

function createPresentAgentsTool(config: SessionConfig) {
  return tool(
    "present_agents",
    "Present agents.json to the user for approval. Call this after writing or updating agents.json with agents and/or appTools. The tool reads and validates agents.json as the source of truth. After this tool returns, stop and wait for the user to approve or request changes from the agents card.",
    {},
    async () => executePresentAgentsTool(config),
  );
}

export async function executePresentIntegrationSetupTool(
  config: SessionConfig,
  args: { integrations: Array<{ name: string }> },
): Promise<SecondToolTextResult> {
  const setupPath = join(config.workingDirectory, "integration-setup.json");
  if (!existsSync(setupPath)) {
    return {
      content: [{
        type: "text",
        text: "Integration setup instructions were not synced because integration-setup.json does not exist. Write integration-setup.json first, then call present_integration_setup again.",
      }],
    };
  }

  let setupConfig: unknown;
  try {
    setupConfig = JSON.parse(readFileSync(setupPath, "utf-8"));
  } catch (err) {
    return {
      content: [{
        type: "text",
        text: `Integration setup instructions were not synced because integration-setup.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }

  const names = args.integrations.map((item) => item.name).join(", ");
  const expectedGrants = extractExpectedIntegrationGrants(setupConfig);
  const syncAttempt = await syncIntegrationRequirementsWithRetry(
    config,
    { setupConfig },
    expectedGrants,
  );
  if (!syncAttempt.ok && !syncAttempt.result.ok) {
    await reportIntegrationSyncFailure({
      status: "failed",
      reason: "worker_sync_request_failed",
      config,
      httpStatus: syncAttempt.result.status ?? null,
      errorMessage: syncAttempt.result.message,
      expectedGrants,
      attemptCount: syncAttempt.attemptCount,
    });
    return {
      content: [{
        type: "text",
        text: `Integration setup instructions were not synced: ${syncAttempt.result.message}.`,
      }],
    };
  }

  if (!syncAttempt.ok) {
    const result = syncAttempt.result;
    await reportIntegrationSyncFailure({
      status: "verification_failed",
      reason: "worker_read_after_write_mismatch",
      config,
      httpStatus: result.status ?? null,
      errorMessage: "Integration setup sync did not return every expected persisted grant.",
      expectedGrants,
      persistedGrants: result.ok ? result.grants : [],
      requestedCount: result.ok ? result.requestedCount ?? null : null,
      syncedCount: result.ok ? result.syncedCount : null,
      skippedCount: result.ok ? result.skippedCount ?? null : null,
      deletedStaleCount: result.ok ? result.deletedStaleCount ?? null : null,
      attemptCount: syncAttempt.attemptCount,
    });
    const missingText = syncAttempt.missingGrants.length > 0
      ? ` Missing persisted grants: ${formatIntegrationGrantRefs(syncAttempt.missingGrants)}.`
      : "";
    const skippedCount = result.ok ? result.skippedCount ?? 0 : 0;
    const skippedText = skippedCount > 0
      ? ` ${skippedCount} setup item(s) were skipped.`
      : "";
    return {
      content: [{
        type: "text",
        text: `Integration setup instructions were not fully synced.${missingText}${skippedText}`,
      }],
    };
  }

  return {
    content: [{
      type: "text",
      text: `Integration setup instructions presented to user and synced: ${names || "none"}.`,
    }],
  };
}

function createPresentIntegrationSetupTool(config: SessionConfig) {
  return tool(
    "present_integration_setup",
    "Present simple setup instructions for app-scoped integration keys that are not connected or are missing required permissions/secrets. Call this after writing integration-setup.json. Keep steps short, direct, verified against official docs, and suitable for non-developers. Group permissions by capability/risk, such as Read-only, Write, and Delete/Admin. Step descriptions may include markdown links and bold text like **New API Key**; the UI renders them. For direct provider/settings links, use labels like [Linear | Security & access](https://linear.app/...) so the UI can render a compact provider chip with the second part muted. You may call this again after updating integration-setup.json; each call re-syncs the chat card and global integrations page with the complete current requirements for this app. Do not call it when this app's live integration grant metadata already satisfies all requirements.",
    {
      integrations: z.array(z.object({
        name: z.string().describe("Integration display name, e.g. Slack"),
        domain: z.string().describe("Domain used to match this app's integration key, e.g. slack.com"),
        keySlug: z.string().optional().describe("Stable app-scoped key identity for this provider, e.g. default or write-access"),
        keyName: z.string().optional().describe("Human-readable key name shown to admins, e.g. Linear read key for Roadmap Tracker"),
        capabilityLabel: z.string().optional().describe("Short capability label, e.g. Linear read or Slack post"),
        why: z.string().describe("One short sentence explaining why this app needs the integration"),
        permissionGroups: z.array(z.object({
          name: z.string().describe("Human-readable capability/risk group name, e.g. Read-only, Write, or Delete/Admin"),
          description: z.string().optional().describe("Short reason this group is needed"),
          permissions: z.array(z.string()).describe("Exact permission or scope names required by the provider"),
        })).describe("Permission groups required by this app, grouped by capability and risk such as Read-only, Write, and Delete/Admin"),
        auth: z.object({
          type: z.literal("oauth2"),
          providerKey: z.string().describe("Workspace-local provider key, e.g. google, microsoft, zoom"),
          identity: z.literal("triggering_user").describe("OAuth tools run as the user who triggered the app-agent run"),
          authorizationUrl: z.string().describe("Official provider OAuth authorization URL"),
          tokenUrl: z.string().describe("Official provider OAuth token URL"),
          scopes: z.array(z.string()).describe("Exact OAuth scopes this app needs"),
          tokenAuthMethod: z.enum(["client_secret_post", "client_secret_basic", "none"]).optional(),
          authorizationParams: z.record(z.string(), z.string()).optional(),
          tokenParams: z.record(z.string(), z.string()).optional(),
        }).optional().describe("OAuth 2.0 provider metadata for user-scoped integrations. Omit for static API-key/bot-token integrations."),
        secrets: z.array(z.object({
          name: z.string().describe("Secret name, e.g. SLACK_BOT_TOKEN"),
          label: z.string().optional().describe("Human-readable label"),
          description: z.string().describe("Plain-language description of what the user should paste"),
          required: z.boolean().optional().describe("Whether this secret is required"),
        })).describe("Secret values the workspace owner needs to provide, without values"),
        setupInstructions: z.object({
          overview: z.string().describe("Plain-language summary of what the user needs to do"),
          steps: z.array(z.object({
            title: z.string().describe("Short step title"),
            description: z.string().describe("Simple, human-readable instruction. Markdown links and **bold** text are allowed. Direct provider/settings links should use labels like [Provider | Settings section](https://...) so the UI renders a compact link chip."),
            url: z.string().optional().describe("Official or verified link for this step"),
          })).describe("Step-by-step setup instructions"),
          links: z.array(z.object({
            label: z.string().describe("Link label"),
            url: z.string().describe("Official or verified URL"),
          })).optional().describe("Helpful official links"),
        }).describe("Simple setup instructions for humans"),
      })),
    },
    async (args) => executePresentIntegrationSetupTool(config, args),
  );
}

function createSecondToolsMcpServer(config: SessionConfig) {
  const tools = [
    createListAppIntegrationKeysTool(config),
    createPresentPlanTool(),
    createPresentSuggestionsTool(),
    createPresentAgentsTool(config),
    createPresentIntegrationSetupTool(config),
    createDoneBuildingTool(config.workingDirectory),
    createSetAppMetadataTool(config),
    createSetOnboardingContextTool(config),
  ].filter((toolDef) => mcpToolIsExposed(config, "second", toolDef.name));

  return createSdkMcpServer({
    name: "second",
    version: "1.0.0",
    tools,
  });
}

// ---------------------------------------------------------------------------
// Default tools the agent can use without permission prompts
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_TOOLS = [
  "Skill",
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "mcp__second__present_plan",
  "mcp__second__present_suggestions",
  "mcp__second__list_app_integration_keys",
  "mcp__second__present_agents",
  "mcp__second__present_integration_setup",
  "mcp__second__done_building",
];

export function defaultAllowedToolsForRuntimeMode(
  runtimeMode: SessionConfig["runtimeMode"],
): string[] {
  return runtimeMode === "workspace_agent" ? ["Skill"] : [...DEFAULT_ALLOWED_TOOLS];
}

const CLAUDE_BUILTIN_TOOLS = new Set([
  "Skill",
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
]);

function claudeBuiltinToolsFromAllowedTools(allowedTools: string[]): string[] {
  return allowedTools.filter((toolName) => CLAUDE_BUILTIN_TOOLS.has(toolName));
}

function mcpToolIsExposed(
  config: SessionConfig,
  serverName: "second" | "app_tools" | "app_data",
  toolName: string,
): boolean {
  if (!config.allowedTools) return true;
  return config.allowedTools.includes(`mcp__${serverName}__${toolName}`);
}

const APP_SENSITIVE_ENV_VARS = [
  ...RUNTIME_FORBIDDEN_ENV_KEYS,
  "INTERNAL_API_TOKEN",
  "MONGODB_URI",
  "REDIS_URL",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "TOOL_EXECUTE_URL",
  "WEB_URL",
  "WORKER_URL",
];

function executableExists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commonClaudeExecutableCandidates(): string[] {
  if (process.platform !== "darwin") return [];
  return [
    join(homedir(), ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
}

function resolveClaudeExecutable(): string | null {
  const configured = process.env.SECOND_CLAUDE_PATH?.trim();
  if (configured) return executableExists(configured) ? configured : null;

  try {
    const resolved = execFileSync("which", ["claude"], {
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (resolved && executableExists(resolved)) return resolved;
  } catch {
    // Fall back to common installer paths below.
  }

  return commonClaudeExecutableCandidates().find(executableExists) ?? null;
}

export type SDKMessage = {
  type: string;
  subtype?: string;
  session_id?: string;
  event?: unknown;
  message?: unknown;
  result?: string;
  total_cost_usd?: number;
  uuid?: string;
  [key: string]: unknown;
};

function sdkMessageContent(message: SDKMessage): unknown[] {
  const inner = message.message;
  if (!inner || typeof inner !== "object") return [];
  const content = (inner as { content?: unknown }).content;
  return Array.isArray(content) ? content : [];
}

function isBlockingApprovalToolName(name: unknown): boolean {
  return (
    name === "present_plan" ||
    name === "present_suggestions" ||
    name === "present_agents" ||
    name === "set_onboarding_context" ||
    name === "mcp__second__present_plan" ||
    name === "mcp__second__present_suggestions" ||
    name === "mcp__second__present_agents" ||
    name === "mcp__second__set_onboarding_context"
  );
}

function collectBlockingApprovalToolUses(message: SDKMessage, ids: Set<string>): void {
  if (message.type !== "assistant") return;
  for (const item of sdkMessageContent(message)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: unknown; id?: unknown; name?: unknown };
    if (
      record.type === "tool_use" &&
      typeof record.id === "string" &&
      isBlockingApprovalToolName(record.name)
    ) {
      ids.add(record.id);
    }
  }
}

function hasBlockingApprovalToolResult(message: SDKMessage, ids: Set<string>): boolean {
  if (message.type !== "user") return false;
  for (const item of sdkMessageContent(message)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: unknown; tool_use_id?: unknown };
    if (
      record.type === "tool_result" &&
      typeof record.tool_use_id === "string" &&
      ids.has(record.tool_use_id)
    ) {
      return true;
    }
  }
  return false;
}

function formatToolData(data: unknown): string {
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function parseCustomToolInput(input: string | undefined): Record<string, unknown> {
  if (!input) return {};

  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { input: parsed };
  } catch {
    return { input };
  }
}

const MAX_CAPTURED_TOOL_FAILURES = 5;
const MAX_FAILURE_STRING_CHARS = 6000;
const RAW_INPUT_SECRET_PATTERN =
  /authorization|bearer|token|secret|password|api[_-]?key|cookie|client[_-]?secret/i;

function isSecretLikeKey(key: string): boolean {
  return /(^|[_.-])(authorization|cookie|set-cookie|api[_-]?key|secret|token|password|bearer|client[_-]?secret)([_.-]|$)/i.test(
    key,
  );
}

function sanitizeFailurePayload(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > MAX_FAILURE_STRING_CHARS
      ? `${value.slice(0, MAX_FAILURE_STRING_CHARS)}\n...truncated`
      : value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth >= 6) return "[Max depth reached]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeFailurePayload(item, depth + 1));
  }
  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = isSecretLikeKey(key)
        ? "[REDACTED]"
        : sanitizeFailurePayload(entry, depth + 1);
    }
    return sanitized;
  }
  return String(value);
}

function recordToolCallFailure(
  config: SessionConfig,
  failure: Omit<ToolCallFailureDetails, "id" | "capturedAt">,
): ToolCallFailureDetails {
  const context = config.toolFailureContext ?? { failures: [] };
  config.toolFailureContext = context;
  const captured: ToolCallFailureDetails = {
    id: `tool-failure-${Date.now()}-${context.failures.length + 1}`,
    capturedAt: new Date().toISOString(),
    ...failure,
    rawInput: failure.rawInput
      ? RAW_INPUT_SECRET_PATTERN.test(failure.rawInput)
        ? "[REDACTED_RAW_INPUT]"
        : String(sanitizeFailurePayload(failure.rawInput))
      : undefined,
    parsedInput: sanitizeFailurePayload(failure.parsedInput) as Record<string, unknown>,
    toolSpec: sanitizeFailurePayload(failure.toolSpec) as ToolCallFailureDetails["toolSpec"],
    failure: sanitizeFailurePayload(failure.failure) as ToolCallFailureDetails["failure"],
  };

  context.failures.push(captured);
  if (context.failures.length > MAX_CAPTURED_TOOL_FAILURES) {
    context.failures.splice(0, context.failures.length - MAX_CAPTURED_TOOL_FAILURES);
  }
  return captured;
}

function failureMatchesToolName(
  failure: ToolCallFailureDetails,
  requestedToolName: string,
): boolean {
  const requested = requestedToolName.trim();
  const normalizedRequested = normalizeAppToolFailureName(requested);
  return (
    failure.toolName === requested ||
    failure.toolName === normalizedRequested ||
    `mcp__app_tools__${failure.toolName}` === requested ||
    `app_tools.${failure.toolName}` === requested
  );
}

function capturedToolFailureForReport(
  config: SessionConfig,
  requestedToolName?: string,
): ToolCallFailureDetails | null {
  const failures = config.toolFailureContext?.failures ?? [];
  if (failures.length === 0) return null;

  const latestFailure = failures[failures.length - 1];
  const toolNameHint = requestedToolName?.trim();
  if (!toolNameHint) return latestFailure;

  // Treat toolName as a disambiguation hint for rare multi-failure runs. The
  // report tool must never depend on the model naming the tool perfectly.
  return (
    [...failures]
      .reverse()
      .find((failure) => failureMatchesToolName(failure, toolNameHint)) ??
    latestFailure
  );
}

function getToolFailureReportUrl(config: SessionConfig): string {
  const toolExecuteUrl =
    config.toolExecuteUrl ??
    `${process.env.WEB_URL ?? "http://localhost:3000"}/api/internal/tool-execute`;
  return toolExecuteUrl.replace(
    /\/api\/internal\/tool-execute$/,
    "/api/internal/tool-failure-report",
  );
}

function buildUncapturedToolFailureReport(input: {
  config: SessionConfig;
  args: ReportToolCallFailedArgs;
  description: string;
}): Record<string, unknown> {
  const requestedToolName = input.args.toolName?.trim();
  const normalizedToolName = normalizeAppToolFailureName(requestedToolName);
  const toolSpec = findCustomToolForFailureReport(input.config, requestedToolName);

  return {
    id: `tool-failure-uncaptured-${Date.now()}`,
    capturedAt: new Date().toISOString(),
    toolName: toolSpec?.name ?? normalizedToolName ?? requestedToolName ?? "unknown",
    ...(toolSpec?.displayName ? { toolDisplayName: toolSpec.displayName } : {}),
    ...(toolSpec?.description ? { toolDescription: toolSpec.description } : {}),
    parsedInput: {},
    toolSpec: {
      endpoint: toolSpec?.endpoint,
      integration: toolSpec?.integration,
    },
    failure: {
      kind: "uncaptured_tool_failure",
      error:
        "No failed custom tool call was captured in the worker session. The app-agent report contains the available failure context.",
    },
    appAgentReport: {
      description: input.description,
      ...(input.args.attemptedTask ? { attemptedTask: input.args.attemptedTask } : {}),
      ...(requestedToolName ? { requestedToolName } : {}),
    },
  };
}

export async function executeReportToolCallFailedTool(
  config: SessionConfig,
  args: ReportToolCallFailedArgs,
): Promise<SecondToolTextResult> {
  const description = String(args.description ?? "").trim();
  if (!description) {
    return {
      content: [{
        type: "text",
        text: "Cannot report the failed tool call because description is required.",
      }],
    };
  }

  if (!config.workspaceId || !config.appId || !config.runId || !config.agentConfig?.id) {
    return {
      content: [{
        type: "text",
        text: "Cannot report the failed tool call because this app-agent run is missing workspace, app, run, or agent identity.",
      }],
    };
  }

  const capturedFailure =
    capturedToolFailureForReport(config, args.toolName) ??
    buildUncapturedToolFailureReport({ config, args, description });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.internalApiToken) {
    headers.Authorization = `Bearer ${config.internalApiToken}`;
  }

  try {
    const response = await fetch(getToolFailureReportUrl(config), {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: config.workspaceId,
        appId: config.appId,
        runId: config.runId,
        sourceVersion: config.sourceVersion ?? "published",
        agentId: config.agentConfig.id,
        agentName: config.agentConfig.name,
        appName: config.appName,
        description,
        attemptedTask: args.attemptedTask,
        requestedToolName: args.toolName,
        capturedFailure,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      return {
        content: [{
          type: "text",
          text: `Failed to report the tool call failure (HTTP ${response.status}): ${text || "Request failed"}`,
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: text || JSON.stringify({ ok: true, status: "builder_repair_run_created" }),
      }],
    };
  } catch (err) {
    return {
      content: [{
        type: "text",
        text: `Failed to report the tool call failure: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }
}

type ToolExecuteResponse = {
  success: boolean;
  data?: unknown;
  mock?: boolean;
  mockReason?: string;
  error?: string;
  statusCode?: number;
  errorCode?: string;
  errorCategory?: string;
  resolution?: string;
  retryable?: boolean;
  canRequestBuilderRepair?: boolean;
  details?: Record<string, unknown>;
};

function normalizeAppToolFailureName(toolName?: string | null): string | null {
  const value = toolName?.trim();
  if (!value) return null;

  const appToolsPrefix = "mcp__app_tools__";
  if (value.startsWith(appToolsPrefix)) {
    const unprefixed = value.slice(appToolsPrefix.length).trim();
    return unprefixed || value;
  }

  const dottedPrefix = "app_tools.";
  if (value.startsWith(dottedPrefix)) {
    const unprefixed = value.slice(dottedPrefix.length).trim();
    return unprefixed || value;
  }

  return value;
}

function customToolMatchesFailureName(
  toolSpec: AgentToolSpec,
  requestedToolName: string,
): boolean {
  const normalizedRequested = normalizeAppToolFailureName(requestedToolName);
  return (
    toolSpec.name === requestedToolName ||
    toolSpec.name === normalizedRequested ||
    `mcp__app_tools__${toolSpec.name}` === requestedToolName ||
    `app_tools.${toolSpec.name}` === requestedToolName
  );
}

function findCustomToolForFailureReport(
  config: SessionConfig,
  requestedToolName?: string,
): AgentToolSpec | null {
  const normalizedRequested = normalizeAppToolFailureName(requestedToolName);
  if (!normalizedRequested) return null;

  return (
    (config.agentConfig?.tools ?? []).find(
      (toolSpec) =>
        toolSpec.type === "custom" &&
        toolSpec.enabled &&
        customToolMatchesFailureName(toolSpec, requestedToolName ?? normalizedRequested),
    ) ?? null
  );
}

function returnMockData(toolSpec: AgentToolSpec, reason: string) {
  const mockData = Array.isArray(toolSpec.mockData)
    ? toolSpec.mockData
    : toolSpec.mockData
      ? [toolSpec.mockData]
      : [];
  const entry =
    mockData.length > 0
      ? mockData[Math.floor(Math.random() * mockData.length)]
      : { message: "No data available (integration not configured)" };
  const text = [
    `Using mock data: ${reason}`,
    "",
    "The following payload is simulated and is not a live integration response:",
    formatToolData(entry),
  ].join("\n");
  return {
    content: [{ type: "text" as const, text }],
  };
}

export async function executeCustomAppTool(
  config: SessionConfig,
  toolSpec: AgentToolSpec,
  args: { input?: string },
): Promise<SecondToolTextResult> {
  const toolExecuteUrl =
    config.toolExecuteUrl ??
    `${process.env.WEB_URL ?? "http://localhost:3000"}/api/internal/tool-execute`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.internalApiToken) {
    headers["Authorization"] = `Bearer ${config.internalApiToken}`;
  }

  const parsedToolInput = parseCustomToolInput(args.input);
  let response: Response;
  try {
    response = await fetch(toolExecuteUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: config.workspaceId,
        appId: config.appId,
        runId: config.runId,
        sourceVersion: config.sourceVersion ?? "published",
        agentId: config.agentConfig?.id,
        toolName: toolSpec.name,
        toolSpec: {
          endpoint: toolSpec.endpoint,
          integration: toolSpec.integration,
          mockData: toolSpec.mockData,
        },
        toolInput: parsedToolInput,
      }),
    });
  } catch (err) {
    const reason = err instanceof Error
      ? `tool-execute endpoint was unreachable (${err.message}).`
      : "tool-execute endpoint was unreachable.";
    return returnMockData(toolSpec, reason);
  }

  const responseText = await response.text();
  let data: ToolExecuteResponse;

  try {
    data = JSON.parse(responseText) as ToolExecuteResponse;
  } catch {
    recordToolCallFailure(config, {
      toolName: toolSpec.name,
      toolDisplayName: toolSpec.displayName,
      toolDescription: toolSpec.description,
      rawInput: args.input,
      parsedInput: parsedToolInput,
      toolSpec: {
        endpoint: toolSpec.endpoint,
        integration: toolSpec.integration,
      },
      failure: {
        kind: "tool_execute_non_json_response",
        toolExecuteHttpStatus: response.status,
        error: "tool-execute returned a non-JSON response.",
        response: responseText,
      },
    });
    return {
      content: [{
        type: "text",
        text: [
          `Tool execution failed: tool-execute returned HTTP ${response.status} with a non-JSON response.`,
          "",
          "If this failure blocks the user's task, do not write placeholder failure data into app data. Complete any unaffected work, then call report_tool_call_failed with a concise description of what failed.",
        ].join("\n"),
      }],
    };
  }

  if (!data.success) {
    const errorDetail = data.error ??
      (data.statusCode ? `HTTP ${data.statusCode}` : "Unknown error");
    const responseDetail = data.data === undefined
      ? ""
      : `\n\nResponse:\n${formatToolData(data.data)}`;
    const resolutionDetail = data.resolution
      ? `\n\nSuggested next step: ${data.resolution}`
      : "";
    const diagnosticDetail = data.details === undefined
      ? ""
      : `\n\nDiagnostics:\n${formatToolData(data.details)}`;
    recordToolCallFailure(config, {
      toolName: toolSpec.name,
      toolDisplayName: toolSpec.displayName,
      toolDescription: toolSpec.description,
      rawInput: args.input,
      parsedInput: parsedToolInput,
      toolSpec: {
        endpoint: toolSpec.endpoint,
        integration: toolSpec.integration,
      },
      failure: {
        kind: "tool_execute_error",
        toolExecuteHttpStatus: response.status,
        error: errorDetail,
        ...(typeof data.statusCode === "number" ? { statusCode: data.statusCode } : {}),
        ...(typeof data.errorCode === "string" ? { errorCode: data.errorCode } : {}),
        ...(typeof data.errorCategory === "string" ? { errorCategory: data.errorCategory } : {}),
        ...(typeof data.resolution === "string" ? { resolution: data.resolution } : {}),
        ...(typeof data.retryable === "boolean" ? { retryable: data.retryable } : {}),
        ...(typeof data.canRequestBuilderRepair === "boolean"
          ? { canRequestBuilderRepair: data.canRequestBuilderRepair }
          : {}),
        ...(data.details !== undefined ? { details: data.details } : {}),
        ...(data.data !== undefined ? { response: data.data } : {}),
      },
    });
    return {
      content: [{
        type: "text",
        text: [
          `Tool execution failed: ${errorDetail}${responseDetail}`,
          resolutionDetail,
          diagnosticDetail,
          "",
          "If this failure blocks the user's task, do not write placeholder failure data into app data. Complete any unaffected work, then call report_tool_call_failed with a concise description of what failed.",
        ].join("\n"),
      }],
    };
  }

  const resultText = data.mock
    ? [
        `Using mock data: ${data.mockReason ?? "integration did not return live data."}`,
        "",
        "The following payload is simulated and is not a live integration response:",
        formatToolData(data.data),
      ].join("\n")
    : formatToolData(data.data);

  return {
    content: [{
      type: "text",
      text: resultText,
    }],
  };
}

function buildCustomToolsMcpServer(
  config: SessionConfig,
) {
  if (!config.agentConfig) return null;

  const customTools = (config.agentConfig.tools ?? []).filter(
    (t) =>
      t.type === "custom" &&
      t.enabled &&
      mcpToolIsExposed(config, "app_tools", t.name),
  );
  const includeReportTool = mcpToolIsExposed(
    config,
    "app_tools",
    APP_TOOL_FAILURE_REPORT_TOOL_NAME,
  );

  const toolDefs = [
    ...customTools.map((toolSpec) => tool(
      toolSpec.name,
      toolSpec.description ?? `Execute ${toolSpec.name}`,
      {
        input: z.string().optional().describe("Optional input parameters as JSON string"),
      },
      async (args) => executeCustomAppTool(config, toolSpec, args),
    )),
    ...(includeReportTool
      ? [
          tool(
            APP_TOOL_FAILURE_REPORT_TOOL_NAME,
            "Report a blocking failed custom integration tool call to the builder agent so it can repair agents.json, integration setup, tool arguments, or app code. Call this only after a custom app tool returned `Tool execution failed` and the failure prevents completing the user's request.",
            {
              description: z
                .string()
                .min(1)
                .max(4000)
                .describe("Plain-language explanation of what failed and why it blocks the task."),
              attemptedTask: z
                .string()
                .max(2000)
                .optional()
                .describe("The user-visible task you were trying to complete when the tool failed."),
              toolName: z
                .string()
                .max(120)
                .optional()
                .describe("Optional custom tool name if several tools failed. Prefer the generated custom tool name like `exa_search`; full MCP names like `mcp__app_tools__exa_search` are also accepted."),
            },
            async (args) => executeReportToolCallFailedTool(config, args),
          ),
        ]
      : []),
  ];

  if (toolDefs.length === 0) return null;

  return createSdkMcpServer({
    name: "app_tools",
    version: "1.0.0",
    tools: toolDefs,
  });
}

// ---------------------------------------------------------------------------
// App data writing tool — allows agents to write data to the app's database
// ---------------------------------------------------------------------------

export async function executeUpdateAppDataTool(
  config: SessionConfig,
  args: {
    collection: string;
    operation: "insert" | "update" | "upsert" | "delete";
    filter?: Record<string, unknown>;
    data?: Record<string, unknown>;
  },
): Promise<SecondToolTextResult> {
  const dataCollections = config.agentConfig?.dataCollections ?? [];
  if (!dataCollections.includes(args.collection)) {
    return {
      content: [{
        type: "text",
        text: `Access denied: agent is not allowed to write to collection "${args.collection}". Allowed: ${dataCollections.join(", ")}`,
      }],
    };
  }

  const appDataWriteUrl =
    `${process.env.WEB_URL ?? "http://localhost:3000"}/api/internal/app-data-write`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.internalApiToken) {
    headers["Authorization"] = `Bearer ${config.internalApiToken}`;
  }

  try {
    const response = await fetch(appDataWriteUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: config.workspaceId,
        appId: config.appId,
        sourceVersion: config.sourceVersion ?? "published",
        agentId: config.agentConfig?.id,
        collection: args.collection,
        operation: args.operation,
        filter: args.filter,
        data: args.data,
      }),
    });

    const result = (await response.json()) as {
      success: boolean;
      doc?: unknown;
      error?: string;
    };

    if (!result.success) {
      return {
        content: [{
          type: "text",
          text: `Failed to ${args.operation} data: ${result.error ?? "Unknown error"}`,
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, doc: result.doc }, null, 2),
      }],
    };
  } catch (err) {
    return {
      content: [{
        type: "text",
        text: `Failed to write app data: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }
}

export async function executeReadAppDataTool(
  config: SessionConfig,
  args: { collection: string; docId?: string },
): Promise<SecondToolTextResult> {
  const dataCollections = config.agentConfig?.dataCollections ?? [];
  if (!dataCollections.includes(args.collection)) {
    return {
      content: [{
        type: "text",
        text: `Access denied: agent is not allowed to read collection "${args.collection}". Allowed: ${dataCollections.join(", ")}`,
      }],
    };
  }

  const toolExecuteUrl =
    config.toolExecuteUrl ??
    `${process.env.WEB_URL ?? "http://localhost:3000"}/api/internal/tool-execute`;
  const appDataReadUrl = toolExecuteUrl.replace(
    /\/api\/internal\/tool-execute$/,
    "/api/internal/app-data-read",
  );

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.internalApiToken) {
    headers["Authorization"] = `Bearer ${config.internalApiToken}`;
  }

  try {
    const response = await fetch(appDataReadUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: config.workspaceId,
        appId: config.appId,
        sourceVersion: config.sourceVersion ?? "published",
        agentId: config.agentConfig?.id,
        collection: args.collection,
        docId: args.docId,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        content: [{
          type: "text",
          text: `Failed to read data (HTTP ${response.status}): ${text || "Request failed"}`,
        }],
      };
    }

    const result = (await response.json()) as {
      success: boolean;
      docs?: unknown[];
      doc?: unknown;
      error?: string;
    };

    if (!result.success) {
      return {
        content: [{
          type: "text",
          text: `Failed to read data: ${result.error ?? "Unknown error"}`,
        }],
      };
    }

    const data = result.doc ?? result.docs;
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data, null, 2),
      }],
    };
  } catch (err) {
    return {
      content: [{
        type: "text",
        text: `Failed to read app data: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }
}

function buildAppDataMcpServer(config: SessionConfig) {
  const dataCollections = config.agentConfig?.dataCollections;
  if (!dataCollections || dataCollections.length === 0) return null;

  const updateAppData = tool(
    "update_app_data",
    `Write data to the app's database. Allowed collections: ${dataCollections.join(", ")}.
To update a record by ID: operation="update", filter={"_id":"<the_id>"}, data={"field":"value"}.
IMPORTANT: filter MUST include "_id" for update and delete operations.`,
    {
      collection: z.string().describe("Collection name"),
      operation: z.enum(["insert", "update", "upsert", "delete"]).describe("insert | update | upsert | delete"),
      filter: z.record(z.string(), z.unknown()).optional().describe("Must include _id for update/delete. Example: {\"_id\": \"abc123\"}"),
      data: z.record(z.string(), z.unknown()).optional().describe("Fields to set"),
    },
    async (args) => executeUpdateAppDataTool(config, args),
  );

  const readAppData = tool(
    "read_app_data",
    `Read data from the app's database. Allowed collections: ${dataCollections.join(", ")}.
Pass collection name to list all docs, or also pass docId to get a single doc.`,
    {
      collection: z.string().describe("Collection name"),
      docId: z.string().optional().describe("Specific document ID to fetch. Omit to list all docs."),
    },
    async (args) => executeReadAppDataTool(config, args),
  );

  const tools = [
    updateAppData,
    readAppData,
  ].filter((toolDef) => mcpToolIsExposed(config, "app_data", toolDef.name));
  if (tools.length === 0) return null;

  return createSdkMcpServer({
    name: "app_data",
    version: "1.0.0",
    tools,
  });
}

export async function* runAgent(
  prompt: string,
  config: SessionConfig,
  resumeSessionId?: string,
  model?: string,
  effort?: string,
  thinking?: string,
  signal?: AbortSignal,
): AsyncGenerator<SDKMessage> {
  const stderrChunks: string[] = [];
  const sanitizedEnv: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: claudeSubprocessEnvScrubValue(),
  };

  for (const key of APP_SENSITIVE_ENV_VARS) {
    delete sanitizedEnv[key];
  }

  const resolvedModel = resolveClaudeModelForProvider(model ?? config.model);
  const claudeExecutable = resolveClaudeExecutable();
  if (!claudeExecutable) {
    throw new Error(
      "Claude Code CLI was not found. Install Claude Code, run `claude login`, or set SECOND_CLAUDE_PATH to the Claude executable path.",
    );
  }
  const isolationStatus = claudeSubprocessIsolationStatus();
  if (!isolationStatus.available) {
    throw new Error(
      isolationStatus.error ??
        "Claude Code subprocess isolation is not available in this worker environment.",
    );
  }

  // Build allowed tools list first. Claude's `allowedTools` auto-approves tools,
  // while `tools` and filtered MCP servers are the actual availability boundary.
  let allowedTools = config.allowedTools ??
    defaultAllowedToolsForRuntimeMode(config.runtimeMode);
  if (config.agentConfig) {
    const customToolNames = config.agentConfig.tools
      .filter((t) => t.type === "custom" && t.enabled)
      .map((t) => `mcp__app_tools__${t.name}`);
    allowedTools = [
      ...allowedTools,
      ...customToolNames,
      `mcp__app_tools__${APP_TOOL_FAILURE_REPORT_TOOL_NAME}`,
    ];

    // Add update_app_data tool if agent has data collections
    if (config.agentConfig.dataCollections?.length) {
      allowedTools = [...allowedTools, "mcp__app_data__update_app_data", "mcp__app_data__read_app_data"];
    }
  }
  allowedTools = [...new Set(allowedTools)];
  const effectiveConfig = { ...config, allowedTools };
  const builtInTools = claudeBuiltinToolsFromAllowedTools(allowedTools);

  // Build MCP servers map
  const mcpServers: Record<string, ReturnType<typeof createSdkMcpServer>> = {
    second: createSecondToolsMcpServer(effectiveConfig),
  };

  // Add custom tools MCP server if running an app agent
  const customToolsServer = buildCustomToolsMcpServer(effectiveConfig);
  if (customToolsServer) {
    mcpServers.app_tools = customToolsServer;
  }

  // Add app data writing MCP server if agent has dataCollections
  const appDataServer = buildAppDataMcpServer(effectiveConfig);
  if (appDataServer) {
    mcpServers.app_data = appDataServer;
  }

  const q = query({
    prompt,
    options: {
      ...(resolvedModel ? { model: resolvedModel } : {}),
      effort: (effort as "low" | "medium" | "high" | "max") ?? "high",
      thinking: thinking === "adaptive"
        ? { type: "adaptive" as const }
        : thinking === "enabled"
          ? { type: "enabled" as const }
          : { type: "disabled" as const },
      systemPrompt: config.systemPrompt,
      cwd: config.workingDirectory,
      settingSources: ["project"],
      tools: builtInTools,
      allowedTools,
      maxTurns: config.maxTurns,
      includePartialMessages: true,
      pathToClaudeCodeExecutable: claudeExecutable,
      mcpServers,
      env: sanitizedEnv,
      stderr: (data: string) => {
        stderrChunks.push(data);
        console.error("[claude stderr]", data);
      },
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  });

  const blockingApprovalToolUseIds = new Set<string>();
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    q.close();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const message of q) {
      if (aborted || signal?.aborted) {
        throw new Error("Agent run cancelled");
      }
      const sdkMessage = message as SDKMessage;
      collectBlockingApprovalToolUses(sdkMessage, blockingApprovalToolUseIds);
      yield sdkMessage;
      if (hasBlockingApprovalToolResult(sdkMessage, blockingApprovalToolUseIds)) {
        q.close();
        break;
      }
    }
  } catch (error) {
    if (aborted || signal?.aborted) {
      throw new Error("Agent run cancelled");
    }
    const stderr = stderrChunks.join("");
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${msg}${stderr ? `\n\nClaude stderr:\n${stderr}` : ""}`);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

function resolveClaudeModelForProvider(model: string | undefined): string | undefined {
  if (!process.env.CLAUDE_CODE_USE_BEDROCK || !model) return model;

  const normalized = model.trim();
  if (!normalized) return model;

  if (
    normalized === "claude-opus-4-6" ||
    normalized.startsWith("claude-opus-4-6-")
  ) {
    return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ||
      "us.anthropic.claude-opus-4-6-v1";
  }

  if (
    normalized === "claude-sonnet-4-6" ||
    normalized.startsWith("claude-sonnet-4-6-")
  ) {
    return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
      "us.anthropic.claude-sonnet-4-6";
  }

  if (
    normalized === "claude-haiku-4-5" ||
    normalized.startsWith("claude-haiku-4-5-")
  ) {
    return process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
      "us.anthropic.claude-haiku-4-5-20251001-v1:0";
  }

  return model;
}
