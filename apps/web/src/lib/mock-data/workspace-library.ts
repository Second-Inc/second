export type SkillStatus = "published" | "draft" | "archived";

export type MockSkillRevision = {
  _id: string;
  skillId: string;
  revisionNumber: number;
  bodyMarkdown: string;
  hash: string;
  createdByUserId: string;
  createdAt: string;
};

export type MockSkill = {
  _id: string;
  workspaceId: string;
  slug: string;
  displayName: string;
  description: string;
  icon: string;
  tags: string[];
  visibility: "teams" | "workspace";
  teamIds: string[];
  status: SkillStatus;
  createdByUserId: string;
  createdByName: string;
  currentRevisionId: string;
  currentRevisionNumber: number;
  currentRevisionHash: string;
  createdAt: string;
  updatedAt: string;
};

export const MOCK_TEAMS: Array<{ _id: string; name: string; memberCount: number }> = [];

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

export function resetMockSkills() {}

export async function listSkills(
  opts?: WorkspaceOption & {
    query?: string;
    status?: SkillStatus;
  },
): Promise<MockSkill[]> {
  const params = new URLSearchParams();
  if (opts?.query) params.set("query", opts.query);
  if (opts?.status) params.set("status", opts.status);
  const qs = params.toString();
  const data = await jsonFetch<{ items: MockSkill[] }>(
    `/api/workspaces/${currentWorkspaceId(opts?.workspaceId)}/library/skills${qs ? `?${qs}` : ""}`,
  );
  return data.items;
}

export async function getSkillDetail(
  skillId: string,
  workspaceId?: string,
): Promise<(MockSkill & { bodyMarkdown: string }) | null> {
  try {
    return await jsonFetch<MockSkill & { bodyMarkdown: string }>(
      `/api/workspaces/${currentWorkspaceId(workspaceId)}/library/skills/${skillId}`,
    );
  } catch {
    return null;
  }
}

export async function getSkillRevisions(
  _skillId: string,
): Promise<MockSkillRevision[]> {
  void _skillId;
  return [];
}

export async function createSkill(input: {
  workspaceId?: string;
  displayName: string;
  slug: string;
  description: string;
  icon: string;
  bodyMarkdown: string;
  tags: string[];
  teamIds: string[];
  visibility: "teams" | "workspace";
}): Promise<MockSkill> {
  return jsonFetch<MockSkill>(
    `/api/workspaces/${currentWorkspaceId(input.workspaceId)}/library/skills`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function updateSkill(
  skillId: string,
  input: Partial<{
    workspaceId: string;
    displayName: string;
    description: string;
    icon: string;
    bodyMarkdown: string;
    tags: string[];
    teamIds: string[];
    visibility: "teams" | "workspace";
    status: SkillStatus;
  }>,
): Promise<MockSkill | null> {
  try {
    return await jsonFetch<MockSkill>(
      `/api/workspaces/${currentWorkspaceId(input.workspaceId)}/library/skills/${skillId}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    );
  } catch {
    return null;
  }
}

export async function deleteSkill(
  skillId: string,
  workspaceId?: string,
): Promise<boolean> {
  await jsonFetch<{ ok: true }>(
    `/api/workspaces/${currentWorkspaceId(workspaceId)}/library/skills/${skillId}`,
    { method: "DELETE" },
  );
  return true;
}

export async function searchAvailableSkills(
  query: string,
  workspaceId?: string,
): Promise<
  Array<Pick<MockSkill, "_id" | "slug" | "displayName" | "description" | "tags">>
> {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  const qs = params.toString();
  const data = await jsonFetch<{
    items: Array<Pick<MockSkill, "_id" | "slug" | "displayName" | "description" | "tags">>;
  }>(
    `/api/workspaces/${currentWorkspaceId(workspaceId)}/library/skills/available${qs ? `?${qs}` : ""}`,
  );
  return data.items;
}

export function getTeams() {
  return MOCK_TEAMS;
}
