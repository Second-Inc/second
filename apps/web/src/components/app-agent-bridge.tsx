"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useWorkspaceRealtimeEvent } from "@/components/workspace-realtime-provider";
import {
  captureAnalyticsEvent,
  textAnalyticsProperties,
} from "@/lib/analytics";

type AgentDefinition = {
  id: string;
  name: string;
  description: string;
};

type AppAgentBridgeProps = {
  workspaceId: string;
  appId: string;
  sourceVersion: "draft" | "published";
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  agents: AgentDefinition[];
  onAgentRunStarted?: (runId: string, agentId: string, prompt: string) => void;
};

export function AppAgentBridge({
  workspaceId,
  appId,
  sourceVersion,
  iframeRef,
  agents,
  onAgentRunStarted,
}: AppAgentBridgeProps) {
  const agentsRef = useRef(agents);
  const activeRunsRef = useRef(
    new Map<
      string,
      {
        agentId: string;
        agentName: string;
        prompt: string;
        startedAt: number;
      }
    >(),
  );
  const fallbackControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const postToIframe = useCallback(
    (data: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage(
        { source: "second-platform", ...data },
        "*",
      );
    },
    [iframeRef],
  );

  const completeKnownRun = useCallback(
    async (
      runId: string,
      agentId: string,
      status?: string,
      signal?: AbortSignal,
    ) => {
      let finalStatus = status;
      let error: string | null = null;

      if (!finalStatus || finalStatus === "failed") {
        try {
          const res = await fetch(
            `/api/workspaces/${workspaceId}/apps/${appId}/agent-runs/${runId}?summary=1`,
            { cache: "no-store", signal },
          );
          if (res.ok && !signal?.aborted) {
            const data = (await res.json()) as {
              status: string;
              result: unknown;
            };
            finalStatus = data.status;
            if (data.status === "failed") {
              error =
                typeof data.result === "object" &&
                data.result !== null &&
                "error" in data.result
                  ? String((data.result as { error: string }).error)
                  : "Agent run failed";
            }
          }
        } catch {
          return;
        }
      }

      if (signal?.aborted) return;
      if (finalStatus !== "completed" && finalStatus !== "failed") return;

      const activeRun = activeRunsRef.current.get(runId);
      if (!activeRun) return;
      const agentName =
        activeRun?.agentName ??
        agentsRef.current.find((agent) => agent.id === agentId)?.name ??
        agentId;
      activeRunsRef.current.delete(runId);
      captureAnalyticsEvent(
        finalStatus === "completed" ? "app agent finished" : "app agent error",
        {
          workspace_id: workspaceId,
          app_id: appId,
          run_id: runId,
          agent_id: agentId,
          agent_name: agentName,
          source_version: sourceVersion,
          duration_ms: Math.max(0, Math.round(performance.now() - activeRun.startedAt)),
          ...(error ? { error } : {}),
          ...textAnalyticsProperties("prompt", activeRun?.prompt),
        },
      );
      postToIframe({
        type: "second:agent:update",
        agentId,
        runId,
        status: finalStatus,
        ...(error ? { error } : {}),
      });
    },
    [workspaceId, appId, postToIframe, sourceVersion],
  );

  const checkActiveRuns = useCallback(async () => {
    const activeRuns = Array.from(activeRunsRef.current.entries());
    if (activeRuns.length === 0) return;

    fallbackControllerRef.current?.abort();
    const controller = new AbortController();
    fallbackControllerRef.current = controller;

    await Promise.allSettled(
      activeRuns.map(([runId, { agentId }]) =>
        completeKnownRun(runId, agentId, undefined, controller.signal),
      ),
    );

    if (fallbackControllerRef.current === controller) {
      fallbackControllerRef.current = null;
    }
  }, [completeKnownRun]);

  useWorkspaceRealtimeEvent(
    useCallback(
      (event) => {
        if (event.workspaceId !== workspaceId) return;
        if (event.scope !== "agent-runs") return;
        if (event.appId !== appId || !event.runId) return;

        const active = activeRunsRef.current.get(event.runId);
        if (!active) return;
        if (event.runStatus !== "completed" && event.runStatus !== "failed") {
          return;
        }

        void completeKnownRun(
          event.runId,
          active.agentId,
          event.runStatus,
        );
      },
      [appId, completeKnownRun, workspaceId],
    ),
  );

  useEffect(() => {
    const activeRuns = activeRunsRef.current;
    const interval = window.setInterval(() => {
      void checkActiveRuns();
    }, 15_000);

    return () => {
      window.clearInterval(interval);
      fallbackControllerRef.current?.abort();
      fallbackControllerRef.current = null;
      activeRuns.clear();
    };
  }, [checkActiveRuns]);

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow || event.source !== iframeWindow) return;

      const data = event.data;
      if (data?.source !== "second-app") return;

      // Agent list request
      if (data.type === "second:agents:list-request") {
        postToIframe({
          type: "second:agents:list",
          agents: agentsRef.current.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
          })),
        });
        return;
      }

      // Agent trigger
      if (data.type === "second:agent:trigger") {
        const { requestId, agentId, prompt } = data as {
          requestId: string;
          agentId: string;
          prompt: string;
        };

        let createdRunId: string | null = null;
        const agentName =
          agentsRef.current.find((agent) => agent.id === agentId)?.name ??
          agentId;

        try {
          const res = await fetch(
            `/api/workspaces/${workspaceId}/apps/${appId}/agent-runs`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ agentId, prompt, sourceVersion }),
            },
          );

          if (!res.ok) {
            const json = (await res.json().catch(() => null)) as
              | { error?: string }
              | null;
            const approvalRequired = json?.error === "agents_approval_required";
            if (approvalRequired) {
              toast.error("Draft agent config needs approval.", {
                description:
                  "The published app still works. Ask a workspace admin to review this agents.json revision.",
              });
            }
            captureAnalyticsEvent("app agent error", {
              workspace_id: workspaceId,
              app_id: appId,
              run_id: null,
              agent_id: agentId,
              agent_name: agentName,
              source_version: sourceVersion,
              phase: "create",
              status_code: res.status,
              error: approvalRequired
                ? "agents_approval_required"
                : `Failed to trigger agent: ${res.status}`,
              ...textAnalyticsProperties("prompt", prompt),
            });
            postToIframe({
              type: "second:agent:update",
              agentId,
              runId: null,
              status: "failed",
              error: approvalRequired
                ? "Draft agent config needs approval before live agents can run."
                : `Failed to trigger agent: ${res.status}`,
            });
            return;
          }

          const { runId } = (await res.json()) as { runId: string };
          createdRunId = runId;
          activeRunsRef.current.set(runId, {
            agentId,
            agentName,
            prompt,
            startedAt: performance.now(),
          });

          const startRes = await fetch(
            `/api/workspaces/${workspaceId}/apps/${appId}/agent-runs/${runId}/stream?startOnly=1`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages: [] }),
            },
          );

          if (!startRes.ok) {
            activeRunsRef.current.delete(runId);
            captureAnalyticsEvent("app agent error", {
              workspace_id: workspaceId,
              app_id: appId,
              run_id: runId,
              agent_id: agentId,
              agent_name: agentName,
              source_version: sourceVersion,
              phase: "start",
              status_code: startRes.status,
              error: `Failed to start agent: ${startRes.status}`,
              ...textAnalyticsProperties("prompt", prompt),
            });
            postToIframe({
              type: "second:agent:update",
              agentId,
              runId,
              status: "failed",
              error: `Failed to start agent: ${startRes.status}`,
            });
            return;
          }

          // Acknowledge trigger
          postToIframe({
            type: "second:agent:triggered",
            requestId,
            runId,
          });
          captureAnalyticsEvent("app agent triggered", {
            workspace_id: workspaceId,
            app_id: appId,
            run_id: runId,
            agent_id: agentId,
            agent_name: agentName,
            source_version: sourceVersion,
            ...textAnalyticsProperties("prompt", prompt),
          });

          onAgentRunStarted?.(runId, agentId, prompt);
          window.setTimeout(() => {
            void checkActiveRuns();
          }, 5_000);
        } catch (err) {
          if (createdRunId) activeRunsRef.current.delete(createdRunId);
          captureAnalyticsEvent("app agent error", {
            workspace_id: workspaceId,
            app_id: appId,
            run_id: createdRunId,
            agent_id: agentId,
            agent_name: agentName,
            source_version: sourceVersion,
            phase: "request",
            error: err instanceof Error ? err.message : String(err),
            ...textAnalyticsProperties("prompt", prompt),
          });
          postToIframe({
            type: "second:agent:update",
            agentId,
            runId: createdRunId,
            status: "failed",
            error: String(err),
          });
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [
    workspaceId,
    appId,
    sourceVersion,
    iframeRef,
    postToIframe,
    onAgentRunStarted,
    checkActiveRuns,
  ]);

  return null;
}
