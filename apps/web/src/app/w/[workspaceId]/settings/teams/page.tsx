import { notFound } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";
import TeamsClient from "./teams-client";

type TeamsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function TeamsPage({ params }: TeamsPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  return <TeamsClient initialData={null} />;
}
