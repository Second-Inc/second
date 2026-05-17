"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  InboxIcon,
  KeyRoundIcon,
  Loader2,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  IntegrationPermissionGroup,
  IntegrationSecretRequirement,
  ReviewRequestStatus,
} from "@/lib/db/types";

type ReviewIntegration = {
  id: string;
  name: string;
  domain: string;
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

// TODO: remove sample data fallback later
const SAMPLE_REVIEWS: ReviewItem[] = [
  {
    id: "sample_1", resourceType: "app", resourceId: "app_roadmap",
    resourceName: "Roadmap Tracker", status: "pending",
    requestedByUserName: "Maya Chen",
    requestedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    targetTeamNames: ["Engineering", "Product"],
    reviewerUserName: null, reviewedAt: null, reviewMessage: null,
    appStatus: "review_requested",
    integrations: [{
      id: "int_linear", name: "Linear", domain: "linear.app",
      faviconUrl: "https://www.google.com/s2/favicons?sz=64&domain=linear.app",
      configured: true, needsSetup: false, permissionGroups: [], secretRequirements: [],
    }],
  },
  {
    id: "sample_2", resourceType: "app", resourceId: "app_standup",
    resourceName: "Daily Standup", status: "pending",
    requestedByUserName: "Avery Brooks",
    requestedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    targetTeamNames: ["Engineering"],
    reviewerUserName: null, reviewedAt: null, reviewMessage: null,
    appStatus: "review_requested",
    integrations: [{
      id: "int_slack", name: "Slack", domain: "slack.com",
      faviconUrl: "https://www.google.com/s2/favicons?sz=64&domain=slack.com",
      configured: false, needsSetup: true, permissionGroups: [], secretRequirements: [],
    }],
  },
  {
    id: "sample_3", resourceType: "app", resourceId: "app_crm",
    resourceName: "CRM Sync", status: "approved",
    requestedByUserName: "Sam Patel",
    requestedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    targetTeamNames: ["Sales"],
    reviewerUserName: "Jordan Lee",
    reviewedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    reviewMessage: null, appStatus: "published",
    integrations: [{
      id: "int_hubspot", name: "HubSpot", domain: "hubapi.com",
      faviconUrl: "https://www.google.com/s2/favicons?sz=64&domain=hubapi.com",
      configured: true, needsSetup: false, permissionGroups: [], secretRequirements: [],
    }],
  },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function ReviewInboxPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const router = useRouter();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [changesTarget, setChangesTarget] = useState<ReviewItem | null>(null);
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
      // TODO: remove SAMPLE_REVIEWS fallback once real data exists
      setItems(body.items.length > 0 ? body.items : SAMPLE_REVIEWS);
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
          errorMessage = "This review is no longer active because the app changed.";
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

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
        <div>
          <h1 className="text-lg font-semibold">Admin tasks</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Review app publishing requests, team access, and integration setup.
          </p>
        </div>

        <Alert className="px-4 py-3">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <AlertTitle>How Review Works</AlertTitle>
            <AlertDescription className="mt-0.5">
              Apps stay private while in draft, only available to collaborators.
            </AlertDescription>
            <ol className="relative mt-3 grid gap-3 before:absolute before:top-3 before:left-3 before:hidden before:h-px before:w-[calc(100%-1.5rem)] before:bg-border before:content-[''] sm:grid-cols-3 sm:gap-4 sm:before:block">
              {[
                ["1", "Open request"],
                ["2", "Check access"],
                ["3", "Approve or return"],
              ].map(([step, title]) => (
                <li key={step} className="relative flex items-center gap-2 sm:flex-col sm:items-start">
                  <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background font-mono text-[10px] font-medium text-muted-foreground">
                    {step}
                  </span>
                  <span className="min-w-0 text-xs font-medium text-foreground">
                    {title}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Alert>

        {message ? (
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            {message}
          </p>
        ) : null}

        <div className="flex gap-6 border-b border-border">
          <button
            type="button"
            className={cn(
              "-mb-px pb-2.5 text-xs font-medium transition-colors",
              tab === "pending"
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab("pending")}
          >
            Pending
            {pendingItems.length > 0 ? (
              <span className="ml-1.5 inline-flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                {pendingItems.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className={cn(
              "-mb-px pb-2.5 text-xs font-medium transition-colors",
              tab === "reviewed"
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab("reviewed")}
          >
            Reviewed
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : activeItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <InboxIcon className="mx-auto mb-3 size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {tab === "pending" ? "No pending reviews." : "No reviewed items yet."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
            {activeItems.map((item) => (
              <ReviewRow
                key={item.id}
                item={item}
                workspaceId={workspaceId}
                busy={busyId === item.id}
                showActions={tab === "pending"}
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

      <Dialog open={!!changesTarget} onOpenChange={(open) => !open && setChangesTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request changes</DialogTitle>
            <DialogDescription>
              Leave a short note for the builder.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={changesMessage}
            onChange={(event) => setChangesMessage(event.target.value)}
            placeholder="What should change before publishing?"
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
    </div>
  );
}

function ReviewRow({
  item,
  workspaceId,
  busy,
  showActions,
  onApprove,
  onRequestChanges,
}: {
  item: ReviewItem;
  workspaceId: string;
  busy: boolean;
  showActions: boolean;
  onApprove: () => void;
  onRequestChanges: () => void;
}) {
  const setupNeeded = item.integrations.some((integration) => integration.needsSetup);

  return (
    <div className="flex flex-col gap-3 bg-background px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/w/${workspaceId}/apps/${item.resourceId}`}
              className="truncate text-sm font-medium hover:underline"
            >
              {item.resourceName}
            </Link>
            <Badge variant={item.status === "pending" ? "secondary" : "outline"}>
              {item.status === "pending"
                ? "Pending"
                : item.status === "approved"
                  ? "Approved"
                  : item.status === "superseded"
                    ? "Superseded"
                    : "Changes requested"}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <UserRoundIcon className="size-3" />
            <span>{item.requestedByUserName}</span>
            <span>on {formatDate(item.requestedAt)}</span>
          </div>
        </div>
        {showActions && item.status === "pending" ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onRequestChanges}
            >
              Request changes
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || setupNeeded}
              onClick={onApprove}
            >
              {busy ? "Approving..." : "Approve"}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">
          <UsersRoundIcon className="mr-1 inline size-3" />
          Teams:
        </span>
        {item.targetTeamNames.map((team) => (
          <Badge key={team} variant="outline">
            {team}
          </Badge>
        ))}
      </div>

      {item.integrations.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            <KeyRoundIcon className="mr-1 inline size-3" />
            Integrations:
          </span>
          {item.integrations.map((integration) => (
            <span
              key={integration.id}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2 py-0.5 text-xs"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={integration.faviconUrl}
                alt=""
                width={12}
                height={12}
                className="size-3 rounded-sm"
              />
              {integration.name}
              {integration.needsSetup ? (
                <AlertCircleIcon className="size-3 text-amber-800 dark:text-amber-300" />
              ) : (
                <CheckCircle2Icon className="size-3 text-emerald-700 dark:text-emerald-300" />
              )}
            </span>
          ))}
        </div>
      ) : null}

      {!showActions && (item.reviewerUserName || item.status === "superseded") ? (
        <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
          <div className="min-w-0 flex-1">
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
              {item.reviewedAt ? (
                <span>on {formatDate(item.reviewedAt)}</span>
              ) : null}
            </div>
            {item.reviewMessage ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {item.reviewMessage}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {setupNeeded && item.status === "pending" ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <span>Configure integrations before approving.</span>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="border-amber-500/35 bg-amber-500/10 text-amber-900 shadow-sm hover:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/20"
          >
            <Link href={`/w/${workspaceId}/settings/integrations`}>
              Open integrations
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
