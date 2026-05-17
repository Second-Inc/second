import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  createWorkspaceSkill,
  listWorkspaceSkillsForViewer,
} from "@/lib/db";
import {
  createWorkspaceResourceViewer,
  normalizeString,
  normalizeStringList,
  normalizeTagList,
  normalizeVisibility,
  serializeWorkspaceSkill,
  validateWorkspaceResourceTeamScope,
} from "@/lib/workspace-resources";
import type { WorkspaceSkillStatus } from "@/lib/db/types";

type SkillsRouteContext = {
  params: Promise<{ workspaceId: string }>;
};

function parseSkillStatus(value: string | null): WorkspaceSkillStatus | undefined {
  if (value === "published" || value === "draft" || value === "archived") {
    return value;
  }
  return undefined;
}

export async function GET(request: Request, context: SkillsRouteContext) {
  const { workspaceId } = await context.params;
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

  const url = new URL(request.url);
  const viewer = await createWorkspaceResourceViewer(workspaceContext);
  const skills = await listWorkspaceSkillsForViewer({
    workspaceId: workspaceContext.workspaceId,
    viewer,
    query: url.searchParams.get("query") ?? undefined,
    status: parseSkillStatus(url.searchParams.get("status")),
  });

  return NextResponse.json({
    items: skills.map(serializeWorkspaceSkill),
  });
}

export async function POST(request: Request, context: SkillsRouteContext) {
  const { workspaceId } = await context.params;
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

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const displayName = normalizeString(body?.displayName, 80);
  const description = normalizeString(body?.description, 240);
  const bodyMarkdown = normalizeString(body?.bodyMarkdown, 50_000);
  const icon = normalizeString(body?.icon, 40) || "book-open";
  const tags = normalizeTagList(body?.tags, 12, 40);
  const teamIds = normalizeStringList(body?.teamIds, 50, 80);
  const visibility = normalizeVisibility(body?.visibility);
  const slug = normalizeString(body?.slug, 80);

  if (!displayName || !bodyMarkdown) {
    return NextResponse.json({ error: "invalid_skill" }, { status: 400 });
  }

  const scope = await validateWorkspaceResourceTeamScope({
    workspaceContext,
    visibility,
    teamIds,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const skill = await createWorkspaceSkill({
    workspaceId: workspaceContext.workspaceId,
    displayName,
    slug,
    description,
    icon,
    bodyMarkdown,
    tags,
    visibility: scope.visibility,
    teamIds: scope.teamIds,
    createdByUserId: workspaceContext.user._id,
    createdByName: workspaceContext.user.displayName,
  });

  return NextResponse.json(serializeWorkspaceSkill(skill), { status: 201 });
}
