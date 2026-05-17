import { getWorkspacesCollection } from "@/lib/db/collections";
import type { WorkspaceDocument } from "@/lib/db/types";
import {
  normalizeWorkspaceAppRuntimeSettings,
  type WorkspaceAppRuntimeSettings,
} from "@/lib/workspace-app-runtime-settings";

export function normalizeWorkspaceSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function uniqueWorkspaceSlug(requestedSlug: string): Promise<string> {
  const workspacesCollection = await getWorkspacesCollection();
  const base = normalizeWorkspaceSlug(requestedSlug) || "workspace";
  let slug = base;
  let suffix = 2;

  while (true) {
    const existing = await workspacesCollection.findOne(
      {
        $or: [{ _id: slug }, { slug }],
      },
      { projection: { _id: 1 } },
    );
    if (!existing) return slug;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
}

export async function createWorkspace(input: {
  name: string;
  slug?: string;
  createdByUserId: string;
}): Promise<WorkspaceDocument> {
  const now = new Date();
  const name = input.name.trim();
  const slug = await uniqueWorkspaceSlug(input.slug ?? name);
  const workspacesCollection = await getWorkspacesCollection();
  const workspace: WorkspaceDocument = {
    _id: slug,
    name,
    slug,
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
  };

  await workspacesCollection.insertOne(workspace);

  return workspace;
}

export async function deleteWorkspaceById(workspaceId: string): Promise<void> {
  const workspacesCollection = await getWorkspacesCollection();
  await workspacesCollection.deleteOne({ _id: workspaceId });
}

export async function findWorkspaceById(
  workspaceId: string,
): Promise<WorkspaceDocument | null> {
  const workspacesCollection = await getWorkspacesCollection();
  return workspacesCollection.findOne({ _id: workspaceId });
}

export async function getWorkspaceAppRuntimeSettings(
  workspaceId: string,
): Promise<WorkspaceAppRuntimeSettings> {
  const workspacesCollection = await getWorkspacesCollection();
  const workspace = await workspacesCollection.findOne(
    { _id: workspaceId },
    { projection: { appRuntimeSettings: 1 } },
  );

  return normalizeWorkspaceAppRuntimeSettings(workspace?.appRuntimeSettings);
}

export async function updateWorkspaceAppRuntimeSettings(input: {
  workspaceId: string;
  settings: WorkspaceAppRuntimeSettings;
}): Promise<WorkspaceAppRuntimeSettings | null> {
  const workspacesCollection = await getWorkspacesCollection();
  const settings = normalizeWorkspaceAppRuntimeSettings(input.settings);
  const result = await workspacesCollection.updateOne(
    { _id: input.workspaceId },
    {
      $set: {
        appRuntimeSettings: settings,
        updatedAt: new Date(),
      },
    },
  );

  return result.matchedCount > 0 ? settings : null;
}

export async function updateWorkspaceDefaultTeam(input: {
  workspaceId: string;
  defaultTeamId: string;
}): Promise<void> {
  const workspacesCollection = await getWorkspacesCollection();
  await workspacesCollection.updateOne(
    { _id: input.workspaceId },
    {
      $set: {
        defaultTeamId: input.defaultTeamId,
        updatedAt: new Date(),
      },
    },
  );
}

export async function updateWorkspaceCompanyContext(input: {
  workspaceId: string;
  companyContext: string | null;
}): Promise<void> {
  const workspacesCollection = await getWorkspacesCollection();
  await workspacesCollection.updateOne(
    { _id: input.workspaceId },
    {
      $set: {
        companyContext: input.companyContext,
        updatedAt: new Date(),
      },
    },
  );
}

export async function updateWorkspaceExternalOrganization(input: {
  workspaceId: string;
  externalOrganizationId: string;
  externalOrganizationProvider: "workos" | string;
}): Promise<void> {
  const workspacesCollection = await getWorkspacesCollection();
  await workspacesCollection.updateOne(
    { _id: input.workspaceId },
    {
      $set: {
        externalOrganizationId: input.externalOrganizationId,
        externalOrganizationProvider: input.externalOrganizationProvider,
        updatedAt: new Date(),
      },
    },
  );
}

export async function findWorkspaceByExternalOrganizationId(input: {
  externalOrganizationId: string;
  externalOrganizationProvider?: "workos" | string;
}): Promise<WorkspaceDocument | null> {
  const workspacesCollection = await getWorkspacesCollection();
  const query: Record<string, unknown> = {
    externalOrganizationId: input.externalOrganizationId,
  };

  if (input.externalOrganizationProvider) {
    query.externalOrganizationProvider = input.externalOrganizationProvider;
  }

  return workspacesCollection.findOne(query);
}

export async function listWorkspacesByIds(
  workspaceIds: string[],
): Promise<WorkspaceDocument[]> {
  if (workspaceIds.length === 0) {
    return [];
  }

  const workspacesCollection = await getWorkspacesCollection();
  return workspacesCollection
    .find({ _id: { $in: workspaceIds } })
    .sort({ createdAt: 1 })
    .toArray();
}
