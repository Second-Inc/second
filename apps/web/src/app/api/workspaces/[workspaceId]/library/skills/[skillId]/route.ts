import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  isWorkspaceAdminRole,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  deleteWorkspaceSkill,
  findWorkspaceSkillDetailBySlugForViewer,
  findWorkspaceSkillDetailForViewer,
  updateWorkspaceSkill,
} from "@/lib/db";
import {
  createWorkspaceResourceViewer,
  normalizeString,
  normalizeStringList,
  normalizeTagList,
  normalizeVisibility,
  serializeWorkspaceSkillDetail,
  validateWorkspaceResourceTeamScope,
} from "@/lib/workspace-resources";
import type { WorkspaceSkillStatus } from "@/lib/db/types";

type SkillDetailRouteContext = {
  params: Promise<{ workspaceId: string; skillId: string }>;
};

async function findRouteSkillForViewer(input: {
  workspaceId: string;
  skillId: string;
  viewer: Awaited<ReturnType<typeof createWorkspaceResourceViewer>>;
}) {
  return (
    (await findWorkspaceSkillDetailForViewer({
      workspaceId: input.workspaceId,
      skillId: input.skillId,
      viewer: input.viewer,
    })) ??
    (await findWorkspaceSkillDetailBySlugForViewer({
      workspaceId: input.workspaceId,
      slug: input.skillId,
      viewer: input.viewer,
    }))
  );
}

function parseStatus(value: unknown): WorkspaceSkillStatus | undefined {
  return value === "published" || value === "draft" || value === "archived"
    ? value
    : undefined;
}

export async function GET(request: Request, context: SkillDetailRouteContext) {
  const { workspaceId, skillId } = await context.params;
  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;

  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const viewer = await createWorkspaceResourceViewer(workspaceContext);
  const skill = await findRouteSkillForViewer({
    workspaceId: workspaceContext.workspaceId,
    skillId,
    viewer,
  });
  if (!skill) {
    return NextResponse.json({ error: "skill_not_found" }, { status: 404 });
  }

  return NextResponse.json(serializeWorkspaceSkillDetail(skill));
}

export async function PATCH(request: Request, context: SkillDetailRouteContext) {
  const { workspaceId, skillId } = await context.params;
  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;

  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const viewer = await createWorkspaceResourceViewer(workspaceContext);
  const existing = await findRouteSkillForViewer({
    workspaceId: workspaceContext.workspaceId,
    skillId,
    viewer,
  });
  if (!existing) {
    return NextResponse.json({ error: "skill_not_found" }, { status: 404 });
  }

  const canManage =
    isWorkspaceAdminRole(workspaceContext.membership.role) ||
    existing.createdByUserId === workspaceContext.user._id;
  if (!canManage) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const requestedTeamIds = Array.isArray(body?.teamIds)
    ? normalizeStringList(body?.teamIds, 50, 80)
    : undefined;
  const requestedVisibility =
    body?.visibility === "workspace" || body?.visibility === "teams"
      ? normalizeVisibility(body.visibility)
      : requestedTeamIds
        ? requestedTeamIds.length > 0
          ? "teams"
          : "workspace"
        : undefined;

  let scoped:
    | {
        visibility?: typeof existing.visibility;
        teamIds?: string[];
      }
    | null = {};
  if (requestedVisibility || requestedTeamIds) {
    const scope = await validateWorkspaceResourceTeamScope({
      workspaceContext,
      visibility: requestedVisibility ?? existing.visibility,
      teamIds: requestedTeamIds ?? existing.teamIds,
    });
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    scoped = {
      visibility: scope.visibility,
      teamIds: scope.teamIds,
    };
  }

  const displayName =
    typeof body?.displayName === "string"
      ? normalizeString(body.displayName, 80)
      : undefined;
  const bodyMarkdown =
    typeof body?.bodyMarkdown === "string"
      ? normalizeString(body.bodyMarkdown, 50_000)
      : undefined;

  if (displayName === "" || bodyMarkdown === "") {
    return NextResponse.json({ error: "invalid_skill" }, { status: 400 });
  }

  const skill = await updateWorkspaceSkill({
    workspaceId: workspaceContext.workspaceId,
    skillId: existing._id,
    displayName,
    description:
      typeof body?.description === "string"
        ? normalizeString(body.description, 240)
        : undefined,
    icon:
      typeof body?.icon === "string"
        ? normalizeString(body.icon, 40) || "book-open"
        : undefined,
    bodyMarkdown,
    tags: Array.isArray(body?.tags)
      ? normalizeTagList(body.tags, 12, 40)
      : undefined,
    visibility: scoped?.visibility,
    teamIds: scoped?.teamIds,
    status: parseStatus(body?.status),
    updatedByUserId: workspaceContext.user._id,
  });

  if (!skill) {
    return NextResponse.json({ error: "skill_not_found" }, { status: 404 });
  }

  const detail = await findWorkspaceSkillDetailForViewer({
    workspaceId: workspaceContext.workspaceId,
    skillId: existing._id,
    viewer,
  });

  return NextResponse.json(
    detail ? serializeWorkspaceSkillDetail(detail) : { ...skill },
  );
}

export async function DELETE(
  request: Request,
  context: SkillDetailRouteContext,
) {
  const { workspaceId, skillId } = await context.params;
  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;

  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const viewer = await createWorkspaceResourceViewer(workspaceContext);
  const existing = await findRouteSkillForViewer({
    workspaceId: workspaceContext.workspaceId,
    skillId,
    viewer,
  });
  if (!existing) {
    return NextResponse.json({ error: "skill_not_found" }, { status: 404 });
  }

  const canManage =
    isWorkspaceAdminRole(workspaceContext.membership.role) ||
    existing.createdByUserId === workspaceContext.user._id;
  if (!canManage) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const deleted = await deleteWorkspaceSkill({
    workspaceId: workspaceContext.workspaceId,
    skillId: existing._id,
  });
  if (!deleted) {
    return NextResponse.json({ error: "skill_not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
