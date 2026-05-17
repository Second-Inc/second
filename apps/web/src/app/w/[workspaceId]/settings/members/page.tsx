import { notFound } from "next/navigation";
import { normalizeWorkspaceId } from "@/lib/auth";
import MembersClient from "./members-client";

type MembersPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function MembersPage({ params }: MembersPageProps) {
  const { workspaceId: rawWorkspaceId } = await params;
  const workspaceId = normalizeWorkspaceId(rawWorkspaceId);
  if (!workspaceId) notFound();

  return (
    <MembersClient
      initialData={null}
      initialInvitations={[]}
    />
  );
}
