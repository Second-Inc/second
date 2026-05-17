import { headers } from "next/headers";
import {
  isRequestGuardError,
  normalizeWorkspaceId,
  requireWorkspaceContext,
} from "@/lib/auth";
import { listWorkspaceTeamOptions } from "@/lib/workspace-resources";
import { notFound } from "next/navigation";
import { LibraryClient } from "./library-client";

type LibraryPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function LibraryPage({ params }: LibraryPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);

  if (!workspaceId) {
    notFound();
  }

  try {
    await requireWorkspaceContext({
      headers: await headers(),
      pathname: `/w/${workspaceId}/library`,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) {
      notFound();
    }
    throw error;
  }

  const teams = await listWorkspaceTeamOptions(workspaceId);

  return <LibraryClient workspaceId={workspaceId} teams={teams} />;
}
