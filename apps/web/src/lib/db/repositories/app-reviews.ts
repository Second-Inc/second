import { ObjectId } from "mongodb";
import { getReviewRequestsCollection } from "@/lib/db/collections";
import { publishWorkspaceEvent } from "@/lib/events/workspace-events";
import type {
  ReviewRequestDocument,
  ReviewRequestStatus,
} from "@/lib/db/types";

export async function upsertAppReviewRequest(input: {
  workspaceId: string;
  appId: string;
  appName: string;
  requestedByUserId: string;
  requestedByUserName: string;
  targetTeamIds: string[];
}): Promise<ReviewRequestDocument> {
  const collection = await getReviewRequestsCollection();
  const now = new Date();
  const result = await collection.findOneAndUpdate(
    {
      workspaceId: input.workspaceId,
      resourceType: "app",
      resourceId: input.appId,
      status: "pending",
    },
    {
      $set: {
        resourceName: input.appName,
        requestedByUserId: input.requestedByUserId,
        requestedByUserName: input.requestedByUserName,
        requestedAt: now,
        targetTeamIds: input.targetTeamIds,
        reviewMessage: null,
        reviewerUserId: null,
        reviewerUserName: null,
        reviewedAt: null,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: new ObjectId().toHexString(),
        workspaceId: input.workspaceId,
        resourceType: "app",
        resourceId: input.appId,
        status: "pending" as const,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  if (!result) {
    throw new Error("[db] Failed to upsert app review request.");
  }

  publishWorkspaceEvent({
    type: "review.requested",
    workspaceId: input.workspaceId,
    scope: "reviews",
    appId: input.appId,
  });

  return result;
}

export async function listReviewRequestsForWorkspace(input: {
  workspaceId: string;
  status?: ReviewRequestStatus;
}): Promise<ReviewRequestDocument[]> {
  const collection = await getReviewRequestsCollection();
  return collection
    .find({
      workspaceId: input.workspaceId,
      ...(input.status ? { status: input.status } : {}),
    })
    .sort({ updatedAt: -1 })
    .toArray();
}

export async function findReviewRequestById(input: {
  workspaceId: string;
  reviewId: string;
}): Promise<ReviewRequestDocument | null> {
  const collection = await getReviewRequestsCollection();
  return collection.findOne({
    _id: input.reviewId,
    workspaceId: input.workspaceId,
  });
}

export async function findPendingAppReviewRequest(input: {
  workspaceId: string;
  appId: string;
}): Promise<ReviewRequestDocument | null> {
  const collection = await getReviewRequestsCollection();
  return collection.findOne({
    workspaceId: input.workspaceId,
    resourceType: "app",
    resourceId: input.appId,
    status: "pending",
  });
}

export async function markReviewRequestApproved(input: {
  workspaceId: string;
  reviewId: string;
  reviewerUserId: string;
  reviewerUserName: string;
}): Promise<boolean> {
  const collection = await getReviewRequestsCollection();
  const now = new Date();
  const result = await collection.updateOne(
    {
      _id: input.reviewId,
      workspaceId: input.workspaceId,
      status: "pending",
    },
    {
      $set: {
        status: "approved" as const,
        reviewerUserId: input.reviewerUserId,
        reviewerUserName: input.reviewerUserName,
        reviewedAt: now,
        updatedAt: now,
      },
    },
  );

  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "review.updated",
      workspaceId: input.workspaceId,
      scope: "reviews",
    });
  }

  return result.modifiedCount > 0;
}

export async function markReviewRequestChangesRequested(input: {
  workspaceId: string;
  reviewId: string;
  reviewerUserId: string;
  reviewerUserName: string;
  message: string;
}): Promise<void> {
  const collection = await getReviewRequestsCollection();
  const now = new Date();
  const result = await collection.updateOne(
    {
      _id: input.reviewId,
      workspaceId: input.workspaceId,
      status: "pending",
    },
    {
      $set: {
        status: "changes_requested" as const,
        reviewerUserId: input.reviewerUserId,
        reviewerUserName: input.reviewerUserName,
        reviewedAt: now,
        reviewMessage: input.message,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount > 0) {
    publishWorkspaceEvent({
      type: "review.updated",
      workspaceId: input.workspaceId,
      scope: "reviews",
    });
  }
}

export async function markPendingAppReviewRequestSuperseded(input: {
  workspaceId: string;
  appId: string;
  message: string;
}): Promise<void> {
  const collection = await getReviewRequestsCollection();
  const now = new Date();
  const result = await collection.updateOne(
    {
      workspaceId: input.workspaceId,
      resourceType: "app",
      resourceId: input.appId,
      status: "pending",
    },
    {
      $set: {
        status: "superseded" as const,
        reviewerUserId: null,
        reviewerUserName: null,
        reviewedAt: now,
        reviewMessage: input.message,
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
  }
}
