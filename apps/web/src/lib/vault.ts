import { WorkOS } from "@workos-inc/node";

let workos: WorkOS | null = null;

function getWorkOS(): WorkOS {
  if (!workos) {
    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey)
      throw new Error("WORKOS_API_KEY is required for secret management");
    workos = new WorkOS(apiKey);
  }
  return workos;
}

export function isVaultConfigured(): boolean {
  return Boolean(process.env.WORKOS_API_KEY);
}

export async function storeSecret(
  name: string,
  value: string,
  workspaceId: string,
): Promise<string> {
  const obj = await getWorkOS().vault.createObject({
    name,
    value,
    context: { workspaceId },
  });
  return obj.id;
}

export async function readSecret(vaultSecretId: string): Promise<string> {
  const obj = await getWorkOS().vault.readObject({ id: vaultSecretId });
  if (!obj.value) throw new Error("Secret value is empty");
  return obj.value;
}

export async function deleteSecret(vaultSecretId: string): Promise<void> {
  await getWorkOS().vault.deleteObject({ id: vaultSecretId });
}

export async function updateSecret(
  vaultSecretId: string,
  newValue: string,
): Promise<void> {
  const obj = await getWorkOS().vault.readObject({ id: vaultSecretId });
  await getWorkOS().vault.updateObject({
    id: vaultSecretId,
    value: newValue,
    versionCheck: obj.metadata.versionId,
  });
}
