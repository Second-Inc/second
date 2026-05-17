import { headers } from "next/headers";
import {
  isRequestGuardError,
  normalizeWorkspaceId,
  requireWorkspaceContext,
} from "@/lib/auth";
import { listWorkspaceTeamOptions } from "@/lib/workspace-resources";
import { notFound } from "next/navigation";
import { AgentDetailClient } from "./agent-detail-client";

type AgentDetailPageProps = {
  params: Promise<{ workspaceId: string; agentId: string }>;
};

export default async function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { workspaceId: rawWorkspaceId, agentId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);

  if (!workspaceId || !agentId) {
    notFound();
  }

  try {
    await requireWorkspaceContext({
      headers: await headers(),
      pathname: `/w/${workspaceId}/agents/${agentId}`,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) notFound();
    throw error;
  }

  const teams = await listWorkspaceTeamOptions(workspaceId);

  return (
    <AgentDetailClient
      workspaceId={workspaceId}
      agentId={agentId}
      teams={teams}
    />
  );
}
