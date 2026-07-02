import { notFound } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";
import GitHubSourceControlClient from "../github-source-control-client";

type GitHubSourceControlPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function GitHubSourceControlPage({
  params,
}: GitHubSourceControlPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  return (
    <GitHubSourceControlClient workspaceId={workspaceId} initialData={null} />
  );
}
