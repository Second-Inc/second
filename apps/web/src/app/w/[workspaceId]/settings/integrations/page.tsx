import { notFound } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";
import IntegrationsClient from "./integrations-client";

type IntegrationsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function IntegrationsPage({
  params,
}: IntegrationsPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  return <IntegrationsClient workspaceId={workspaceId} initialData={null} />;
}
