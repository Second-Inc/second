import type { MockSkill } from "./workspace-library";

export type AgentStatus = "published" | "draft" | "archived";
export type ApprovalStatus = "approved" | "stale" | "pending" | "none";

export type MockTool = {
  _id: string;
  workspaceId: string;
  slug: string;
  displayName: string;
  description: string;
  integrationName: string;
  integrationDomain: string;
  actionName: string;
  method: string;
  status: "active" | "draft";
};

export type MockAgent = {
  _id: string;
  workspaceId: string;
  slug: string;
  avatarGradientSeed?: string | null;
  displayName: string;
  description: string;
  systemPrompt: string;
  visibility: "teams" | "workspace";
  teamIds: string[];
  status: AgentStatus;
  approvalStatus: ApprovalStatus;
  selectedSkillIds: string[];
  selectedToolIds: string[];
  builtinTools: string[];
  model: string;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type MockAgentRun = {
  _id: string;
  workspaceId: string;
  agentId: string;
  agentName: string;
  status: "pending" | "streaming" | "completed" | "failed";
  createdByUserId: string;
  messages: MockRunMessage[];
  createdAt: string;
};

export type MockRunMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    id: string;
    toolName: string;
    toolDisplayName: string;
    input: string;
    output?: string;
    status: "running" | "complete" | "error";
  }>;
  createdAt: string;
};

type WorkspaceOption = { workspaceId?: string };

function currentWorkspaceId(workspaceId?: string): string {
  if (workspaceId) return workspaceId;
  if (typeof window === "undefined") {
    throw new Error("workspaceId is required outside the browser");
  }
  const match = window.location.pathname.match(/\/w\/([^/]+)/);
  if (!match?.[1]) throw new Error("workspaceId not found in URL");
  return match[1];
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function resetMockAgents() {}

export async function listTools(
  workspaceId?: string,
): Promise<MockTool[]> {
  const data = await jsonFetch<{ items: MockTool[] }>(
    `/api/workspaces/${currentWorkspaceId(workspaceId)}/agents/tools`,
  );
  return data.items;
}

export async function getToolsByIds(
  ids: string[],
  workspaceId?: string,
): Promise<MockTool[]> {
  const tools = await listTools(workspaceId);
  const set = new Set(ids);
  return tools.filter((tool) => set.has(tool._id));
}

export async function listAgents(
  opts?: WorkspaceOption & {
    query?: string;
    status?: AgentStatus;
  },
): Promise<MockAgent[]> {
  const params = new URLSearchParams();
  if (opts?.query) params.set("query", opts.query);
  if (opts?.status) params.set("status", opts.status);
  const qs = params.toString();
  const data = await jsonFetch<{ items: MockAgent[] }>(
    `/api/workspaces/${currentWorkspaceId(opts?.workspaceId)}/agents${qs ? `?${qs}` : ""}`,
  );
  return data.items;
}

export async function getAgentDetail(
  agentId: string,
  workspaceId?: string,
): Promise<MockAgent | null> {
  try {
    return await jsonFetch<MockAgent>(
      `/api/workspaces/${currentWorkspaceId(workspaceId)}/agents/${agentId}`,
    );
  } catch {
    return null;
  }
}

export async function listAvailableAgents(
  workspaceId?: string,
): Promise<
  Array<Pick<MockAgent, "_id" | "slug" | "avatarGradientSeed" | "displayName" | "description" | "approvalStatus" | "status">>
> {
  const data = await jsonFetch<{
    items: Array<Pick<MockAgent, "_id" | "slug" | "avatarGradientSeed" | "displayName" | "description" | "approvalStatus" | "status">>;
  }>(`/api/workspaces/${currentWorkspaceId(workspaceId)}/agents/available`);
  return data.items;
}

export async function createAgent(input: {
  workspaceId?: string;
  avatarGradientSeed?: string;
  displayName: string;
  slug: string;
  description: string;
  systemPrompt: string;
  visibility: "teams" | "workspace";
  teamIds: string[];
  selectedSkillIds: string[];
  selectedToolIds: string[];
  builtinTools?: string[];
  model: string;
}): Promise<MockAgent> {
  return jsonFetch<MockAgent>(
    `/api/workspaces/${currentWorkspaceId(input.workspaceId)}/agents`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function updateAgent(
  agentId: string,
  input: Partial<{
    workspaceId: string;
    avatarGradientSeed: string | null;
    displayName: string;
    description: string;
    systemPrompt: string;
    visibility: "teams" | "workspace";
    teamIds: string[];
    selectedSkillIds: string[];
    selectedToolIds: string[];
    status: AgentStatus;
    approvalStatus: ApprovalStatus;
  }>,
): Promise<MockAgent | null> {
  try {
    return await jsonFetch<MockAgent>(
      `/api/workspaces/${currentWorkspaceId(input.workspaceId)}/agents/${agentId}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    );
  } catch {
    return null;
  }
}

export async function deleteAgent(
  agentId: string,
  workspaceId?: string,
): Promise<boolean> {
  await jsonFetch<{ ok: true }>(
    `/api/workspaces/${currentWorkspaceId(workspaceId)}/agents/${agentId}`,
    { method: "DELETE" },
  );
  return true;
}

export async function createAgentRun(agentId: string): Promise<MockAgentRun> {
  throw new Error(`Workspace agent runs are created through /apps (${agentId}).`);
}

export async function getAgentRun(_runId: string): Promise<MockAgentRun | null> {
  void _runId;
  return null;
}

export async function sendAgentMessage(): Promise<void> {
  throw new Error("Workspace agent messages stream through app runs.");
}

export async function getSkillsForAgent(
  skillIds: string[],
  workspaceId?: string,
): Promise<Array<Pick<MockSkill, "_id" | "slug" | "displayName" | "description" | "tags">>> {
  const { listSkills } = await import("./workspace-library");
  const all = await listSkills({ workspaceId });
  const set = new Set(skillIds);
  return all
    .filter((skill) => set.has(skill._id))
    .map((skill) => ({
      _id: skill._id,
      slug: skill.slug,
      displayName: skill.displayName,
      description: skill.description,
      tags: skill.tags,
    }));
}
