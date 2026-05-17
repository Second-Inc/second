import { isWorkspaceAdminRole } from "@/lib/auth";
import {
  listTeamIdsForUser,
  listWorkspaceTeamMembershipsForWorkspace,
  listWorkspaceTeams,
} from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/guard";
import type {
  ResourceVisibility,
  WorkspaceAgentDocument,
  WorkspaceSkillDocument,
  WorkspaceTeamDocument,
} from "@/lib/db/types";
import type { WorkspaceResourceViewer } from "@/lib/db";

export type WorkspaceTeamOption = {
  _id: string;
  name: string;
  memberCount: number;
};

export type TeamScopeValidation =
  | {
      ok: true;
      visibility: ResourceVisibility;
      teamIds: string[];
    }
  | {
      ok: false;
      error: "invalid_team_ids" | "workspace_visibility_forbidden";
      status: number;
    };

export function normalizeString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeStringList(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, maxLength))
        .filter(Boolean),
    ),
  ].slice(0, maxItems);
}

export function normalizeTagList(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .flatMap((item) => item.split(/[,\s]+/g))
        .map((item) =>
          item
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, maxLength),
        )
        .filter(Boolean),
    ),
  ].slice(0, maxItems);
}

export function normalizeVisibility(value: unknown): ResourceVisibility {
  return value === "workspace" ? "workspace" : "teams";
}

export async function createWorkspaceResourceViewer(
  workspaceContext: WorkspaceContext,
): Promise<WorkspaceResourceViewer> {
  const isAdmin = isWorkspaceAdminRole(workspaceContext.membership.role);
  const teamIds = isAdmin
    ? []
    : await listTeamIdsForUser({
        workspaceId: workspaceContext.workspaceId,
        userId: workspaceContext.user._id,
      });

  return {
    userId: workspaceContext.user._id,
    role: workspaceContext.membership.role,
    teamIds,
  };
}

export async function validateWorkspaceResourceTeamScope(input: {
  workspaceContext: WorkspaceContext;
  visibility: ResourceVisibility;
  teamIds: string[];
}): Promise<TeamScopeValidation> {
  const isAdmin = isWorkspaceAdminRole(input.workspaceContext.membership.role);
  const uniqueTeamIds = [...new Set(input.teamIds.filter(Boolean))];

  if (input.visibility === "workspace") {
    if (!isAdmin) {
      return {
        ok: false,
        error: "workspace_visibility_forbidden",
        status: 403,
      };
    }
    return { ok: true, visibility: "workspace", teamIds: [] };
  }

  if (uniqueTeamIds.length === 0) {
    return { ok: true, visibility: "teams", teamIds: [] };
  }

  const teams = await listWorkspaceTeams(input.workspaceContext.workspaceId);
  const workspaceTeamIds = new Set(teams.map((team) => team._id));
  if (uniqueTeamIds.some((teamId) => !workspaceTeamIds.has(teamId))) {
    return { ok: false, error: "invalid_team_ids", status: 400 };
  }

  if (!isAdmin) {
    const userTeamIds = new Set(
      await listTeamIdsForUser({
        workspaceId: input.workspaceContext.workspaceId,
        userId: input.workspaceContext.user._id,
      }),
    );
    if (uniqueTeamIds.some((teamId) => !userTeamIds.has(teamId))) {
      return { ok: false, error: "invalid_team_ids", status: 403 };
    }
  }

  return { ok: true, visibility: "teams", teamIds: uniqueTeamIds };
}

export async function listWorkspaceTeamOptions(
  workspaceId: string,
): Promise<WorkspaceTeamOption[]> {
  const [teams, memberships] = await Promise.all([
    listWorkspaceTeams(workspaceId),
    listWorkspaceTeamMembershipsForWorkspace(workspaceId),
  ]);
  const memberCounts = memberships.reduce((counts, membership) => {
    counts.set(membership.teamId, (counts.get(membership.teamId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  return teams.map((team: WorkspaceTeamDocument) => ({
    _id: team._id,
    name: team.name,
    memberCount: memberCounts.get(team._id) ?? 0,
  }));
}

export function serializeWorkspaceSkill(skill: WorkspaceSkillDocument) {
  return {
    ...skill,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
  };
}

export function serializeWorkspaceSkillDetail(
  skill: WorkspaceSkillDocument & { bodyMarkdown: string },
) {
  return {
    ...serializeWorkspaceSkill(skill),
    bodyMarkdown: skill.bodyMarkdown,
  };
}

export function serializeWorkspaceAgent(agent: WorkspaceAgentDocument) {
  return {
    ...agent,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}
