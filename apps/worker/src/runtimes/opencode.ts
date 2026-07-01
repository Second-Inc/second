import { join } from "node:path";
import { createToolBrokerSession, deleteToolBrokerSession } from "../tool-broker.js";
import {
  buildRuntimeProcessEnv,
  createStableRuntimeDir,
  openCodeAuthEnvConfiguredForModel,
  openCodeAuthEnvKeysForModel,
  readOpenCodeProviderConfig,
  seedOpenCodeAuthFromLocalLogin,
  writePrivateJsonFile,
} from "./process-env.js";
import { runtimeBinary } from "./runtime-binary.js";
import { detectOpenCodeRunJsonSupport } from "./opencode-cli.js";
import {
  buildOpenCodeRunArgs,
  resolveOpenCodeVariant,
} from "./opencode-models.js";
import { runJsonlCliRuntime } from "./cli-events.js";
import type { RuntimeAdapter } from "./types.js";

function toolAllowed(allowedTools: string[] | undefined, toolName: string): boolean {
  if (!allowedTools) return true;
  return allowedTools.includes(toolName);
}

function toolNamespaceAllowed(
  allowedTools: string[] | undefined,
  namespace: string,
): boolean {
  if (!allowedTools) return true;
  return allowedTools.some((toolName) => toolName.startsWith(`mcp__${namespace}__`));
}

export function buildOpenCodeToolConfig(allowedTools: string[] | undefined) {
  return {
    write: toolAllowed(allowedTools, "Write"),
    edit: toolAllowed(allowedTools, "Edit"),
    read: toolAllowed(allowedTools, "Read"),
    grep: toolAllowed(allowedTools, "Grep"),
    glob: toolAllowed(allowedTools, "Glob"),
    bash: toolAllowed(allowedTools, "Bash"),
    webfetch: toolAllowed(allowedTools, "WebFetch"),
    websearch: toolAllowed(allowedTools, "WebSearch"),
    task: toolAllowed(allowedTools, "Task"),
    todowrite: toolAllowed(allowedTools, "TodoWrite"),
    skill: toolAllowed(allowedTools, "Skill"),
    apply_patch: toolAllowed(allowedTools, "Edit"),
    second: toolNamespaceAllowed(allowedTools, "second"),
    app_tools: toolNamespaceAllowed(allowedTools, "app_tools"),
    app_data: toolNamespaceAllowed(allowedTools, "app_data"),
  };
}

function opencodeCommand(): string {
  return runtimeBinary("SECOND_OPENCODE_PATH", "opencode");
}

export const openCodeRuntimeAdapter: RuntimeAdapter = {
  id: "opencode",
  async *run(input) {
    const command = opencodeCommand();
    const jsonSupport = detectOpenCodeRunJsonSupport(command);
    if (!jsonSupport.supported && jsonSupport.definitive) {
      throw new Error(jsonSupport.message);
    }

    const runKey = input.config.runtimeSessionKey ?? input.config.appId ?? "builder";
    const runtimeDir = createStableRuntimeDir("opencode", runKey);
    if (!openCodeAuthEnvConfiguredForModel(input.settings.model)) {
      seedOpenCodeAuthFromLocalLogin(runtimeDir);
    }
    const broker = createToolBrokerSession({
      runtimeId: "opencode",
      config: input.config,
      allowedTools: input.config.allowedTools,
    });
    const workerBaseUrl = input.workerBaseUrl ?? "http://127.0.0.1:3001";
    const mcpUrl = (server: string) =>
      `${workerBaseUrl}/mcp/${broker.id}?server=${encodeURIComponent(server)}`;

    try {
      const allowedTools = input.config.allowedTools;
      const openCodeConfig = {
        $schema: "https://opencode.ai/config.json",
        ...readOpenCodeProviderConfig(),
        model: input.settings.model,
        mcp: {
          second: {
            type: "remote",
            url: mcpUrl("second"),
            headers: { Authorization: `Bearer ${broker.token}` },
          },
          app_tools: {
            type: "remote",
            url: mcpUrl("app_tools"),
            headers: { Authorization: `Bearer ${broker.token}` },
          },
          app_data: {
            type: "remote",
            url: mcpUrl("app_data"),
            headers: { Authorization: `Bearer ${broker.token}` },
          },
        },
        agent: {
          "second-builder": {
            prompt: input.config.systemPrompt,
            tools: buildOpenCodeToolConfig(allowedTools),
          },
        },
        permission: {
          question: "deny",
          external_directory: "deny",
        },
      };
      const configPath = writePrivateJsonFile(runtimeDir, "opencode.json", openCodeConfig);

      const env = buildRuntimeProcessEnv({
        runtimeId: "opencode",
        authEnvKeys: openCodeAuthEnvKeysForModel(input.settings.model),
        extraEnv: {
          HOME: runtimeDir,
          XDG_CONFIG_HOME: runtimeDir,
          XDG_DATA_HOME: join(runtimeDir, ".local", "share"),
          OPENCODE_CONFIG: configPath,
          OPENCODE_CONFIG_DIR: runtimeDir,
          OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig),
          SECOND_MCP_TOKEN: broker.token,
        },
      });

      const resumeSessionId =
        input.sessionState?.runtimeId === "opencode"
          ? input.sessionState.sessionId
          : null;
      const variant = resolveOpenCodeVariant({
        command,
        model: input.settings.model,
        requested: input.settings.params.variant,
      });
      const args = buildOpenCodeRunArgs({
        model: input.settings.model,
        agent: "second-builder",
        sessionId: resumeSessionId,
        prompt: input.prompt,
        variant,
      });

      for await (const message of runJsonlCliRuntime({
        runtimeId: "opencode",
        command,
        args,
        cwd: input.config.workingDirectory,
        env,
        settings: input.settings,
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
