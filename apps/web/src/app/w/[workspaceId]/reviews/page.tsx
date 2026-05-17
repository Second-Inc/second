"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  FileTextIcon,
  InboxIcon,
  Loader2,
  TriangleAlertIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { integrationRouteSegment } from "@/lib/integration-routes";
import { cn } from "@/lib/utils";
import type {
  IntegrationPermissionGroup,
  IntegrationSecretRequirement,
  ReviewRequestStatus,
} from "@/lib/db/types";

// ============================================================================
// Types
// ============================================================================

type ReviewIntegration = {
  id: string;
  appId?: string;
  appName?: string;
  name: string;
  domain: string;
  keySlug?: string;
  keyName?: string;
  capabilityLabel?: string;
  faviconUrl: string;
  configured: boolean;
  needsSetup: boolean;
  permissionGroups: IntegrationPermissionGroup[];
  secretRequirements: IntegrationSecretRequirement[];
};

type ReviewItem = {
  id: string;
  resourceType: "app";
  resourceId: string;
  resourceName: string;
  resourceDescription?: string | null;
  changes: string[];
  status: ReviewRequestStatus;
  requestedByUserName: string;
  requestedAt: string;
  targetTeamNames: string[];
  reviewerUserName: string | null;
  reviewedAt: string | null;
  reviewMessage: string | null;
  appStatus: string;
  integrations: ReviewIntegration[];
};

// ============================================================================
// Helpers
// ============================================================================

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusBadge(status: ReviewRequestStatus) {
  if (status === "approved")
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
      >
        <CheckCircle2Icon className="size-2.5" />
        Approved
      </Badge>
    );
  if (status === "changes_requested")
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/30 text-amber-800 dark:text-amber-300"
      >
        <AlertCircleIcon className="size-2.5" />
        Changes requested
      </Badge>
    );
  if (status === "superseded")
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        Superseded
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="gap-1 border-blue-500/30 text-blue-700 dark:text-blue-300"
    >
      Pending
    </Badge>
  );
}

// ============================================================================
// Main page
// ============================================================================

export default function ReviewInboxPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const router = useRouter();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [changesTarget, setChangesTarget] = useState<ReviewItem | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<ReviewItem | null>(null);
  const [changesMessage, setChangesMessage] = useState("");
  const [tab, setTab] = useState<"pending" | "reviewed">("pending");

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/reviews`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as { items: ReviewItem[] };
      setItems(body.items);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchReviews();
  }, [fetchReviews]);

  const approve = async (item: ReviewItem) => {
    setBusyId(item.id);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/reviews/${item.id}/approve`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        let errorMessage = "Unable to approve this review.";
        if (body?.error === "integrations_setup_required") {
          errorMessage =
            "Configure the requested integrations before approving this app.";
        } else if (body?.error === "review_stale") {
          errorMessage =
            "This review is no longer active because the app changed.";
        }
        setMessage(errorMessage);
        return;
      }
      await fetchReviews();
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const requestChanges = async () => {
    if (!changesTarget) return;
    setBusyId(changesTarget.id);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/reviews/${changesTarget.id}/changes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: changesMessage }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setMessage(
          body?.error === "review_stale"
            ? "This review is no longer active because the app changed."
            : "Unable to request changes.",
        );
        return;
      }
      setChangesTarget(null);
      setChangesMessage("");
      await fetchReviews();
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const pendingItems = items.filter((item) => item.status === "pending");
  const reviewedItems = items.filter((item) => item.status !== "pending");
  const activeItems = tab === "pending" ? pendingItems : reviewedItems;
  const detailChanges = detailsTarget?.changes ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-0">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-lg font-semibold tracking-tight">Admin tasks</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Review app publishing requests and integration setup.
          </p>

          {/* Tabs */}
          <div className="mt-5 flex gap-5 border-b border-border -mb-px">
            <button
              type="button"
              onClick={() => setTab("pending")}
              className={cn(
                "flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium transition-colors",
                tab === "pending"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              Pending
              {pendingItems.length > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/10 px-1 text-[10px]">
                  {pendingItems.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab("reviewed")}
              className={cn(
                "border-b-2 pb-2.5 text-xs font-medium transition-colors",
                tab === "reviewed"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              Reviewed
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8">
        <div className="mx-auto max-w-4xl py-5">
          {/* Error banner */}
          {message && (
            <p className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              {message}
            </p>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : activeItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-12 text-center">
              <InboxIcon className="mx-auto mb-3 size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {tab === "pending"
                  ? "No pending reviews."
                  : "No reviewed items yet."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {activeItems.map((item) => (
                <ReviewCard
                  key={item.id}
                  item={item}
                  workspaceId={workspaceId}
                  busy={busyId === item.id}
                  showActions={tab === "pending"}
                  onShowChanges={() => setDetailsTarget(item)}
                  onApprove={() => approve(item)}
                  onRequestChanges={() => {
                    setChangesTarget(item);
                    setChangesMessage("");
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Request changes dialog */}
      <Dialog
        open={!!changesTarget}
        onOpenChange={(open) => !open && setChangesTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request changes</DialogTitle>
            <DialogDescription>
              Leave a short note for the builder.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={changesMessage}
            onChange={(e) => setChangesMessage(e.target.value)}
            placeholder="What should change before publishing?"
            rows={3}
            className="w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-xs outline-none placeholder:text-muted-foreground/40 focus:border-border focus:bg-transparent"
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setChangesTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!changesTarget || busyId === changesTarget.id}
              onClick={requestChanges}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!detailsTarget}
        onOpenChange={(open) => !open && setDetailsTarget(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Changes</DialogTitle>
            <DialogDescription>
              {detailsTarget?.resourceName}
            </DialogDescription>
          </DialogHeader>
          {detailChanges.length ? (
            detailChanges.length === 1 ? (
              <p className="text-sm leading-relaxed text-foreground">
                {detailChanges[0]}
              </p>
            ) : (
              <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-foreground">
                {detailChanges.map((change, index) => (
                  <li key={`${index}-${change}`}>{change}</li>
                ))}
              </ul>
            )
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              No preview summaries have been captured for this draft.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Review card — matches integrations design
// ============================================================================

function ReviewCard({
  item,
  workspaceId,
  busy,
  showActions,
  onShowChanges,
  onApprove,
  onRequestChanges,
}: {
  item: ReviewItem;
  workspaceId: string;
  busy: boolean;
  showActions: boolean;
  onShowChanges: () => void;
  onApprove: () => void;
  onRequestChanges: () => void;
}) {
  const setupNeeded = item.integrations.some(
    (integration) => integration.needsSetup,
  );
  const firstSetupIntegration = item.integrations.find(
    (integration) => integration.needsSetup,
  );
  const setupHref = firstSetupIntegration
    ? `/w/${workspaceId}/settings/integrations/${encodeURIComponent(
        integrationRouteSegment(firstSetupIntegration, item.integrations),
      )}?app=${encodeURIComponent(item.resourceId)}`
    : `/w/${workspaceId}/settings/integrations?app=${encodeURIComponent(
        item.resourceId,
      )}`;

  return (
    <div className="rounded-lg border border-border/60 px-4 py-3.5">
      {/* Row 1: app name + status + actions */}
      <div className="flex items-center gap-2">
        <Link
          href={`/w/${workspaceId}/apps/${item.resourceId}`}
          className="text-[13px] font-medium hover:underline"
        >
          {item.resourceName}
        </Link>
        {statusBadge(item.status)}
        {showActions && item.status === "pending" && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              disabled={busy}
              onClick={onRequestChanges}
            >
              Request changes
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-[11px]"
              disabled={busy || setupNeeded}
              onClick={onApprove}
            >
              {busy ? "Approving…" : "Approve"}
            </Button>
          </div>
        )}
      </div>

      {item.resourceDescription && (
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {item.resourceDescription}
        </p>
      )}

      {/* Row 2: meta */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <UserRoundIcon className="size-3" />
          {item.requestedByUserName} · {formatDate(item.requestedAt)}
        </span>
        {item.targetTeamNames.length > 0 && (
          <span className="flex items-center gap-1">
            <UsersRoundIcon className="size-3" />
            {item.targetTeamNames.join(", ")}
          </span>
        )}
        <button
          type="button"
          onClick={onShowChanges}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <FileTextIcon className="size-3" />
          Changes
          {item.changes.length > 1 ? (
            <span className="font-mono text-[11px]">
              {item.changes.length}
            </span>
          ) : null}
        </button>
      </div>

      {/* Row 3: integration chips */}
      {item.integrations.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {item.integrations.map((integration) => (
            <span
              key={integration.id}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-2 py-1 text-xs"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={integration.faviconUrl}
                alt=""
                width={14}
                height={14}
                className="size-3.5 rounded-sm"
              />
              {integration.name}
              {integration.needsSetup ? (
                <TriangleAlertIcon className="size-3 text-amber-700 dark:text-amber-300" />
              ) : (
                <CheckCircle2Icon className="size-3 text-emerald-700 dark:text-emerald-300" />
              )}
            </span>
          ))}
        </div>
      )}

      {/* Setup warning */}
      {setupNeeded && item.status === "pending" && (
        <div className="mt-2.5 flex items-center gap-3 rounded-md bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <span>Configure integrations before approving.</span>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="ml-auto h-6 text-[11px]"
          >
            <Link href={setupHref}>
              Open integrations
              <ArrowRightIcon className="size-3" />
            </Link>
          </Button>
        </div>
      )}

      {/* Review outcome (reviewed tab) */}
      {!showActions &&
        (item.reviewerUserName || item.status === "superseded") && (
          <div className="mt-2.5 rounded-md bg-muted/30 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {item.reviewerUserName ?? "Second"}
              </span>
              <span>
                {item.status === "approved"
                  ? "approved"
                  : item.status === "superseded"
                    ? "closed this review"
                    : "requested changes"}
              </span>
              {item.reviewedAt && (
                <span>· {formatDate(item.reviewedAt)}</span>
              )}
            </div>
            {item.reviewMessage && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {item.reviewMessage}
              </p>
            )}
          </div>
        )}
    </div>
  );
}
