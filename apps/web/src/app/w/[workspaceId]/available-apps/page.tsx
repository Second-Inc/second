import { notFound } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";
import { canShowLocalSourceControlFeatures } from "@/lib/source-control/runtime";
import { AvailableAppsClient } from "./available-apps-client";

type AvailableAppsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function AvailableAppsPage({
  params,
}: AvailableAppsPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId || !canShowLocalSourceControlFeatures()) notFound();

  return <AvailableAppsClient workspaceId={workspaceId} />;
}
