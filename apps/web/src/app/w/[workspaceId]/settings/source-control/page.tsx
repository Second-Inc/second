import { notFound } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";
import SourceControlClient from "./source-control-client";

type SourceControlPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function SourceControlPage({
  params,
}: SourceControlPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  return <SourceControlClient workspaceId={workspaceId} initialData={null} />;
}
