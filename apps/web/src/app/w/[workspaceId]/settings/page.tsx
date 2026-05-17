import { redirect } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";

type WorkspaceSettingsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function WorkspaceSettingsPage({
  params,
}: WorkspaceSettingsPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId) ?? rawWorkspaceId;

  redirect(`/w/${workspaceId}/settings/members`);
}
