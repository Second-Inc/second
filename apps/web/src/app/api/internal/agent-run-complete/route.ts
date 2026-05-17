import { NextResponse } from "next/server";
import { validateInternalToken } from "@/lib/auth/internal-auth";
import { recordAuditEvent } from "@/lib/audit/record";
import {
  completeAppAgentRun,
  failAppAgentRun,
  accumulateAppAgentRunUsage,
  findAppAgentRunById,
  saveAppAgentRunMessages,
} from "@/lib/db";
import { getRedisClient, runEventsChannel } from "@/lib/redis";
import { appAgentSdkMessagesToUiMessages } from "@/lib/agent/worker-bridge";

type AgentRunCompleteRequest = {
  runId: string;
  status: "completed" | "failed";
  result: unknown;
  usage: {
    totalCostUsd?: unknown;
    modelUsage?: Record<
      string,
      {
        inputTokens?: unknown;
        outputTokens?: unknown;
        cacheReadInputTokens?: unknown;
        cacheCreationInputTokens?: unknown;
        costUsd?: unknown;
        costUSD?: unknown;
      } | null | undefined
    > | null;
  } | null;
  messages?: unknown[];
};

function fallbackResultMessages(runId: string, result: unknown): unknown[] {
  if (result == null) return [];
  const text =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
  if (!text) return [];
  return [
    {
      id: `agent-result-${runId}`,
      role: "assistant",
      parts: [{ type: "text", text }],
    },
  ];
}

export async function POST(request: Request) {
  const authError = validateInternalToken(request);
  if (authError) return authError;

  const body = (await request.json()) as AgentRunCompleteRequest;
  const { runId, status, result, usage } = body;

  if (!runId || !status) {
    return NextResponse.json(
      { error: "runId and status required" },
      { status: 400 },
    );
  }

  try {
    const run = await findAppAgentRunById(runId);
    const transcriptMessages = Array.isArray(body.messages)
      ? await appAgentSdkMessagesToUiMessages({ messages: body.messages }).catch(
          (err) => {
            console.error(
              "[agent-run-complete] transcript conversion error:",
              err,
            );
            return [];
          },
        )
      : [];
    if (status === "completed") {
      await completeAppAgentRun(
        runId,
        transcriptMessages.length > 0
          ? transcriptMessages
          : fallbackResultMessages(runId, result),
        result,
      );
    } else {
      if (transcriptMessages.length > 0) {
        await saveAppAgentRunMessages(runId, transcriptMessages, null).catch(
          (err) =>
            console.error("[agent-run-complete] message persistence error:", err),
        );
      }
      const errorMsg =
        typeof result === "object" &&
        result !== null &&
        "error" in result
          ? String((result as { error: string }).error)
          : "Agent run failed";
      await failAppAgentRun(runId, errorMsg);
    }

    if (run) {
      await recordAuditEvent({
        workspaceId: run.workspaceId,
        eventName:
          status === "completed"
            ? "app_agent_run.completed"
            : "app_agent_run.failed",
        category: "agents",
        severity: status === "completed" ? "info" : "warning",
        outcome: status === "completed" ? "completed" : "failure",
        actor: {
          kind: "agent",
          agentId: run.agentId,
          agentName: run.agentName,
        },
        source: {
          kind: "app_agent",
          trust: "internal_trusted",
          appId: run.appId,
          sourceVersion: run.sourceVersion ?? "published",
          runId: run._id,
        },
        target: {
          type: "run",
          id: run._id,
          name: run.agentName,
          parentType: "app",
          parentId: run.appId,
        },
        action: status,
        summary:
          status === "completed"
            ? `Completed app-agent run for ${run.agentName}.`
            : `Failed app-agent run for ${run.agentName}.`,
        metadata: {
          agentId: run.agentId,
          agentName: run.agentName,
          sourceVersion: run.sourceVersion ?? "published",
          hasUsage: Boolean(usage),
        },
        relatedIds: { appId: run.appId, agentRunId: run._id },
      });
    }

    if (usage) {
      await accumulateAppAgentRunUsage(runId, {
        totalCostUsd: usage.totalCostUsd,
        modelUsage: usage.modelUsage,
      }).catch((err) =>
        console.error("[agent-run-complete] usage persistence error:", err),
      );
    }

    // Publish event so any connected SSE viewers know the run is done
    const redis = getRedisClient();
    redis
      .publish(
        runEventsChannel(runId),
        JSON.stringify({ type: status }),
      )
      .catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[agent-run-complete] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
