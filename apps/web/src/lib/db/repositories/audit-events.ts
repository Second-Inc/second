import { ObjectId, type Filter } from "mongodb";
import { getAuditEventsCollection } from "@/lib/db/collections";
import type {
  AuditEventCategory,
  AuditEventDocument,
  AuditEventOutcome,
  AuditTargetType,
} from "@/lib/db/types";

export type CreateAuditEventInput = Omit<AuditEventDocument, "_id"> & {
  _id?: string;
};

export type ListAuditEventsInput = {
  workspaceId: string;
  limit?: number;
  before?: Date;
  since?: Date;
  until?: Date;
  category?: AuditEventCategory;
  outcome?: AuditEventOutcome;
  actorUserId?: string;
  sourceAppId?: string;
  eventName?: string;
  targetType?: AuditTargetType;
  targetId?: string;
  query?: string;
};

export type AuditEventsSummary = {
  total: number;
  trusted: number;
  denied: number;
  byCategory: Partial<Record<AuditEventCategory, number>>;
  byOutcome: Partial<Record<AuditEventOutcome, number>>;
};

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return 100;
  return Math.min(Math.max(Math.floor(limit), 1), 200);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAuditEventsFilter(
  input: ListAuditEventsInput,
): Filter<AuditEventDocument> {
  const filter: Filter<AuditEventDocument> = {
    workspaceId: input.workspaceId,
  };

  const occurredAt: Record<string, Date> = {};
  if (input.before) occurredAt.$lt = input.before;
  if (input.since) occurredAt.$gte = input.since;
  if (input.until) occurredAt.$lte = input.until;
  if (Object.keys(occurredAt).length > 0) {
    filter.occurredAt = occurredAt;
  }

  if (input.category) filter.category = input.category;
  if (input.outcome) filter.outcome = input.outcome;
  if (input.actorUserId) filter["actor.userId"] = input.actorUserId;
  if (input.sourceAppId) filter["source.appId"] = input.sourceAppId;
  if (input.eventName) filter.eventName = input.eventName;
  if (input.targetType) filter["target.type"] = input.targetType;
  if (input.targetId) filter["target.id"] = input.targetId;

  const query = input.query?.trim();
  if (query) {
    const regex = new RegExp(escapeRegex(query).slice(0, 120), "i");
    filter.$or = [
      { eventName: regex },
      { summary: regex },
      { action: regex },
      { "actor.displayName": regex },
      { "actor.email": regex },
      { "actor.agentName": regex },
      { "source.appName": regex },
      { "target.name": regex },
      { "target.id": regex },
    ];
  }

  return filter;
}

export async function insertAuditEvent(
  input: CreateAuditEventInput,
): Promise<AuditEventDocument> {
  const collection = await getAuditEventsCollection();
  const doc: AuditEventDocument = {
    _id: input._id ?? new ObjectId().toHexString(),
    ...input,
  };
  await collection.insertOne(doc);
  return doc;
}

export async function listAuditEvents(
  input: ListAuditEventsInput,
): Promise<AuditEventDocument[]> {
  const collection = await getAuditEventsCollection();
  return collection
    .find(buildAuditEventsFilter(input))
    .sort({ occurredAt: -1, _id: -1 })
    .limit(clampLimit(input.limit))
    .toArray();
}

export async function findAuditEventById(input: {
  workspaceId: string;
  eventId: string;
}): Promise<AuditEventDocument | null> {
  const collection = await getAuditEventsCollection();
  return collection.findOne({
    _id: input.eventId,
    workspaceId: input.workspaceId,
  });
}

export async function summarizeAuditEvents(input: {
  workspaceId: string;
  since: Date;
  until?: Date;
}): Promise<AuditEventsSummary> {
  const collection = await getAuditEventsCollection();
  const timeFilter: Record<string, Date> = { $gte: input.since };
  if (input.until) timeFilter.$lte = input.until;

  const baseFilter: Filter<AuditEventDocument> = {
    workspaceId: input.workspaceId,
    occurredAt: timeFilter,
  };

  const [total, trusted, denied, categoryRows, outcomeRows] = await Promise.all([
    collection.countDocuments(baseFilter),
    collection.countDocuments({
      ...baseFilter,
      "source.trust": { $ne: "client_untrusted" },
    }),
    collection.countDocuments({
      ...baseFilter,
      outcome: { $in: ["denied", "failure"] },
    }),
    collection
      .aggregate<{ _id: AuditEventCategory; count: number }>([
        { $match: baseFilter },
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ])
      .toArray(),
    collection
      .aggregate<{ _id: AuditEventOutcome; count: number }>([
        { $match: baseFilter },
        { $group: { _id: "$outcome", count: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  return {
    total,
    trusted,
    denied,
    byCategory: Object.fromEntries(
      categoryRows.map((row) => [row._id, row.count]),
    ),
    byOutcome: Object.fromEntries(outcomeRows.map((row) => [row._id, row.count])),
  };
}
