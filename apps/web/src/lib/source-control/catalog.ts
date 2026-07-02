import {
  findInstalledSourceControlApp,
  getValidSourceControlConnection,
} from "@/lib/db";
import { readSourceControlCredential } from "@/lib/source-control/credential-store";
import { getSourceControlProvider } from "@/lib/source-control";
import type { SourceControlCatalogItem } from "@/lib/source-control/types";

export type AvailableSourceControlApp = SourceControlCatalogItem & {
  installStatus: "available" | "installed" | "update_available";
  installedAppId: string | null;
};

export async function listAvailableSourceControlApps(input: {
  workspaceId: string;
}): Promise<{
  connected: boolean;
  apps: AvailableSourceControlApp[];
}> {
  const connection = await getValidSourceControlConnection({
    workspaceId: input.workspaceId,
    provider: "github",
  });
  if (!connection) {
    return { connected: false, apps: [] };
  }
  const token = await readSourceControlCredential(connection.credentialRef);
  const provider = getSourceControlProvider(connection.provider);
  const catalog = await provider.listSecondApps({
    auth: { token },
    connection,
  });
  const apps = await Promise.all(
    catalog.map(async (item): Promise<AvailableSourceControlApp> => {
      const installed = await findInstalledSourceControlApp({
        workspaceId: input.workspaceId,
        provider: item.provider,
        owner: item.owner,
        repo: item.repo,
      });
      const installedFrom = installed?.sourceControl?.installedFrom;
      const matchesInstalledFrom =
        installedFrom?.provider === item.provider &&
        installedFrom.owner === item.owner &&
        installedFrom.repo === item.repo;
      const installedVersion =
        installedFrom?.version ?? installed?.sourceControl?.version ?? null;
      const installStatus = !installed
        ? "available"
        : !matchesInstalledFrom
          ? "installed"
        : item.version && installedVersion && item.version > installedVersion
          ? "update_available"
          : item.sourceHash &&
              installedFrom?.sourceHash &&
              item.sourceHash !== installedFrom.sourceHash
            ? "update_available"
            : "installed";
      return {
        ...item,
        installStatus,
        installedAppId: installed?._id ?? null,
      };
    }),
  );

  return { connected: true, apps };
}
