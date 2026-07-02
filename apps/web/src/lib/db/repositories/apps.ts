import { ObjectId } from "mongodb";
import {
  agentsJsonApprovalHashMatches,
  createAgentsJsonSnapshot,
  readAgentsJsonSnapshot,
} from "@/lib/agents/agents-governance";
import {
  getAppsCollection,
  getReviewRequestsCollection,
} from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import type {
  AgentsJsonApprovalSource,
  AppDocument,
  AppPublishStatus,
} from "@/lib/db/types";
import type { AgentRuntimeId } from "@/lib/agent/runtime-registry";
import {
  getAppSourceSnapshotFiles,
  upsertAppSourceSnapshot,
} from "./app-source-snapshots";

const SOURCE_FILE_WARN_SIZE_BYTES = 8 * 1024 * 1024; // 8MB warning
const SOURCE_FILE_MAX_SIZE_BYTES = 12 * 1024 * 1024; // 12MB hard fail
const SOURCE_FILE_MAX_BYTES_PER_FILE = 512 * 1024; // 512KB per file
const APP_NAME_MAX_LENGTH = 80;
const APP_DESCRIPTION_MAX_LENGTH = 300;

export class SourceFilesLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceFilesLimitError";
  }
}

export type AppDraftEditResult = {
  reviewInvalidated: boolean;
  draftCreatedFromPublished: boolean;
};

export type ApproveAppAgentsJsonResult = {
  hasAgentsJson: boolean;
  hash: string | null;
};

export type AppMetadata = Omit<
  AppDocument,
  "sourceFiles" | "publishedSourceFiles"
> & {
  hasDraftSource: boolean;
  hasPublishedVersion: boolean;
  hasUnpublishedChanges: boolean;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function hasSourceFiles(files: Record<string, string> | null | undefined): boolean {
  return !!files && Object.keys(files).length > 0;
}

function normalizeAppNameForStorage(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, APP_NAME_MAX_LENGTH).trim();
}

function normalizeAppDescriptionForStorage(
  description: string | null | undefined,
): string | null {
  const normalized = (description ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.slice(0, APP_DESCRIPTION_MAX_LENGTH).trim();
}

function appNameCandidate(baseName: string, suffix: number): string {
  if (suffix === 0) return baseName;

  const suffixText = ` (${suffix})`;
  const maxBaseLength = APP_NAME_MAX_LENGTH - suffixText.length;
  const truncatedBase = baseName.slice(0, maxBaseLength).trim();
  return `${truncatedBase}${suffixText}`;
}

async function uniqueAppNameForWorkspace(input: {
  workspaceId: string;
  name: string;
  excludeAppId?: string;
}): Promise<string> {
  const appsCollection = await getAppsCollection();
  const baseName = normalizeAppNameForStorage(input.name) || "Untitled app";

  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = appNameCandidate(baseName, suffix);
    const existing = await appsCollection.findOne(
      {
        workspaceId: input.workspaceId,
        name: candidate,
        ...(input.excludeAppId ? { _id: { $ne: input.excludeAppId } } : {}),
      },
      { projection: { _id: 1 } },
    );
    if (!existing) return candidate;
  }

  const fallbackSuffix = Date.now().toString(36).slice(-6);
  const suffixText = ` (${fallbackSuffix})`;
  return `${baseName.slice(0, APP_NAME_MAX_LENGTH - suffixText.length).trim()}${suffixText}`;
}

function hasSnapshotIdExpression(field: string) {
  return {
    $gt: [
      {
        $strLenCP: {
          $ifNull: [field, ""],
        },
      },
      0,
    ],
  };
}

function hasComputedSourceState(
  app: AppDocument | AppMetadata,
): app is AppMetadata {
  return "hasPublishedVersion" in app && typeof app.hasPublishedVersion === "boolean";
}

function hasComputedDraftState(
  app: AppDocument | AppMetadata,
): app is AppMetadata {
  return (
    "hasUnpublishedChanges" in app &&
    typeof app.hasUnpublishedChanges === "boolean"
  );
}

function sourceFilesEqual(
  left: Record<string, string> | null | undefined,
  right: Record<string, string> | null | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {});
  const rightFiles = right ?? {};
  if (leftEntries.length !== Object.keys(rightFiles).length) return false;
  return leftEntries.every(([path, content]) => rightFiles[path] === content);
}

function validateSourceFilesSnapshot(sourceFiles: Record<string, string>): void {
  let totalBytes = 0;

  for (const [path, content] of Object.entries(sourceFiles)) {
    const fileBytes = Buffer.byteLength(content, "utf-8");
    if (fileBytes > SOURCE_FILE_MAX_BYTES_PER_FILE) {
      throw new SourceFilesLimitError(
        `Cannot persist "${path}" (${formatBytes(fileBytes)}). Per-file limit is ${formatBytes(SOURCE_FILE_MAX_BYTES_PER_FILE)}.`,
      );
    }
    totalBytes += fileBytes;
    if (totalBytes > SOURCE_FILE_MAX_SIZE_BYTES) {
      throw new SourceFilesLimitError(
        `Snapshot is too large (${formatBytes(totalBytes)}). Maximum allowed is ${formatBytes(SOURCE_FILE_MAX_SIZE_BYTES)}.`,
      );
    }
  }

  if (totalBytes >= SOURCE_FILE_WARN_SIZE_BYTES) {
    console.warn(
      `[apps] sourceFiles snapshot is large (${formatBytes(totalBytes)}). Approaching hard limit ${formatBytes(SOURCE_FILE_MAX_SIZE_BYTES)}.`,
    );
  }
}

const CLEARED_AGENTS_JSON_APPROVAL_FIELDS = {
  agentsJsonApprovalHash: null,
  agentsJsonApprovedPayload: null,
  agentsJsonApprovedByUserId: null,
  agentsJsonApprovedByUserName: null,
  agentsJsonApprovedAt: null,
  agentsJsonApprovalSource: null,
} as const;

const CLEARED_PUBLISHED_AGENTS_JSON_APPROVAL_FIELDS = {
  publishedAgentsJsonApprovalHash: null,
  publishedAgentsJsonApprovedPayload: null,
  publishedAgentsJsonApprovedByUserId: null,
  publishedAgentsJsonApprovedByUserName: null,
  publishedAgentsJsonApprovedAt: null,
  publishedAgentsJsonApprovalSource: null,
} as const;

function staleAgentsJsonApprovalFields(input: {
  existingHash?: string | null;
  sourceFiles: Record<string, string>;
}): typeof CLEARED_AGENTS_JSON_APPROVAL_FIELDS | Record<string, never> {
  if (
    agentsJsonApprovalHashMatches({
      approvalHash: input.existingHash,
      sourceFiles: input.sourceFiles,
    })
  ) {
    return {};
  }
  return CLEARED_AGENTS_JSON_APPROVAL_FIELDS;
}

export async function listAppsForWorkspace(
  workspaceId: string,
): Promise<AppDocument[]> {
  const appsCollection = await getAppsCollection();

  return appsCollection
    .find({ workspaceId })
    .sort({ createdAt: -1 })
    .toArray();
}

const draftFileCountExpression = {
  $size: { $objectToArray: { $ifNull: ["$sourceFiles", {}] } },
};

const publishedFileCountExpression = {
  $size: { $objectToArray: { $ifNull: ["$publishedSourceFiles", {}] } },
};

const hasDraftSnapshotExpression = hasSnapshotIdExpression("$draftSnapshotId");
const hasPublishedSnapshotExpression =
  hasSnapshotIdExpression("$publishedSnapshotId");
const hasDraftSourceExpression = {
  $or: [hasDraftSnapshotExpression, { $gt: [draftFileCountExpression, 0] }],
};
const hasPublishedSourceSnapshotOrLegacyExpression = {
  $or: [
    hasPublishedSnapshotExpression,
    { $gt: [publishedFileCountExpression, 0] },
  ],
};

const publishStatusExpression = { $ifNull: ["$publishStatus", "published"] };

const publishedSourceForComparisonExpression = {
  $cond: [
    { $gt: [publishedFileCountExpression, 0] },
    { $ifNull: ["$publishedSourceFiles", {}] },
    {
      $cond: [
        {
          $and: [
            { $eq: [publishStatusExpression, "published"] },
            { $gt: [draftFileCountExpression, 0] },
          ],
        },
        { $ifNull: ["$sourceFiles", {}] },
        {},
      ],
    },
  ],
};

const publishedSourceForComparisonCountExpression = {
  $size: {
    $objectToArray: publishedSourceForComparisonExpression,
  },
};

const appMetadataProjection = {
  _id: 1,
  workspaceId: 1,
  name: 1,
  description: 1,
  createdByUserId: 1,
  createdAt: 1,
  updatedAt: 1,
  agentStatus: 1,
  publishedSourceFilesUpdatedAt: 1,
  agentsJsonApprovalHash: 1,
  agentsJsonApprovedPayload: 1,
  agentsJsonApprovedByUserId: 1,
  agentsJsonApprovedByUserName: 1,
  agentsJsonApprovedAt: 1,
  agentsJsonApprovalSource: 1,
  publishedAgentsJsonApprovalHash: 1,
  publishedAgentsJsonApprovedPayload: 1,
  publishedAgentsJsonApprovedByUserId: 1,
  publishedAgentsJsonApprovedByUserName: 1,
  publishedAgentsJsonApprovedAt: 1,
  publishedAgentsJsonApprovalSource: 1,
  prompt: 1,
  runtimeId: 1,
  runtimeModel: 1,
  runtimeParams: 1,
  collaboratorUserIds: 1,
  visibility: 1,
  teamIds: 1,
  publishStatus: 1,
  reviewRequestedByUserId: 1,
  reviewRequestedByUserName: 1,
  reviewRequestedAt: 1,
  publishedByUserId: 1,
  publishedAt: 1,
  changeRequestMessage: 1,
  changeRequestedByUserId: 1,
  changeRequestedAt: 1,
  sourceControl: 1,
  draftSnapshotId: 1,
  draftSourceUpdatedAt: 1,
  draftSourceSizeBytes: 1,
  draftSourceHash: 1,
  draftHasPreviewArtifact: 1,
  publishedSnapshotId: 1,
  publishedSourceSizeBytes: 1,
  publishedSourceHash: 1,
  publishedHasPreviewArtifact: 1,
  hasDraftSource: hasDraftSourceExpression,
  hasPublishedVersion: {
    $or: [
      hasPublishedSourceSnapshotOrLegacyExpression,
      {
        $and: [
          { $eq: [publishStatusExpression, "published"] },
          hasDraftSourceExpression,
        ],
      },
    ],
  },
  hasUnpublishedChanges: {
    $cond: [
      { $not: [hasDraftSourceExpression] },
      false,
      {
        $cond: [
          {
            $and: [
              { $ne: [{ $ifNull: ["$draftSourceHash", null] }, null] },
              { $ne: [{ $ifNull: ["$publishedSourceHash", null] }, null] },
            ],
          },
          {
            $ne: [
              { $ifNull: ["$draftSourceHash", null] },
              { $ifNull: ["$publishedSourceHash", null] },
            ],
          },
          {
            $cond: [
              { $eq: [publishedSourceForComparisonCountExpression, 0] },
              true,
              {
                $ne: [
                  { $ifNull: ["$sourceFiles", {}] },
                  publishedSourceForComparisonExpression,
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

export async function listAppMetadataForWorkspace(
  workspaceId: string,
): Promise<AppMetadata[]> {
  const appsCollection = await getAppsCollection();

  return appsCollection
    .aggregate<AppMetadata>([
      { $match: { workspaceId } },
      { $sort: { createdAt: -1 } },
      { $project: appMetadataProjection },
    ])
    .toArray();
}

export async function listAppSidebarMetadataForWorkspace(
  workspaceId: string,
): Promise<AppMetadata[]> {
  return listAppMetadataForWorkspace(workspaceId);
}

export async function findAppAccessMetadata(input: {
  workspaceId: string;
  appId: string;
}): Promise<AppMetadata | null> {
  const appsCollection = await getAppsCollection();
  const [app] = await appsCollection
    .aggregate<AppMetadata>([
      { $match: { _id: input.appId, workspaceId: input.workspaceId } },
      { $limit: 1 },
      { $project: appMetadataProjection },
    ])
    .toArray();

  return app ?? null;
}

export async function findAppPageMetadata(input: {
  workspaceId: string;
  appId: string;
}): Promise<AppMetadata | null> {
  return findAppAccessMetadata(input);
}

export function getAppPublishStatus(app: AppDocument): AppPublishStatus {
  return app.publishStatus ?? "published";
}

export function getAppPublishedSourceFiles(
  app: AppDocument,
): Record<string, string> | null {
  if (hasSourceFiles(app.publishedSourceFiles)) {
    return app.publishedSourceFiles ?? null;
  }
  if (getAppPublishStatus(app) === "published" && hasSourceFiles(app.sourceFiles)) {
    return app.sourceFiles ?? null;
  }
  return null;
}

export function appHasPublishedVersion(
  app: AppDocument | AppMetadata,
): boolean {
  if (hasComputedSourceState(app)) {
    return app.hasPublishedVersion;
  }
  if (app.publishedSnapshotId) return true;
  if (getAppPublishStatus(app as AppDocument) === "published" && app.draftSnapshotId) {
    return true;
  }
  return hasSourceFiles(getAppPublishedSourceFiles(app as AppDocument));
}

export function appHasUnpublishedChanges(
  app: AppDocument | AppMetadata,
): boolean {
  if (hasComputedDraftState(app)) {
    return app.hasUnpublishedChanges;
  }
  const fullApp = app as AppDocument;
  if (fullApp.draftSourceHash && fullApp.publishedSourceHash) {
    return fullApp.draftSourceHash !== fullApp.publishedSourceHash;
  }
  if (fullApp.draftSnapshotId && !fullApp.publishedSnapshotId) {
    return true;
  }
  const draftFiles = fullApp.sourceFiles ?? null;
  const publishedFiles = getAppPublishedSourceFiles(fullApp);
  if (!hasSourceFiles(draftFiles)) return false;
  if (!hasSourceFiles(publishedFiles)) return true;
  return !sourceFilesEqual(draftFiles, publishedFiles);
}

export async function createAppForWorkspace(input: {
  workspaceId: string;
  name: string;
  createdByUserId: string;
  prompt?: string;
  runtimeId: AgentRuntimeId;
  runtimeModel: string;
  runtimeParams: Record<string, string>;
}): Promise<AppDocument> {
  const [appsCollection, uniqueName] = await Promise.all([
    getAppsCollection(),
    uniqueAppNameForWorkspace({
      workspaceId: input.workspaceId,
      name: input.name,
    }),
  ]);
  const now = new Date();
  const app: AppDocument = {
    _id: new ObjectId().toHexString(),
    workspaceId: input.workspaceId,
    name: uniqueName,
    description: null,
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
    visibility: "teams",
    teamIds: [],
    publishStatus: "draft",
    reviewRequestedByUserId: null,
    reviewRequestedByUserName: null,
    reviewRequestedAt: null,
    publishedByUserId: null,
    publishedAt: null,
    agentsJsonApprovalHash: null,
    agentsJsonApprovedPayload: null,
    agentsJsonApprovedByUserId: null,
    agentsJsonApprovedByUserName: null,
    agentsJsonApprovedAt: null,
    agentsJsonApprovalSource: null,
    publishedAgentsJsonApprovalHash: null,
    publishedAgentsJsonApprovedPayload: null,
    publishedAgentsJsonApprovedByUserId: null,
    publishedAgentsJsonApprovedByUserName: null,
    publishedAgentsJsonApprovedAt: null,
    publishedAgentsJsonApprovalSource: null,
    draftSnapshotId: null,
    draftSourceUpdatedAt: null,
    draftSourceSizeBytes: null,
    draftSourceHash: null,
    draftHasPreviewArtifact: null,
    publishedSnapshotId: null,
    publishedSourceFilesUpdatedAt: null,
    publishedSourceSizeBytes: null,
    publishedSourceHash: null,
    publishedHasPreviewArtifact: null,
    changeRequestMessage: null,
    changeRequestedByUserId: null,
    changeRequestedAt: null,
    ...(input.prompt ? { prompt: input.prompt } : {}),
    runtimeId: input.runtimeId,
    runtimeModel: input.runtimeModel,
    runtimeParams: input.runtimeParams,
    collaboratorUserIds: [],
    sourceControl: null,
  };

  await appsCollection.insertOne(app);
  publishWorkspaceEvent({
    type: "app.created",
    workspaceId: input.workspaceId,
    scope: "apps",
    appId: app._id,
  });

  return app;
}

export async function requestAppReview(input: {
  workspaceId: string;
  appId: string;
  teamIds: string[];
  requestedByUserId: string;
  requestedByUserName: string;
}): Promise<void> {
  const appsCollection = await getAppsCollection();
  const now = new Date();
  const app = await appsCollection.findOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    {
      projection: {
        publishStatus: 1,
        publishedAt: 1,
        draftSnapshotId: 1,
        draftSourceUpdatedAt: 1,
        draftSourceSizeBytes: 1,
        draftSourceHash: 1,
        draftHasPreviewArtifact: 1,
        publishedSnapshotId: 1,
        publishedSourceFiles: 1,
        publishedSourceHash: 1,
        sourceFiles: 1,
      },
    },
  );
  const shouldPreserveLegacyPublishedSnapshot =
    app &&
    getAppPublishStatus(app) === "published" &&
    !app.publishedSnapshotId &&
    !hasSourceFiles(app.publishedSourceFiles) &&
    hasSourceFiles(app.sourceFiles);
  const shouldApplyRequestedTeamsToApp =
    app ? !appHasPublishedVersion(app) : false;
  const preserveDraftAsPublishedSnapshot =
    app &&
    getAppPublishStatus(app) === "published" &&
    app.draftSnapshotId &&
    !app.publishedSnapshotId;
  const preservedPublishedSnapshot = preserveDraftAsPublishedSnapshot
    ? await (async () => {
        const draftFiles = await getAppSourceSnapshotFiles({
          workspaceId: input.workspaceId,
          appId: input.appId,
          kind: "draft",
        });
        return draftFiles
          ? upsertAppSourceSnapshot({
              workspaceId: input.workspaceId,
              appId: input.appId,
              kind: "published",
              files: draftFiles,
            })
          : null;
      })()
    : null;

  const result = await appsCollection.updateOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    {
      $set: {
        ...(shouldApplyRequestedTeamsToApp
          ? {
              visibility: "teams",
              teamIds: input.teamIds,
            }
          : {}),
        publishStatus: "review_requested" as const,
        ...(preservedPublishedSnapshot
          ? {
              publishedSnapshotId: preservedPublishedSnapshot._id,
              publishedSourceFilesUpdatedAt:
                app?.publishedAt ?? preservedPublishedSnapshot.updatedAt,
              publishedSourceSizeBytes: preservedPublishedSnapshot.sizeBytes,
              publishedSourceHash: preservedPublishedSnapshot.hash,
              publishedHasPreviewArtifact:
                preservedPublishedSnapshot.hasPreviewArtifact,
            }
          : {}),
        ...(shouldPreserveLegacyPublishedSnapshot
          ? {
            publishedSourceFiles: app.sourceFiles,
            publishedSourceFilesUpdatedAt: app.publishedAt ?? now,
          }
          : {}),
        reviewRequestedByUserId: input.requestedByUserId,
        reviewRequestedByUserName: input.requestedByUserName,
        reviewRequestedAt: now,
        changeRequestMessage: null,
        changeRequestedByUserId: null,
        changeRequestedAt: null,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "review.requested",
      workspaceId: input.workspaceId,
      scope: "reviews",
      appId: input.appId,
    });
    publishWorkspaceEvent({
      type: "app.updated",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }
}

export async function publishApp(input: {
  workspaceId: string;
  appId: string;
  teamIds: string[];
  publishedByUserId: string;
}): Promise<void> {
  const appsCollection = await getAppsCollection();
  const now = new Date();
  const app = await appsCollection.findOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    {
      projection: {
        agentsJsonApprovalHash: 1,
        agentsJsonApprovedPayload: 1,
        agentsJsonApprovedByUserId: 1,
        agentsJsonApprovedByUserName: 1,
        agentsJsonApprovedAt: 1,
        agentsJsonApprovalSource: 1,
      },
    },
  );
  if (!app) return;

  const sourceFiles = await getAppSourceFiles({
    workspaceId: input.workspaceId,
    appId: input.appId,
  });
  const publishedSnapshot = sourceFiles
    ? await upsertAppSourceSnapshot({
        workspaceId: input.workspaceId,
        appId: input.appId,
        kind: "published",
        files: sourceFiles,
      })
    : null;
  const result = await appsCollection.updateOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    {
      $set: {
        visibility: "teams",
        teamIds: input.teamIds,
        publishStatus: "published" as const,
        ...(publishedSnapshot
          ? {
              publishedSnapshotId: publishedSnapshot._id,
              publishedSourceFilesUpdatedAt: publishedSnapshot.updatedAt,
              publishedSourceSizeBytes: publishedSnapshot.sizeBytes,
              publishedSourceHash: publishedSnapshot.hash,
              publishedHasPreviewArtifact: publishedSnapshot.hasPreviewArtifact,
            }
          : {}),
        publishedAgentsJsonApprovalHash: app.agentsJsonApprovalHash ?? null,
        publishedAgentsJsonApprovedPayload: app.agentsJsonApprovedPayload ?? null,
        publishedAgentsJsonApprovedByUserId: app.agentsJsonApprovedByUserId ?? null,
        publishedAgentsJsonApprovedByUserName:
          app.agentsJsonApprovedByUserName ?? null,
        publishedAgentsJsonApprovedAt: app.agentsJsonApprovedAt ?? null,
        publishedAgentsJsonApprovalSource: app.agentsJsonApprovalSource ?? null,
        publishedByUserId: input.publishedByUserId,
        publishedAt: now,
        changeRequestMessage: null,
        changeRequestedByUserId: null,
        changeRequestedAt: null,
        updatedAt: now,
      },
      ...(publishedSnapshot ? { $unset: { publishedSourceFiles: "" } } : {}),
    },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "app.published",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }
}

export async function publishReviewRequestedApp(input: {
  workspaceId: string;
  appId: string;
  teamIds: string[];
  publishedByUserId: string;
  approvedByUserId: string;
  approvedByUserName: string;
  approvalSource: AgentsJsonApprovalSource;
}): Promise<boolean> {
  const appsCollection = await getAppsCollection();
  const now = new Date();
  const app = await appsCollection.findOne(
    {
      _id: input.appId,
      workspaceId: input.workspaceId,
      publishStatus: "review_requested",
    },
    { projection: { updatedAt: 1 } },
  );
  if (!app) return false;

  const sourceFiles = await getAppSourceFiles({
    workspaceId: input.workspaceId,
    appId: input.appId,
  });
  const snapshot = readAgentsJsonSnapshot(sourceFiles);
  const publishedSnapshot = sourceFiles
    ? await upsertAppSourceSnapshot({
        workspaceId: input.workspaceId,
        appId: input.appId,
        kind: "published",
        files: sourceFiles,
      })
    : null;
  const approvalFields = snapshot
    ? {
        agentsJsonApprovalHash: snapshot.hash,
        agentsJsonApprovedPayload: snapshot.payload,
        agentsJsonApprovedByUserId: input.approvedByUserId,
        agentsJsonApprovedByUserName: input.approvedByUserName,
        agentsJsonApprovedAt: now,
        agentsJsonApprovalSource: input.approvalSource,
      }
    : CLEARED_AGENTS_JSON_APPROVAL_FIELDS;
  const publishedApprovalFields = snapshot
    ? {
        publishedAgentsJsonApprovalHash: snapshot.hash,
        publishedAgentsJsonApprovedPayload: snapshot.payload,
        publishedAgentsJsonApprovedByUserId: input.approvedByUserId,
        publishedAgentsJsonApprovedByUserName: input.approvedByUserName,
        publishedAgentsJsonApprovedAt: now,
        publishedAgentsJsonApprovalSource: input.approvalSource,
      }
    : CLEARED_PUBLISHED_AGENTS_JSON_APPROVAL_FIELDS;
  const result = await appsCollection.updateOne(
    {
      _id: input.appId,
      workspaceId: input.workspaceId,
      publishStatus: "review_requested",
      updatedAt: app.updatedAt,
    },
    {
      $set: {
        visibility: "teams",
        teamIds: input.teamIds,
        publishStatus: "published" as const,
        ...(publishedSnapshot
          ? {
              publishedSnapshotId: publishedSnapshot._id,
              publishedSourceFilesUpdatedAt: publishedSnapshot.updatedAt,
              publishedSourceSizeBytes: publishedSnapshot.sizeBytes,
              publishedSourceHash: publishedSnapshot.hash,
              publishedHasPreviewArtifact: publishedSnapshot.hasPreviewArtifact,
            }
          : {
              publishedSourceFilesUpdatedAt: now,
            }),
        ...approvalFields,
        ...publishedApprovalFields,
        publishedByUserId: input.publishedByUserId,
        publishedAt: now,
        changeRequestMessage: null,
        changeRequestedByUserId: null,
        changeRequestedAt: null,
        updatedAt: now,
      },
      ...(publishedSnapshot ? { $unset: { publishedSourceFiles: "" } } : {}),
    },
  );

  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "app.published",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
    publishWorkspaceEvent({
      type: "review.updated",
      workspaceId: input.workspaceId,
      scope: "reviews",
      appId: input.appId,
    });
  }

  return result.modifiedCount > 0;
}

export async function requestAppChanges(input: {
  workspaceId: string;
  appId: string;
  message: string;
  reviewerUserId: string;
}): Promise<boolean> {
  const appsCollection = await getAppsCollection();
  const now = new Date();
  const result = await appsCollection.updateOne(
    {
      _id: input.appId,
      workspaceId: input.workspaceId,
      publishStatus: "review_requested",
    },
    {
      $set: {
        publishStatus: "changes_requested" as const,
        changeRequestMessage: input.message,
        changeRequestedByUserId: input.reviewerUserId,
        changeRequestedAt: now,
        updatedAt: now,
      },
    },
  );

  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "review.updated",
      workspaceId: input.workspaceId,
      scope: "reviews",
      appId: input.appId,
    });
    publishWorkspaceEvent({
      type: "app.updated",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }

  return result.modifiedCount > 0;
}

export async function markAppDraftEdited(input: {
  workspaceId: string;
  appId: string;
}): Promise<AppDraftEditResult> {
  const appsCollection = await getAppsCollection();
  const app = await appsCollection.findOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    {
      projection: {
        publishStatus: 1,
        publishedAt: 1,
        draftSnapshotId: 1,
        draftSourceUpdatedAt: 1,
        draftSourceSizeBytes: 1,
        draftSourceHash: 1,
        draftHasPreviewArtifact: 1,
        publishedSnapshotId: 1,
        publishedSourceFiles: 1,
        sourceFiles: 1,
      },
    },
  );

  if (!app) {
    return { reviewInvalidated: false, draftCreatedFromPublished: false };
  }

  const publishStatus = getAppPublishStatus(app);
  const preservePublishedSnapshot =
    !app.publishedSnapshotId &&
    !hasSourceFiles(app.publishedSourceFiles) &&
    publishStatus === "published" &&
    hasSourceFiles(app.sourceFiles);
  const preserveDraftSnapshotAsPublished =
    !app.publishedSnapshotId &&
    publishStatus === "published" &&
    Boolean(app.draftSnapshotId);
  const preservedPublishedSnapshot = preserveDraftSnapshotAsPublished
    ? await (async () => {
        const draftFiles = await getAppSourceSnapshotFiles({
          workspaceId: input.workspaceId,
          appId: input.appId,
          kind: "draft",
        });
        return draftFiles
          ? upsertAppSourceSnapshot({
              workspaceId: input.workspaceId,
              appId: input.appId,
              kind: "published",
              files: draftFiles,
            })
          : null;
      })()
    : null;
  const shouldMoveToDraft =
    publishStatus === "published" || publishStatus === "review_requested";

  if (!preservePublishedSnapshot && !shouldMoveToDraft) {
    return { reviewInvalidated: false, draftCreatedFromPublished: false };
  }

  const now = new Date();
  const result = await appsCollection.updateOne(
    {
      _id: input.appId,
      workspaceId: input.workspaceId,
      ...(app.publishStatus === undefined
        ? {
            $or: [
              { publishStatus: "published" },
              { publishStatus: { $exists: false } },
            ],
          }
        : { publishStatus: app.publishStatus }),
    },
    {
      $set: {
        ...(preservePublishedSnapshot
          ? {
              publishedSourceFiles: app.sourceFiles,
              publishedSourceFilesUpdatedAt: app.publishedAt ?? now,
            }
          : {}),
        ...(preservedPublishedSnapshot
          ? {
              publishedSnapshotId: preservedPublishedSnapshot._id,
              publishedSourceFilesUpdatedAt:
                app.publishedAt ?? preservedPublishedSnapshot.updatedAt,
              publishedSourceSizeBytes: preservedPublishedSnapshot.sizeBytes,
              publishedSourceHash: preservedPublishedSnapshot.hash,
              publishedHasPreviewArtifact:
                preservedPublishedSnapshot.hasPreviewArtifact,
            }
          : {}),
        ...(shouldMoveToDraft
          ? {
              publishStatus: "draft" as const,
              reviewRequestedByUserId: null,
              reviewRequestedByUserName: null,
              reviewRequestedAt: null,
              changeRequestMessage: null,
              changeRequestedByUserId: null,
              changeRequestedAt: null,
            }
          : {}),
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount === 0) {
    return { reviewInvalidated: false, draftCreatedFromPublished: false };
  }

  publishWorkspaceEvent({
    type: "app.updated",
    workspaceId: input.workspaceId,
    scope: "apps",
    appId: input.appId,
  });
  if (publishStatus === "review_requested") {
    publishWorkspaceEvent({
      type: "review.updated",
      workspaceId: input.workspaceId,
      scope: "reviews",
      appId: input.appId,
    });
  }

  return {
    reviewInvalidated: publishStatus === "review_requested",
    draftCreatedFromPublished: publishStatus === "published",
  };
}

export async function markReviewRequestedAppAsDraft(input: {
  workspaceId: string;
  appId: string;
}): Promise<boolean> {
  const appsCollection = await getAppsCollection();
  const result = await appsCollection.updateOne(
    {
      _id: input.appId,
      workspaceId: input.workspaceId,
      publishStatus: "review_requested",
    },
    {
      $set: {
        publishStatus: "draft" as const,
        reviewRequestedByUserId: null,
        reviewRequestedByUserName: null,
        reviewRequestedAt: null,
        changeRequestMessage: null,
        changeRequestedByUserId: null,
        changeRequestedAt: null,
        updatedAt: new Date(),
      },
    },
  );

  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "review.updated",
      workspaceId: input.workspaceId,
      scope: "reviews",
      appId: input.appId,
    });
    publishWorkspaceEvent({
      type: "app.updated",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }

  return result.modifiedCount > 0;
}

export async function updateAppSettings(input: {
  workspaceId: string;
  appId: string;
  runtimeId: AgentRuntimeId;
  runtimeModel: string;
  runtimeParams: Record<string, string>;
}): Promise<void> {
  const appsCollection = await getAppsCollection();
  const result = await appsCollection.updateOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    {
      $set: {
        runtimeId: input.runtimeId,
        runtimeModel: input.runtimeModel,
        runtimeParams: input.runtimeParams,
        updatedAt: new Date(),
      },
    },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "app.updated",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }
}

export async function updateAppCollaboratorUserIds(input: {
  workspaceId: string;
  appId: string;
  collaboratorUserIds: string[];
}): Promise<void> {
  const appsCollection = await getAppsCollection();
  const result = await appsCollection.updateOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    {
      $set: {
        collaboratorUserIds: input.collaboratorUserIds,
        updatedAt: new Date(),
      },
    },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "app.updated",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }
}

export async function findAppById(input: {
  workspaceId: string;
  appId: string;
}): Promise<AppDocument | null> {
  const appsCollection = await getAppsCollection();

  return appsCollection.findOne(
    {
      _id: input.appId,
      workspaceId: input.workspaceId,
    },
    {
      projection: {
        sourceFiles: 0,
        publishedSourceFiles: 0,
      },
    },
  );
}

export async function updateAppName(input: {
  workspaceId: string;
  appId: string;
  name: string;
}): Promise<string> {
  const appsCollection = await getAppsCollection();
  const name = await uniqueAppNameForWorkspace({
    workspaceId: input.workspaceId,
    name: input.name,
    excludeAppId: input.appId,
  });
  const result = await appsCollection.updateOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    { $set: { name, updatedAt: new Date() } },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "app.updated",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }
  return name;
}

export async function updateAppGeneratedMetadata(input: {
  workspaceId: string;
  appId: string;
  name: string;
  description?: string | null;
}): Promise<{ name: string; description: string | null } | null> {
  const appsCollection = await getAppsCollection();
  const name = await uniqueAppNameForWorkspace({
    workspaceId: input.workspaceId,
    name: input.name,
    excludeAppId: input.appId,
  });
  const description = normalizeAppDescriptionForStorage(input.description);
  const now = new Date();
  const result = await appsCollection.updateOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    {
      $set: {
        name,
        description,
        updatedAt: now,
      },
    },
  );

  if (result.matchedCount === 0) return null;

  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "app.updated",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });

    const reviewRequestsCollection = await getReviewRequestsCollection();
    const reviewResult = await reviewRequestsCollection.updateOne(
      {
        workspaceId: input.workspaceId,
        resourceType: "app",
        resourceId: input.appId,
        status: "pending",
      },
      {
        $set: {
          resourceName: name,
          updatedAt: now,
        },
      },
    );
    if (reviewResult.modifiedCount > 0) {
      publishWorkspaceEvent({
        type: "review.updated",
        workspaceId: input.workspaceId,
        scope: "reviews",
        appId: input.appId,
      });
    }
  }

  return { name, description };
}

export async function deleteApp(input: {
  workspaceId: string;
  appId: string;
}): Promise<void> {
  const appsCollection = await getAppsCollection();
  const result = await appsCollection.deleteOne({
    _id: input.appId,
    workspaceId: input.workspaceId,
  });
  if (result.deletedCount > 0) {
    publishWorkspaceEvent({
      type: "app.deleted",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }
}

export async function saveAppSourceFiles(input: {
  workspaceId: string;
  appId: string;
  sourceFiles: Record<string, string>;
}): Promise<void> {
  validateSourceFilesSnapshot(input.sourceFiles);
  await markAppDraftEdited({
    workspaceId: input.workspaceId,
    appId: input.appId,
  });
  const snapshot = await upsertAppSourceSnapshot({
    workspaceId: input.workspaceId,
    appId: input.appId,
    kind: "draft",
    files: input.sourceFiles,
  });
  const appsCollection = await getAppsCollection();
  const app = await appsCollection.findOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    { projection: { agentsJsonApprovalHash: 1 } },
  );
  const approvalFields = staleAgentsJsonApprovalFields({
    existingHash: app?.agentsJsonApprovalHash ?? null,
    sourceFiles: input.sourceFiles,
  });
  const result = await appsCollection.updateOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    {
      $set: {
        draftSnapshotId: snapshot._id,
        draftSourceUpdatedAt: snapshot.updatedAt,
        draftSourceSizeBytes: snapshot.sizeBytes,
        draftSourceHash: snapshot.hash,
        draftHasPreviewArtifact: snapshot.hasPreviewArtifact,
        ...approvalFields,
        updatedAt: new Date(),
      },
      $unset: {
        sourceFiles: "",
      },
    },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "app.updated",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }
}

export async function approveCurrentAppAgentsJson(input: {
  workspaceId: string;
  appId: string;
  approvedByUserId: string;
  approvedByUserName: string;
  source: AgentsJsonApprovalSource;
}): Promise<ApproveAppAgentsJsonResult> {
  const appsCollection = await getAppsCollection();
  const app = await appsCollection.findOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    { projection: { _id: 1 } },
  );

  if (!app) {
    return { hasAgentsJson: false, hash: null };
  }

  const sourceFiles = await getAppSourceFiles({
    workspaceId: input.workspaceId,
    appId: input.appId,
  });
  const snapshot = readAgentsJsonSnapshot(sourceFiles);
  const now = new Date();
  if (!snapshot) {
    const result = await appsCollection.updateOne(
      { _id: input.appId, workspaceId: input.workspaceId },
      {
        $set: {
          ...CLEARED_AGENTS_JSON_APPROVAL_FIELDS,
          updatedAt: now,
        },
      },
    );
    if (result.modifiedCount > 0) {
      publishWorkspaceEvent({
        type: "app.updated",
        workspaceId: input.workspaceId,
        scope: "apps",
        appId: input.appId,
      });
    }
    return { hasAgentsJson: false, hash: null };
  }

  const result = await appsCollection.updateOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    {
      $set: {
        agentsJsonApprovalHash: snapshot.hash,
        agentsJsonApprovedPayload: snapshot.payload,
        agentsJsonApprovedByUserId: input.approvedByUserId,
        agentsJsonApprovedByUserName: input.approvedByUserName,
        agentsJsonApprovedAt: now,
        agentsJsonApprovalSource: input.source,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "app.updated",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }

  return { hasAgentsJson: true, hash: snapshot.hash };
}

export async function approveAppAgentsJsonPayload(input: {
  workspaceId: string;
  appId: string;
  payload: unknown;
  approvedByUserId: string;
  approvedByUserName: string;
  source: AgentsJsonApprovalSource;
}): Promise<ApproveAppAgentsJsonResult> {
  const snapshot = createAgentsJsonSnapshot(input.payload);
  const appsCollection = await getAppsCollection();
  const now = new Date();
  const result = await appsCollection.updateOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    {
      $set: {
        agentsJsonApprovalHash: snapshot.hash,
        agentsJsonApprovedPayload: snapshot.payload,
        agentsJsonApprovedByUserId: input.approvedByUserId,
        agentsJsonApprovedByUserName: input.approvedByUserName,
        agentsJsonApprovedAt: now,
        agentsJsonApprovalSource: input.source,
        updatedAt: now,
      },
    },
  );

  if (result.matchedCount === 0) {
    return { hasAgentsJson: false, hash: null };
  }

  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "app.updated",
      workspaceId: input.workspaceId,
      scope: "apps",
      appId: input.appId,
    });
  }

  return { hasAgentsJson: true, hash: snapshot.hash };
}

export async function getAppSourceFiles(input: {
  workspaceId: string;
  appId: string;
}): Promise<Record<string, string> | null> {
  const appsCollection = await getAppsCollection();
  const app = await appsCollection.findOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    { projection: { draftSnapshotId: 1, sourceFiles: 1 } },
  );
  if (!app) return null;
  if (app.draftSnapshotId) {
    return getAppSourceSnapshotFiles({
      workspaceId: input.workspaceId,
      appId: input.appId,
      kind: "draft",
    });
  }
  return app?.sourceFiles ?? null;
}

export async function getAppSourceFilesForVersion(input: {
  workspaceId: string;
  appId: string;
  version: "draft" | "published";
}): Promise<Record<string, string> | null> {
  const appsCollection = await getAppsCollection();
  const app = await appsCollection.findOne(
    { _id: input.appId, workspaceId: input.workspaceId },
    {
      projection: {
        draftSnapshotId: 1,
        publishedSnapshotId: 1,
        sourceFiles: 1,
        publishedSourceFiles: 1,
        publishStatus: 1,
      },
    },
  );
  if (!app) return null;
  if (input.version === "draft" && app.draftSnapshotId) {
    return getAppSourceSnapshotFiles({
      workspaceId: input.workspaceId,
      appId: input.appId,
      kind: "draft",
    });
  }
  if (input.version === "published" && app.publishedSnapshotId) {
    return getAppSourceSnapshotFiles({
      workspaceId: input.workspaceId,
      appId: input.appId,
      kind: "published",
    });
  }
  return input.version === "published"
    ? getAppPublishedSourceFiles(app)
    : (app.sourceFiles ?? null);
}
