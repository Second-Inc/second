import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  APP_TOOL_FAILURE_REPORT_TOOL_NAME,
  type AgentConfig,
  type SDKMessage,
  type SessionConfig,
} from "./runner.js";
import {
  runRuntimeAgent,
  normalizeRuntimeSettings,
  type AgentRuntimeSettings,
} from "./runtimes/index.js";

export type AgentRunConfig = {
  runId: string;
  prompt: string;
  systemPrompt: string;
  agentConfig: AgentConfig;
  allowedTools: string[];
  runtimeSettings: AgentRuntimeSettings;
  workspaceId: string;
  appId: string;
  sourceVersion: "draft" | "published";
  sourceFiles?: Record<string, string>;
  callbackUrl: string;
  internalApiToken?: string;
  workingDirectory: string;
};

type AgentRunState = {
  runId: string;
  status: "running" | "completed" | "failed";
  messages: SDKMessage[];
  emitter: EventEmitter;
  result: unknown;
  usage: AppAgentRunUsage | null;
};

const MAX_RUNS = 100;
const RUN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const COMPLETION_CALLBACK_ATTEMPTS = 5;
const COMPLETION_CALLBACK_TIMEOUT_MS = 15_000;
const COMPLETION_CALLBACK_RETRY_DELAYS_MS = [500, 1_500, 5_000, 15_000];

type AppAgentRunUsage = {
  totalCostUsd: number;
  modelUsage: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUsd: number;
    }
  >;
};

function finiteUsageNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function normalizeAppAgentRunUsage(message: SDKMessage): AppAgentRunUsage {
  const modelUsage: AppAgentRunUsage["modelUsage"] = {};
  const rawModelUsage =
    message.modelUsage &&
    typeof message.modelUsage === "object" &&
    !Array.isArray(message.modelUsage)
      ? (message.modelUsage as Record<string, Record<string, unknown>>)
      : {};

  let modelCostTotal = 0;
  for (const [model, usage] of Object.entries(rawModelUsage)) {
    if (!model || !usage || typeof usage !== "object") continue;
    const costUsd = finiteUsageNumber(usage.costUsd ?? usage.costUSD);
    modelCostTotal += costUsd;
    modelUsage[model] = {
      inputTokens: finiteUsageNumber(usage.inputTokens),
      outputTokens: finiteUsageNumber(usage.outputTokens),
      cacheReadInputTokens: finiteUsageNumber(usage.cacheReadInputTokens),
      cacheCreationInputTokens: finiteUsageNumber(
        usage.cacheCreationInputTokens,
      ),
      costUsd,
    };
  }

  return {
    totalCostUsd: finiteUsageNumber(message.total_cost_usd) || modelCostTotal,
    modelUsage,
  };
}

function cleanupAppAgentWorkspace(workingDirectory: string): void {
  const workspaceRoot = resolve(
    process.env.WORKSPACES_DIR ?? "/tmp/second-workspaces",
  );
  const target = resolve(workingDirectory);
  const isDisposableAgentWorkspace =
    target.startsWith(`${workspaceRoot}${sep}`) && target.includes("__agent__");

  if (!isDisposableAgentWorkspace) return;

  try {
    rmSync(target, { recursive: true, force: true });
    console.log(`[agent-run-manager] Cleaned workspace ${target}`);
  } catch (err) {
    console.warn(
      `[agent-run-manager] Failed to clean workspace ${target}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AgentRunManager {
  private runs = new Map<string, AgentRunState>();

  start(config: AgentRunConfig): void {
    const state: AgentRunState = {
      runId: config.runId,
      status: "running",
      messages: [],
      emitter: new EventEmitter(),
      result: null,
      usage: null,
    };

    state.emitter.setMaxListeners(20);
    this.runs.set(config.runId, state);
    this.evictOldRuns();

    // Run agent in background — fire and forget
    this.executeAgent(config, state).catch((err) => {
      console.error(`[agent-run-manager] Unhandled error for ${config.runId}:`, err);
    });
  }

  /**
   * Subscribe to live events for a run. Yields buffered messages first,
   * then live messages as they arrive. Returns when the run finishes.
   */
  async *events(runId: string): AsyncGenerator<SDKMessage> {
    const state = this.runs.get(runId);
    if (!state) return;

    // Yield buffered messages first
    let cursor = 0;
    for (const msg of state.messages) {
      yield msg;
      cursor++;
    }

    if (state.status !== "running") return;

    // Subscribe to live messages
    const queue: SDKMessage[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const onMessage = (msg: SDKMessage) => {
      queue.push(msg);
      resolve?.();
    };
    const onDone = () => {
      done = true;
      resolve?.();
    };

    state.emitter.on("message", onMessage);
    state.emitter.on("done", onDone);

    try {
      while (!done) {
        if (queue.length > 0) {
          while (queue.length > 0) {
            yield queue.shift()!;
          }
        } else {
          await new Promise<void>((r) => {
            resolve = r;
          });
          resolve = null;
        }
      }
      // Drain any remaining
      while (queue.length > 0) {
        yield queue.shift()!;
      }
    } finally {
      state.emitter.off("message", onMessage);
      state.emitter.off("done", onDone);
    }
  }

  getStatus(runId: string): "running" | "completed" | "failed" | null {
    return this.runs.get(runId)?.status ?? null;
  }

  private async executeAgent(
    config: AgentRunConfig,
    state: AgentRunState,
  ): Promise<void> {
    const allowedTools = [
      ...config.allowedTools,
      ...config.agentConfig.tools
        .filter((tool) => tool.type === "custom" && tool.enabled)
        .map((tool) => `mcp__app_tools__${tool.name}`),
      `mcp__app_tools__${APP_TOOL_FAILURE_REPORT_TOOL_NAME}`,
      ...(config.agentConfig.dataCollections?.length
        ? ["mcp__app_data__update_app_data", "mcp__app_data__read_app_data"]
        : []),
    ];
    const sessionConfig: SessionConfig = {
      systemPrompt: config.systemPrompt,
      workingDirectory: config.workingDirectory,
      allowedTools,
      maxTurns: 50,
      agentConfig: config.agentConfig,
      toolExecuteUrl: process.env.TOOL_EXECUTE_URL,
      internalApiToken: config.internalApiToken ?? process.env.INTERNAL_API_TOKEN,
      workspaceId: config.workspaceId,
      appId: config.appId,
      runId: config.runId,
      sourceVersion: config.sourceVersion,
      runtimeSessionKey: `${config.appId}__agent__${config.runId}`,
      toolFailureContext: { failures: [] },
    };

    let resultText: string | null = null;
    let usage: AppAgentRunUsage | null = null;

    try {
      const runtimeSettings = normalizeRuntimeSettings(config.runtimeSettings);
      for await (const msg of runRuntimeAgent({
        prompt: config.prompt,
        config: sessionConfig,
        settings: runtimeSettings,
        workerBaseUrl: process.env.WORKER_URL,
      })) {
        state.messages.push(msg);
        state.emitter.emit("message", msg);

        // Capture result and usage
        if (msg.type === "result") {
          usage = normalizeAppAgentRunUsage(msg);
        }
        if (msg.type === "assistant") {
          const message = msg.message as Record<string, unknown> | undefined;
          const content = Array.isArray(message?.content)
            ? (message.content as Array<Record<string, unknown>>)
            : [];
          for (const block of content) {
            if (block.type === "text" && typeof block.text === "string") {
              resultText = block.text;
            }
          }
        }
      }

      state.status = "completed";
      state.result = resultText;
      state.usage = usage;
    } catch (err) {
      console.error(`[agent-run-manager] Agent run ${config.runId} failed:`, err);
      state.status = "failed";
      state.result = { error: err instanceof Error ? err.message : String(err) };
    } finally {
      state.emitter.emit("done");
    }

    await this.postCompletionCallback(config, state);

    cleanupAppAgentWorkspace(config.workingDirectory);

    // Schedule cleanup
    setTimeout(() => {
      this.runs.delete(config.runId);
    }, RUN_TTL_MS);
  }

  private async postCompletionCallback(
    config: AgentRunConfig,
    state: AgentRunState,
  ): Promise<void> {
    for (let attempt = 1; attempt <= COMPLETION_CALLBACK_ATTEMPTS; attempt++) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const token = config.internalApiToken ?? process.env.INTERNAL_API_TOKEN;
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          COMPLETION_CALLBACK_TIMEOUT_MS,
        );

        try {
          const response = await fetch(config.callbackUrl, {
            method: "POST",
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              runId: config.runId,
              status: state.status,
              result: state.result,
              usage: state.usage,
              messages: state.messages,
            }),
          });

          if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(
              `HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`,
            );
          }

          if (attempt > 1) {
            console.info(
              `[agent-run-manager] Completion callback succeeded for ${config.runId} after ${attempt} attempts`,
            );
          }
          return;
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        console.error(
          `[agent-run-manager] Completion callback failed for ${config.runId} attempt ${attempt}/${COMPLETION_CALLBACK_ATTEMPTS}: ${errorMessage(err)}`,
        );
        if (attempt >= COMPLETION_CALLBACK_ATTEMPTS) return;
        await sleep(
          COMPLETION_CALLBACK_RETRY_DELAYS_MS[
            Math.min(attempt - 1, COMPLETION_CALLBACK_RETRY_DELAYS_MS.length - 1)
          ],
        );
      }
    }
  }

  private evictOldRuns(): void {
    if (this.runs.size <= MAX_RUNS) return;
    // Remove oldest completed/failed runs
    for (const [id, run] of this.runs) {
      if (run.status !== "running") {
        this.runs.delete(id);
        if (this.runs.size <= MAX_RUNS) return;
      }
    }
  }
}
