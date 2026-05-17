import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  isRequestGuardError,
  normalizeWorkspaceId,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";

type AppLayoutProps = {
  children: React.ReactNode;
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

export default async function AppLayout({ children, params }: AppLayoutProps) {
  const { workspaceId: rawWorkspaceId, appId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  try {
    const workspaceContext = await requireWorkspaceContext({
      headers: await headers(),
      workspaceId,
    });
    const access = await resolveAppAccess({ workspaceContext, appId });
    if (!access) notFound();
  } catch (error) {
    if (isRequestGuardError(error)) notFound();
    throw error;
  }

  return children;
}
