import { notFound } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";
import IntegrationsClient from "../integrations-client";

type IntegrationDetailPageProps = {
  params: Promise<{ workspaceId: string; integrationId: string }>;
};

export default async function IntegrationDetailPage({
  params,
}: IntegrationDetailPageProps) {
  const { workspaceId: rawWorkspaceId, integrationId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  return (
    <IntegrationsClient
      workspaceId={workspaceId}
      initialData={null}
      selectedIntegrationId={decodeURIComponent(integrationId)}
    />
  );
}
