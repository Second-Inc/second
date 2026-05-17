import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { WorkspaceHome } from "@/components/workspace-home";
import {
  isRequestGuardError,
  normalizeWorkspaceId,
  requireWorkspaceContext,
} from "@/lib/auth";
import { findRunnableWorkspaceAgentBySlugForViewer } from "@/lib/db";
import { createWorkspaceResourceViewer } from "@/lib/workspace-resources";

type WorkspacePageProps = {
  params: Promise<{
    workspaceId: string;
  }>;
  searchParams: Promise<{
    prompt?: string | string[];
    agent?: string | string[];
  }>;
};

export default async function WorkspacePage({
  params,
  searchParams,
}: WorkspacePageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const { prompt, agent } = await searchParams;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);

  if (!workspaceId) {
    notFound();
  }

  const initialPrompt = Array.isArray(prompt) ? prompt[0] : prompt;
  const requestedAgentSlug = Array.isArray(agent) ? agent[0] : agent;
  let initialAgent: { _id: string; displayName: string } | null = null;

  if (requestedAgentSlug) {
    try {
      const workspaceContext = await requireWorkspaceContext({
        headers: await headers(),
        workspaceId,
      });
      const viewer = await createWorkspaceResourceViewer(workspaceContext);
      const requestedAgent = await findRunnableWorkspaceAgentBySlugForViewer({
        workspaceId: workspaceContext.workspaceId,
        slug: requestedAgentSlug,
        viewer,
      });
      initialAgent = requestedAgent
        ? {
            _id: requestedAgent._id,
            displayName: requestedAgent.displayName,
          }
        : null;
    } catch (error) {
      if (isRequestGuardError(error)) {
        notFound();
      }
      throw error;
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center px-4">
      <div className="my-auto flex w-full max-w-[720px] flex-col items-center py-12">
        <WorkspaceHome
          workspaceId={workspaceId}
          initialPrompt={initialPrompt?.slice(0, 10000) ?? ""}
          initialAgentId={initialAgent?._id ?? null}
          initialAgent={initialAgent}
        />
      </div>
    </div>
  );
}
