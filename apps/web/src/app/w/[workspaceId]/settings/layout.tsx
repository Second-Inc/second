import { normalizeWorkspaceId } from "@/lib/auth";
import { SettingsNav } from "./settings-nav";

type WorkspaceSettingsLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
};

export default async function WorkspaceSettingsLayout({
  children,
  params,
}: WorkspaceSettingsLayoutProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId) ?? rawWorkspaceId;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <SettingsNav workspaceId={workspaceId} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
