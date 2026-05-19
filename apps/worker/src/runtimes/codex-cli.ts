import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createToolBrokerSession,
  deleteToolBrokerSession,
  refreshToolBrokerSession,
  type ToolBrokerSession,
} from "../tool-broker.js";
import {
  buildRuntimeProcessEnv,
  createStableRuntimeDir,
  seedCodexAuthFromLocalLogin,
  writePrivateTextFile,
} from "./process-env.js";
import {
  CodexAppServerClient,
  runCodexAppServerRuntime,
} from "./codex-app-server.js";
import type { RuntimeAdapter, RuntimeRunInput } from "./types.js";

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexMcpServerConfig(name: string, url: string, toolTimeoutSec = 120): string {
  return [
    `[mcp_servers.${name}]`,
    `url = ${tomlString(url)}`,
    `bearer_token_env_var = "SECOND_MCP_TOKEN"`,
    `startup_timeout_sec = 10`,
    `tool_timeout_sec = ${toolTimeoutSec}`,
    "",
  ].join("\n");
}

function codexCommand(): string {
  return process.env.SECOND_CODEX_PATH?.trim() || "codex";
}

type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

function codexApiKey(): string | undefined {
  return (
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.CODEX_API_KEY?.trim() ||
    undefined
  );
}

function codexSandboxMode(value: string | undefined): CodexSandboxMode {
  if (value === "read-only" || value === "danger-full-access") return value;
  return "workspace-write";
}

function effectiveCodexSandbox(value: string | undefined): CodexSandboxMode {
  const requested = codexSandboxMode(value);
  if (process.env.NODE_ENV === "production" && requested === "workspace-write") {
    return "danger-full-access";
  }
  return requested;
}

function codexSettingsWithSandbox(
  settings: RuntimeRunInput["settings"],
  sandbox: CodexSandboxMode,
): RuntimeRunInput["settings"] {
  return {
    ...settings,
    params: {
      ...settings.params,
      sandbox,
    },
  };
}

function createCodexShellHome(sessionKey: string): string {
  const safeKey = sessionKey.replace(/[^a-zA-Z0-9_.-]/g, "-");
  const dir = join(tmpdir(), "second-runtime", "codex-cli-shell", safeKey);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const LOCAL_WARM_IDLE_MS = 10 * 60 * 1000;

type LocalWarmCodexServer = {
  client: CodexAppServerClient;
  broker: ToolBrokerSession;
  closeTimer: ReturnType<typeof setTimeout> | null;
};

const localWarmServers = new Map<string, LocalWarmCodexServer>();

function codexLocalWarmEnabled(runKey: string): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.SECOND_CODEX_APP_SERVER_WARM !== "0" &&
    !runKey.includes("__agent__")
  );
}

function localWarmKey(input: {
  command: string;
  runtimeDir: string;
  workerBaseUrl: string;
}): string {
  return `${input.command}\0${input.runtimeDir}\0${input.workerBaseUrl}`;
}

function writeCodexRuntimeConfig(input: {
  runtimeDir: string;
  model: string;
  sandbox: string | undefined;
  allowedTools?: string[];
  shellHome: string;
  workerBaseUrl: string;
  broker: ToolBrokerSession;
}) {
  const sandbox = effectiveCodexSandbox(input.sandbox);
  const webSearch = input.allowedTools &&
    !input.allowedTools.includes("WebSearch") &&
    !input.allowedTools.includes("WebFetch")
    ? "disabled"
    : "live";
  const mcpUrl = (server: string) =>
    `${input.workerBaseUrl}/mcp/${input.broker.id}?server=${encodeURIComponent(server)}`;
  writePrivateTextFile(
    input.runtimeDir,
    "config.toml",
    [
      `model = ${tomlString(input.model)}`,
      `model_reasoning_summary = "auto"`,
      `web_search = ${tomlString(webSearch)}`,
      `approval_policy = "never"`,
      `sandbox_mode = ${tomlString(sandbox)}`,
      "",
      `[shell_environment_policy]`,
      `inherit = "core"`,
      `ignore_default_excludes = false`,
      `experimental_use_profile = false`,
      `include_only = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "LC_*", "TERM"]`,
      `exclude = ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_HOME", "SECOND_MCP_TOKEN", "*TOKEN*", "*SECRET*", "*KEY*", "AUTHORIZATION", "COOKIE"]`,
      "",
      `[shell_environment_policy.set]`,
      `HOME = ${tomlString(input.shellHome)}`,
      "",
      codexMcpServerConfig("second", mcpUrl("second")),
      codexMcpServerConfig("app_tools", mcpUrl("app_tools")),
      codexMcpServerConfig("app_data", mcpUrl("app_data")),
    ].join("\n"),
  );
}

function codexRuntimeEnv(runtimeDir: string, broker: ToolBrokerSession): Record<string, string> {
  return buildRuntimeProcessEnv({
    runtimeId: "codex-cli",
    extraEnv: {
      HOME: runtimeDir,
      CODEX_HOME: runtimeDir,
      SECOND_MCP_TOKEN: broker.token,
    },
  });
}

function prepareCodexRuntimeDir(runtimeDir: string) {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  seedCodexAuthFromLocalLogin(runtimeDir);
}

function scheduleWarmClose(key: string, entry: LocalWarmCodexServer) {
  if (entry.closeTimer) clearTimeout(entry.closeTimer);
  entry.closeTimer = setTimeout(() => {
    if (localWarmServers.get(key) === entry) entry.client.close();
  }, LOCAL_WARM_IDLE_MS);
}

function getLocalWarmServer(input: {
  command: string;
  runtimeDir: string;
  workerBaseUrl: string;
  runInput: RuntimeRunInput;
}): LocalWarmCodexServer {
  const key = localWarmKey(input);
  const existing = localWarmServers.get(key);
  if (existing && !existing.client.isClosed) {
    if (existing.closeTimer) {
      clearTimeout(existing.closeTimer);
      existing.closeTimer = null;
    }
    const refreshed = refreshToolBrokerSession(existing.broker.id, {
      config: input.runInput.config,
      allowedTools: input.runInput.config.allowedTools,
    });
    if (refreshed) return existing;
    existing.client.close();
    localWarmServers.delete(key);
  }

  const broker = createToolBrokerSession({
    runtimeId: "codex-cli",
    config: input.runInput.config,
    allowedTools: input.runInput.config.allowedTools,
  });
  prepareCodexRuntimeDir(input.runtimeDir);
  writeCodexRuntimeConfig({
    runtimeDir: input.runtimeDir,
    model: input.runInput.settings.model,
    sandbox: input.runInput.settings.params.sandbox,
    allowedTools: input.runInput.config.allowedTools,
    shellHome: createCodexShellHome(input.runInput.config.runtimeSessionKey ?? input.runInput.config.appId ?? "builder"),
    workerBaseUrl: input.workerBaseUrl,
    broker,
  });

  let entry: LocalWarmCodexServer;
  const client = new CodexAppServerClient({
    command: input.command,
    cwd: input.runInput.config.workingDirectory,
    env: codexRuntimeEnv(input.runtimeDir, broker),
    apiKey: codexApiKey(),
    onClose: () => {
      if (entry.closeTimer) clearTimeout(entry.closeTimer);
      deleteToolBrokerSession(broker.id);
      if (localWarmServers.get(key) === entry) localWarmServers.delete(key);
    },
  });
  entry = { client, broker, closeTimer: null };
  localWarmServers.set(key, entry);
  void client.prewarm().catch(() => client.close());
  return entry;
}

export const codexCliRuntimeAdapter: RuntimeAdapter = {
  id: "codex-cli",
  async prewarm(input) {
    const command = codexCommand();
    const runKey = input.config.runtimeSessionKey ?? input.config.appId ?? "builder";
    if (!codexLocalWarmEnabled(runKey)) return;
    const runtimeDir = createStableRuntimeDir("codex-cli", runKey);
    const workerBaseUrl = input.workerBaseUrl ?? "http://127.0.0.1:3001";
    const entry = getLocalWarmServer({
      command,
      runtimeDir,
      workerBaseUrl,
      runInput: input,
    });
    await entry.client.prewarm();
  },
  async *run(input) {
    const command = codexCommand();
    const runKey = input.config.runtimeSessionKey ?? input.config.appId ?? "builder";
    const runtimeDir = createStableRuntimeDir("codex-cli", runKey);
    const workerBaseUrl = input.workerBaseUrl ?? "http://127.0.0.1:3001";

    if (codexLocalWarmEnabled(runKey)) {
      const entry = getLocalWarmServer({
        command,
        runtimeDir,
        workerBaseUrl,
        runInput: input,
      });
      try {
        for await (const message of entry.client.runTurn({
          command,
          cwd: input.config.workingDirectory,
          env: codexRuntimeEnv(runtimeDir, entry.broker),
          settings: input.settings,
          systemPrompt: input.config.systemPrompt,
          prompt: input.prompt,
          allowedTools: input.config.allowedTools,
          sessionState: input.sessionState,
          signal: input.signal,
        })) {
          yield message;
        }
      } finally {
        if (!entry.client.isClosed && localWarmServers.get(localWarmKey({
          command,
          runtimeDir,
          workerBaseUrl,
        })) === entry) {
          scheduleWarmClose(localWarmKey({ command, runtimeDir, workerBaseUrl }), entry);
        }
      }
      return;
    }

    const broker = createToolBrokerSession({
      runtimeId: "codex-cli",
      config: input.config,
      allowedTools: input.config.allowedTools,
    });

    try {
      prepareCodexRuntimeDir(runtimeDir);
      writeCodexRuntimeConfig({
        runtimeDir,
        model: input.settings.model,
        sandbox: input.settings.params.sandbox,
        allowedTools: input.config.allowedTools,
        shellHome: createCodexShellHome(runKey),
        workerBaseUrl,
        broker,
      });
      const sandbox = effectiveCodexSandbox(input.settings.params.sandbox);
      const settings = codexSettingsWithSandbox(input.settings, sandbox);

      for await (const message of runCodexAppServerRuntime({
        command,
        cwd: input.config.workingDirectory,
        env: codexRuntimeEnv(runtimeDir, broker),
        apiKey: codexApiKey(),
        settings,
        systemPrompt: input.config.systemPrompt,
        prompt: input.prompt,
        allowedTools: input.config.allowedTools,
        sessionState: input.sessionState,
        signal: input.signal,
      })) {
        yield message;
      }
    } finally {
      deleteToolBrokerSession(broker.id);
    }
  },
};
