import { getRedisClient } from "@/lib/redis";
import type { AgentRunDocument, AppAgentRunDocument } from "@/lib/db/types";

export type WorkspaceEventScope =
  | "apps"
  | "reviews"
  | "memberships"
  | "team-memberships"
  | "agent-runs"
  | "integrations"
  | "audit-events"
  | "library"
  | "workspace-settings"
  | "workspace-agents";

export type WorkspaceEventType =
  | "app.created"
  | "app.updated"
  | "app.deleted"
  | "app.published"
  | "review.requested"
  | "review.updated"
  | "integration.changed"
  | "skill.created"
  | "skill.updated"
  | "skill.deleted"
  | "agent.created"
  | "agent.updated"
  | "agent.deleted"
  | "member.changed"
  | "run.created"
  | "run.autostart_scheduled"
  | "run.starting"
  | "run.stream_ready"
  | "run.completed"
  | "run.failed"
  | "audit.changed"
  | "changed";

export type WorkspaceEvent = {
  version: 1;
  type: WorkspaceEventType;
  workspaceId: string;
  scope: WorkspaceEventScope;
  appId?: string;
  integrationId?: string;
  credentialId?: string | null;
  keySlug?: string;
  runId?: string;
  sourceVersion?: "draft" | "published";
  runReason?: "app_tool_failure";
  skillId?: string;
  agentId?: string;
  runStatus?: AgentRunDocument["status"] | AppAgentRunDocument["status"];
  at: string;
};

export function workspaceEventsChannel(workspaceId: string): string {
  return `workspace:${workspaceId}:events`;
}

export function publishWorkspaceEvent(
  event: Omit<WorkspaceEvent, "version" | "at">,
): void {
  const payload: WorkspaceEvent = {
    version: 1,
    at: new Date().toISOString(),
    ...event,
  };

  if (process.env.SECOND_PERF_TRACE === "1") {
    console.info(
      JSON.stringify({
        type: "second.perf",
        event: "workspace.event.publish",
        at: payload.at,
        workspaceId: payload.workspaceId,
        scope: payload.scope,
        workspaceEventType: payload.type,
        appId: payload.appId,
        runId: payload.runId,
        sourceVersion: payload.sourceVersion,
        runReason: payload.runReason,
        skillId: payload.skillId,
        agentId: payload.agentId,
        runStatus: payload.runStatus,
      }),
    );
  }

  getRedisClient()
    .publish(workspaceEventsChannel(event.workspaceId), JSON.stringify(payload))
    .catch(() => {
      // Workspace events are invalidation hints. Authorized reads remain the
      // source of truth, and focus/manual refetch can recover a missed event.
    });
}
