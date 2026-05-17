import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import { listWorkspaceSkillsForViewer } from "@/lib/db";
import {
  createWorkspaceResourceViewer,
  serializeWorkspaceSkill,
} from "@/lib/workspace-resources";

type AvailableSkillsRouteContext = {
  params: Promise<{ workspaceId: string }>;
};

export async function GET(
  request: Request,
  context: AvailableSkillsRouteContext,
) {
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
    status: "published",
  });

  return NextResponse.json({
    items: skills.map((skill) => {
      const serialized = serializeWorkspaceSkill(skill);
      return {
        _id: serialized._id,
        slug: serialized.slug,
        displayName: serialized.displayName,
        description: serialized.description,
        tags: serialized.tags,
      };
    }),
  });
}
