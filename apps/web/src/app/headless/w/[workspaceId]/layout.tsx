import { notFound } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceContentErrorBoundary } from "@/components/workspace-content-error-boundary";
import { WorkspaceRealtimeProvider } from "@/components/workspace-realtime-provider";

type HeadlessWorkspaceLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
};

export default async function HeadlessWorkspaceLayout({
  children,
  params,
}: HeadlessWorkspaceLayoutProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={900}>
      <WorkspaceRealtimeProvider workspaceId={workspaceId}>
        <WorkspaceContentErrorBoundary>
          <div className="flex h-svh min-h-0 flex-col overflow-hidden bg-background">
            {children}
          </div>
        </WorkspaceContentErrorBoundary>
      </WorkspaceRealtimeProvider>
    </TooltipProvider>
  );
}
