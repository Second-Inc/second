import { randomUUID } from "node:crypto";
import {
  APP_TOOL_FAILURE_REPORT_TOOL_NAME,
  executeCustomAppTool,
  executeDoneBuildingTool,
  executeListAppIntegrationKeysTool,
  executePresentAgentsTool,
  executePresentIntegrationSetupTool,
  executePresentPlanTool,
  executePresentSuggestionsTool,
  executeReadAppDataTool,
  executeReportToolCallFailedTool,
  executeSetAppMetadataTool,
  executeSetOnboardingContextTool,
  executeUpdateAppDataTool,
  type AgentToolSpec,
  type SecondToolTextResult,
  type SessionConfig,
} from "./runner.js";
import { createScopedToken } from "./runtimes/process-env.js";
import type { AgentRuntimeId } from "./runtimes/types.js";

type ToolBrokerServerName = "second" | "app_tools" | "app_data";

export type ToolBrokerSession = {
  id: string;
  token: string;
  runtimeId: AgentRuntimeId;
  config: SessionConfig;
  expiresAt: number;
  allowedTools?: string[];
};

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, ToolBrokerSession>();

function jsonRpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

export function createToolBrokerSession(input: {
  runtimeId: AgentRuntimeId;
  config: SessionConfig;
  allowedTools?: string[];
}): ToolBrokerSession {
  pruneExpiredSessions();
  const session: ToolBrokerSession = {
    id: randomUUID(),
    token: createScopedToken(),
    runtimeId: input.runtimeId,
    config: input.config,
    allowedTools: input.allowedTools,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(session.id, session);
  return session;
}

export function refreshToolBrokerSession(
  sessionId: string,
  input: {
    config: SessionConfig;
    allowedTools?: string[];
  },
): ToolBrokerSession | null {
  pruneExpiredSessions();
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.config = input.config;
  session.allowedTools = input.allowedTools;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

export function deleteToolBrokerSession(sessionId: string): void {
  sessions.delete(sessionId);
}

function requireSession(sessionId: string, bearerToken: string | null): ToolBrokerSession {
  pruneExpiredSessions();
  const session = sessions.get(sessionId);
  if (!session) throw new Error("unknown_or_expired_tool_broker_session");
  if (!bearerToken || bearerToken !== session.token) {
    throw new Error("invalid_tool_broker_token");
  }
  return session;
}

function canonicalToolName(serverName: ToolBrokerServerName, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

function assertAllowed(
  session: ToolBrokerSession,
  serverName: ToolBrokerServerName,
  toolName: string,
): void {
  if (!session.allowedTools) return;
  const canonical = canonicalToolName(serverName, toolName);
  if (session.allowedTools.includes(canonical)) return;
  throw new Error("tool_not_allowed_for_session");
}

const stringSchema = { type: "string" };

const secondTools: McpTool[] = [
  {
    name: "present_plan",
    description:
      "Present a structured build plan to the user for approval before writing any code, then stop and wait for approval in a later user message.",
    inputSchema: {
      type: "object",
      required: ["overview", "features", "dataFlow"],
      properties: {
        overview: stringSchema,
        features: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "description"],
            properties: { name: stringSchema, description: stringSchema },
          },
        },
        dataFlow: stringSchema,
        agents: { anyOf: [stringSchema, { type: "null" }] },
        backend: { anyOf: [stringSchema, { type: "null" }] },
      },
    },
  },
  {
    name: "list_app_integration_keys",
    description:
      "List only this app's app-scoped static/OAuth integration grants without secret values.",
    inputSchema: {
      type: "object",
      properties: { domain: stringSchema },
    },
  },
  {
    name: "present_suggestions",
    description:
      "Present 2 to 6 clickable app suggestion cards, then stop and wait for the user to choose one in a later message.",
    inputSchema: {
      type: "object",
      required: ["suggestions"],
      properties: {
        suggestions: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            required: ["emoji", "title", "subtitle"],
            properties: {
              emoji: {
                type: "string",
                description: "Single emoji that visually represents this suggestion.",
              },
              title: stringSchema,
              subtitle: stringSchema,
            },
          },
        },
      },
    },
  },
  {
    name: "present_agents",
    description:
      "Present agents.json to the user for approval, then stop and wait for approval in a later user message.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "present_integration_setup",
    description:
      "Present app-scoped integration setup instructions and sync app requirements.",
    inputSchema: {
      type: "object",
      required: ["integrations"],
      properties: {
        integrations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: stringSchema,
              domain: stringSchema,
              keySlug: stringSchema,
              keyName: stringSchema,
              capabilityLabel: stringSchema,
            },
          },
        },
      },
    },
  },
  {
    name: "done_building",
    description:
      "Signal that the app is ready to preview. Runs build checks and prepares persisted source artifacts.",
    inputSchema: {
      type: "object",
      required: ["summary"],
      properties: { summary: stringSchema },
    },
  },
  {
    name: "set_app_metadata",
    description:
      "Set the generated app name and app description. Use this exactly once when asked to generate app metadata.",
    inputSchema: {
      type: "object",
      required: ["name", "description"],
      properties: {
        name: stringSchema,
        description: stringSchema,
      },
    },
  },
  {
    name: "set_onboarding_context",
    description:
      "Save concise company context and current-user context gathered during onboarding, then stop and wait for user review.",
    inputSchema: {
      type: "object",
      required: ["companyContext", "userContext"],
      properties: {
        companyContext: stringSchema,
        userContext: stringSchema,
      },
    },
  },
];

function appTools(config: SessionConfig): McpTool[] {
  if (!config.agentConfig) return [];

  const customTools = (config.agentConfig.tools ?? [])
    .filter((tool) => tool.type === "custom" && tool.enabled)
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? `Execute ${tool.name}`,
      inputSchema: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "Optional input parameters as a JSON string.",
          },
        },
      },
    }));

  return [
    ...customTools,
    {
      name: APP_TOOL_FAILURE_REPORT_TOOL_NAME,
      description:
        "Report a blocking failed custom integration tool call to the builder agent so it can repair agents.json, integration setup, tool arguments, or app code.",
      inputSchema: {
        type: "object",
        required: ["description"],
        properties: {
          description: {
            type: "string",
            description: "Plain-language explanation of what failed and why it blocks the task.",
          },
          attemptedTask: {
            type: "string",
            description: "The user-visible task you were trying to complete when the tool failed.",
          },
          toolName: {
            type: "string",
            description:
              "Optional custom tool name if several tools failed. Prefer the generated custom tool name like `exa_search`; full MCP names like `mcp__app_tools__exa_search` are also accepted.",
          },
        },
      },
    },
  ];
}

function appDataTools(config: SessionConfig): McpTool[] {
  const dataCollections = config.agentConfig?.dataCollections ?? [];
  if (dataCollections.length === 0) return [];
  return [
    {
      name: "update_app_data",
      description: `Write data to the app database. Allowed collections: ${dataCollections.join(", ")}.`,
      inputSchema: {
        type: "object",
        required: ["collection", "operation"],
        properties: {
          collection: stringSchema,
          operation: { type: "string", enum: ["insert", "update", "upsert", "delete"] },
          filter: { type: "object" },
          data: { type: "object" },
        },
      },
    },
    {
      name: "read_app_data",
      description: `Read app database documents. Allowed collections: ${dataCollections.join(", ")}.`,
      inputSchema: {
        type: "object",
        required: ["collection"],
        properties: { collection: stringSchema, docId: stringSchema },
      },
    },
  ];
}

function listTools(
  session: ToolBrokerSession,
  serverName: ToolBrokerServerName,
): McpTool[] {
  const tools =
    serverName === "second"
      ? secondTools
      : serverName === "app_tools"
        ? appTools(session.config)
        : appDataTools(session.config);

  if (!session.allowedTools) return tools;
  return tools.filter((tool) =>
    session.allowedTools?.includes(canonicalToolName(serverName, tool.name)),
  );
}

function findCustomTool(config: SessionConfig, name: string): AgentToolSpec | null {
  return (config.agentConfig?.tools ?? []).find(
    (tool) => tool.type === "custom" && tool.enabled && tool.name === name,
  ) ?? null;
}

async function callTool(
  session: ToolBrokerSession,
  serverName: ToolBrokerServerName,
  toolName: string,
  args: Record<string, unknown>,
): Promise<SecondToolTextResult> {
  assertAllowed(session, serverName, toolName);

  if (serverName === "second") {
    if (toolName === "present_plan") {
      return executePresentPlanTool({
        overview: String(args.overview ?? ""),
        features: Array.isArray(args.features)
          ? (args.features as Array<{ name: string; description: string }>)
          : [],
        dataFlow: String(args.dataFlow ?? ""),
        agents: typeof args.agents === "string" ? args.agents : null,
        backend: typeof args.backend === "string" ? args.backend : null,
      });
    }
    if (toolName === "list_app_integration_keys") {
      return executeListAppIntegrationKeysTool(session.config, {
        domain: typeof args.domain === "string" ? args.domain : undefined,
      });
    }
    if (toolName === "present_suggestions") {
      return executePresentSuggestionsTool({
        suggestions: Array.isArray(args.suggestions)
          ? (args.suggestions as Array<{ emoji: string; title: string; subtitle: string }>)
          : [],
      });
    }
    if (toolName === "present_agents") {
      return executePresentAgentsTool(session.config);
    }
    if (toolName === "present_integration_setup") {
      return executePresentIntegrationSetupTool(session.config, {
        integrations: Array.isArray(args.integrations)
          ? (args.integrations as Array<{ name: string }>)
          : [],
      });
    }
    if (toolName === "done_building") {
      return executeDoneBuildingTool(session.config.workingDirectory, {
        summary: String(args.summary ?? ""),
      });
    }
    if (toolName === "set_app_metadata") {
      return executeSetAppMetadataTool(session.config, {
        name: String(args.name ?? ""),
        description: String(args.description ?? ""),
      });
    }
    if (toolName === "set_onboarding_context") {
      return executeSetOnboardingContextTool(session.config, {
        companyContext: String(args.companyContext ?? ""),
        userContext: String(args.userContext ?? ""),
      });
    }
  }

  if (serverName === "app_tools") {
    if (toolName === APP_TOOL_FAILURE_REPORT_TOOL_NAME) {
      return executeReportToolCallFailedTool(session.config, {
        description: String(args.description ?? ""),
        attemptedTask: typeof args.attemptedTask === "string"
          ? args.attemptedTask
          : undefined,
        toolName: typeof args.toolName === "string" ? args.toolName : undefined,
      });
    }
    const toolSpec = findCustomTool(session.config, toolName);
    if (!toolSpec) throw new Error("unknown_custom_tool");
    return executeCustomAppTool(session.config, toolSpec, {
      input: typeof args.input === "string" ? args.input : undefined,
    });
  }

  if (serverName === "app_data") {
    if (toolName === "update_app_data") {
      return executeUpdateAppDataTool(session.config, {
        collection: String(args.collection ?? ""),
        operation: String(args.operation ?? "insert") as "insert" | "update" | "upsert" | "delete",
        filter: asRecord(args.filter),
        data: asRecord(args.data),
      });
    }
    if (toolName === "read_app_data") {
      return executeReadAppDataTool(session.config, {
        collection: String(args.collection ?? ""),
        docId: typeof args.docId === "string" ? args.docId : undefined,
      });
    }
  }

  throw new Error("unknown_tool");
}

function normalizeServerName(value: string | null): ToolBrokerServerName {
  if (value === "app_tools" || value === "app_data") return value;
  return "second";
}

export async function handleMcpJsonRpc(input: {
  sessionId: string;
  serverName: string | null;
  bearerToken: string | null;
  payload: JsonRpcRequest | JsonRpcRequest[];
}): Promise<unknown> {
  const serverName = normalizeServerName(input.serverName);
  const requests = Array.isArray(input.payload) ? input.payload : [input.payload];
  const responses: unknown[] = [];

  for (const request of requests) {
    const id = request.id ?? null;
    try {
      const session = requireSession(input.sessionId, input.bearerToken);
      if (request.method === "initialize") {
        responses.push(jsonRpcResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: serverName, version: "1.0.0" },
        }));
        continue;
      }
      if (request.method === "notifications/initialized") {
        if (request.id !== undefined) responses.push(jsonRpcResult(id, {}));
        continue;
      }
      if (request.method === "tools/list") {
        responses.push(jsonRpcResult(id, { tools: listTools(session, serverName) }));
        continue;
      }
      if (request.method === "tools/call") {
        const params = asRecord(request.params);
        const toolName = String(params.name ?? "");
        const args = asRecord(params.arguments);
        const result = await callTool(session, serverName, toolName, args);
        responses.push(jsonRpcResult(id, result));
        continue;
      }
      responses.push(jsonRpcError(id, -32601, "method_not_found"));
    } catch (error) {
      responses.push(jsonRpcError(
        id,
        -32000,
        error instanceof Error ? error.message : "tool_broker_error",
      ));
    }
  }

  return Array.isArray(input.payload) ? responses : responses[0];
}
