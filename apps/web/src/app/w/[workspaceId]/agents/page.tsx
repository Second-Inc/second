import { headers } from "next/headers";
import {
  isRequestGuardError,
  normalizeWorkspaceId,
  requireWorkspaceContext,
} from "@/lib/auth";
import { listWorkspaceTeamOptions } from "@/lib/workspace-resources";
import { notFound } from "next/navigation";
import { AgentsClient } from "./agents-client";

type AgentsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function AgentsPage({ params }: AgentsPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);

  if (!workspaceId) {
    notFound();
  }

  try {
    await requireWorkspaceContext({
      headers: await headers(),
      pathname: `/w/${workspaceId}/agents`,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) notFound();
    throw error;
  }

  const teams = await listWorkspaceTeamOptions(workspaceId);

  return <AgentsClient workspaceId={workspaceId} teams={teams} />;
}
