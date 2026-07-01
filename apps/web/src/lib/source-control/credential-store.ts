import {
  deleteOAuthSecret,
  readOAuthSecret,
  storeOAuthSecret,
  upsertOAuthSecret,
} from "@/lib/oauth/secret-store";

export async function storeSourceControlCredential(input: {
  workspaceId: string;
  provider: "github";
  token: string;
}): Promise<string> {
  return storeOAuthSecret({
    workspaceId: input.workspaceId,
    name: `source-control:${input.provider}`,
    value: input.token,
  });
}

export async function upsertSourceControlCredential(input: {
  workspaceId: string;
  provider: "github";
  token: string;
  existingRef?: string | null;
}): Promise<string> {
  return upsertOAuthSecret({
    workspaceId: input.workspaceId,
    name: `source-control:${input.provider}`,
    value: input.token,
    existingRef: input.existingRef,
  });
}

export async function readSourceControlCredential(ref: string): Promise<string> {
  return readOAuthSecret(ref);
}

export async function deleteSourceControlCredential(
  ref: string | null | undefined,
): Promise<void> {
  await deleteOAuthSecret(ref);
}
