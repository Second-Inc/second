import { notFound } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";
import ConnectedAppsClient from "./connected-apps-client";

type ConnectedAppsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function ConnectedAppsPage({
  params,
}: ConnectedAppsPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  return <ConnectedAppsClient workspaceId={workspaceId} initialData={null} />;
}
