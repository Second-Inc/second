import { notFound } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";
import AuditLogsRedesigned from "./audit-logs-redesigned";

type AuditLogsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function AuditLogsPage({ params }: AuditLogsPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  return <AuditLogsRedesigned workspaceId={workspaceId} />;
}
