import { notFound } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";
import DiagnosticsClient from "./diagnostics-client";

type DiagnosticsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function DiagnosticsPage({
  params,
}: DiagnosticsPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  return <DiagnosticsClient workspaceId={workspaceId} />;
}
