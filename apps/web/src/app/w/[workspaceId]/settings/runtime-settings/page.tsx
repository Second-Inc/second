import { notFound } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";
import RuntimeSettingsClient from "./runtime-settings-client";

type AppRuntimeSettingsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function AppRuntimeSettingsPage({
  params,
}: AppRuntimeSettingsPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  return (
    <RuntimeSettingsClient
      workspaceId={workspaceId}
      initialData={null}
    />
  );
}
