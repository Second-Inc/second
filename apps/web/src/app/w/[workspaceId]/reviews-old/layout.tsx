import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  isRequestGuardError,
  isWorkspaceAdminRole,
  normalizeWorkspaceId,
  requireWorkspaceContext,
} from "@/lib/auth";

type ReviewLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
};

export default async function ReviewLayout({
  children,
  params,
}: ReviewLayoutProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  try {
    const workspaceContext = await requireWorkspaceContext({
      headers: await headers(),
      workspaceId,
    });
    if (!isWorkspaceAdminRole(workspaceContext.membership.role)) notFound();
  } catch (error) {
    if (isRequestGuardError(error)) notFound();
    throw error;
  }

  return children;
}
