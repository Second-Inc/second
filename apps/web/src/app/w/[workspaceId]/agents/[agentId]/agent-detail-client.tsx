"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteAgent,
  getAgentDetail,
  updateAgent,
  listTools,
  type MockAgent,
  type MockTool,
} from "@/lib/mock-data/workspace-agents";
import { listSkills, type MockSkill } from "@/lib/mock-data/workspace-library";
import { AgentDetailView } from "../agents-client";

type AgentDetailClientProps = {
  workspaceId: string;
  agentId: string;
  teams: Array<{ _id: string; name: string; memberCount: number }>;
};

async function fetchAgentDetails(workspaceId: string, agentId: string) {
  const [agent, allSkills, allTools] = await Promise.all([
    getAgentDetail(agentId, workspaceId),
    listSkills({ workspaceId }),
    listTools(workspaceId),
  ]);

  if (!agent) {
    return { agent, skills: [], tools: [] };
  }

  const skillSet = new Set(agent.selectedSkillIds);
  const toolSet = new Set(agent.selectedToolIds);

  return {
    agent,
    skills: allSkills
      .filter((skill) => skillSet.has(skill._id))
      .map((skill) => ({
        _id: skill._id,
        slug: skill.slug,
        displayName: skill.displayName,
        description: skill.description,
        tags: skill.tags,
      })),
    tools: allTools.filter((tool) => toolSet.has(tool._id)),
  };
}

export function AgentDetailClient({ workspaceId, agentId, teams }: AgentDetailClientProps) {
  const router = useRouter();
  const [agent, setAgent] = useState<MockAgent | null>(null);
  const [skills, setSkills] = useState<
    Array<Pick<MockSkill, "_id" | "slug" | "displayName" | "description" | "tags">>
  >([]);
  const [tools, setTools] = useState<MockTool[]>([]);

  const loadAgent = useCallback(async () => {
    const details = await fetchAgentDetails(workspaceId, agentId);
    setAgent(details.agent);
    setSkills(details.skills);
    setTools(details.tools);
  }, [agentId, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    fetchAgentDetails(workspaceId, agentId).then((details) => {
      if (cancelled) return;
      setAgent(details.agent);
      setSkills(details.skills);
      setTools(details.tools);
    });

    return () => {
      cancelled = true;
    };
  }, [agentId, workspaceId]);

  if (!agent) return null;

  return (
    <AgentDetailView
      agent={agent}
      skills={skills}
      tools={tools}
      teams={teams}
      onBack={() => router.push(`/w/${workspaceId}/agents`)}
      onDelete={async () => deleteAgent(agent._id, workspaceId)}
      onRun={() => router.push(`/w/${workspaceId}?agent=${agent.slug}`)}
      onSave={async (data) => {
        await updateAgent(agent._id, { ...data, workspaceId });
        await loadAgent();
      }}
    />
  );
}
