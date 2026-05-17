import { execFileSync } from "node:child_process";
import { createToolBrokerSession, deleteToolBrokerSession } from "../tool-broker.js";
import {
  buildRuntimeProcessEnv,
  createStableRuntimeDir,
  openCodeAuthEnvKeysForModel,
  writePrivateJsonFile,
} from "./process-env.js";
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

function opencodeCommand(): string {
  return process.env.SECOND_OPENCODE_PATH?.trim() || "opencode";
}

function opencodeRunSupportsJsonFormat(command: string): boolean {
  try {
    const help = execFileSync(command, ["run", "--help"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return help.includes("--format");
  } catch {
    return false;
  }
}

export const openCodeRuntimeAdapter: RuntimeAdapter = {
  id: "opencode",
  async *run(input) {
    const command = opencodeCommand();
    if (!opencodeRunSupportsJsonFormat(command)) {
      throw new Error(
        "Installed OpenCode CLI does not support `opencode run --format json`. Upgrade OpenCode before using the OpenCode runtime.",
      );
    }

    const runKey = input.config.runtimeSessionKey ?? input.config.appId ?? "builder";
    const runtimeDir = createStableRuntimeDir("opencode", runKey);
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
            tools: {
              write: toolAllowed(allowedTools, "Write"),
              edit: toolAllowed(allowedTools, "Edit"),
              read: toolAllowed(allowedTools, "Read"),
              grep: toolAllowed(allowedTools, "Grep"),
              glob: toolAllowed(allowedTools, "Glob"),
              bash: toolAllowed(allowedTools, "Bash"),
              webfetch: toolAllowed(allowedTools, "WebFetch"),
              websearch: toolAllowed(allowedTools, "WebSearch"),
              second: toolNamespaceAllowed(allowedTools, "second"),
              app_tools: toolNamespaceAllowed(allowedTools, "app_tools"),
              app_data: toolNamespaceAllowed(allowedTools, "app_data"),
            },
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
      const args = [
        "run",
        "--format",
        "json",
        "--model",
        input.settings.model,
        "--agent",
        "second-builder",
        ...(resumeSessionId ? ["--session", resumeSessionId] : []),
        input.prompt,
      ];

      for await (const message of runJsonlCliRuntime({
        runtimeId: "opencode",
        command,
        args,
        cwd: input.config.workingDirectory,
        env,
        settings: input.settings,
        sessionState: input.sessionState,
      })) {
        yield message;
      }
    } finally {
      deleteToolBrokerSession(broker.id);
    }
  },
};
