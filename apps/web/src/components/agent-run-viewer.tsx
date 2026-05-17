"use client";

import { useEffect, useRef, useState } from "react";
import {
  BotIcon,
  CheckIcon,
  XCircleIcon,
  ClockIcon,
} from "lucide-react";
import { AppLoader } from "@/components/app-loader";
import { cn } from "@/lib/utils";

export type AgentRunSummary = {
  id: string;
  agentId: string;
  agentName: string;
  prompt: string;
  status: string;
  result?: unknown;
  createdAt: string;
};

type AgentRunListProps = {
  workspaceId: string;
  appId: string;
  onRunClick?: (run: AgentRunSummary) => void;
};

const agentRunListCache = new Map<string, AgentRunSummary[]>();

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000,
  );
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isRunActive(status: string): boolean {
  return status === "running" || status === "streaming" || status === "pending";
}

/* ─── Tab switcher with animated sliding pill ─── */

type TabValue = "running" | "recent";

function TabSwitcher({
  activeTab,
  onTabChange,
  runningCount,
  recentCount,
}: {
  activeTab: TabValue;
  onTabChange: (tab: TabValue) => void;
  runningCount: number;
  recentCount: number;
}) {
  return (
    <div className="relative flex rounded-xl bg-muted/50 p-1">
      {/* Sliding pill */}
      <div
        className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-[10px] bg-background shadow-sm transition-transform duration-200 ease-out"
        style={{
          transform:
            activeTab === "running"
              ? "translateX(0)"
              : "translateX(100%)",
        }}
      />

      <button
        type="button"
        className={cn(
          "relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors duration-150",
          activeTab === "running"
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground/70",
        )}
        onClick={() => onTabChange("running")}
      >
        Running
        {runningCount > 0 ? (
          <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white tabular-nums">
            {runningCount}
          </span>
        ) : (
          <span className="text-[12px] tabular-nums text-muted-foreground/40">
            {runningCount}
          </span>
        )}
      </button>

      <button
        type="button"
        className={cn(
          "relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors duration-150",
          activeTab === "recent"
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground/70",
        )}
        onClick={() => onTabChange("recent")}
      >
        Recent
        <span className="text-[12px] tabular-nums text-muted-foreground/40">
          {recentCount}
        </span>
      </button>
    </div>
  );
}

/* ─── Run row ─── */

function RunStatusIndicator({ status }: { status: string }) {
  if (isRunActive(status)) {
    return <AppLoader size="xs" interactive={false} label="Agent running" />;
  }
  if (status === "completed") {
    return <CheckIcon className="size-3.5 text-emerald-500" />;
  }
  if (status === "failed") {
    return <XCircleIcon className="size-3.5 text-destructive/50" />;
  }
  return <ClockIcon className="size-3.5 text-muted-foreground/30" />;
}

function RunRow({
  run,
  onClick,
}: {
  run: AgentRunSummary;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/40 cursor-pointer"
      onClick={onClick}
    >
      <div className="mt-1.5 flex size-4 shrink-0 items-center justify-center">
        <RunStatusIndicator status={run.status} />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">
            {run.agentName}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/50">
            {timeAgo(run.createdAt)}
          </span>
        </div>
        <p className="truncate text-[12px] text-muted-foreground/70">
          {run.prompt}
        </p>
      </div>
    </button>
  );
}

/* ─── Main list ─── */

export function AgentRunList({
  workspaceId,
  appId,
  onRunClick,
}: AgentRunListProps) {
  const cacheKey = `${workspaceId}:${appId}`;
  const cachedRuns = agentRunListCache.get(cacheKey) ?? [];
  const [runs, setRuns] = useState<AgentRunSummary[]>(cachedRuns);
  const [loading, setLoading] = useState(cachedRuns.length === 0);
  const [loadFailed, setLoadFailed] = useState(false);

  const activeRuns = runs.filter((r) => isRunActive(r.status));
  const pastRuns = runs.filter((r) => !isRunActive(r.status));

  const [activeTab, setActiveTab] = useState<TabValue>(() =>
    activeRuns.length > 0 ? "running" : "recent",
  );

  // Auto-switch to Running tab when a new run starts
  const prevActiveCount = useRef(activeRuns.length);
  useEffect(() => {
    if (activeRuns.length > 0 && prevActiveCount.current === 0) {
      setActiveTab("running");
    }
    prevActiveCount.current = activeRuns.length;
  }, [activeRuns.length]);

  useEffect(() => {
    let cancelled = false;
    let activeController: AbortController | null = null;
    const unblockSpinner = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
      setLoadFailed((agentRunListCache.get(cacheKey)?.length ?? 0) === 0);
    }, 1500);

    async function fetchRuns() {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 3000);
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/apps/${appId}/agent-runs`,
          { cache: "no-store", signal: controller.signal },
        );
        if (res.ok && !cancelled && !controller.signal.aborted) {
          const data = (await res.json()) as { runs: AgentRunSummary[] };
          agentRunListCache.set(cacheKey, data.runs);
          setRuns(data.runs);
          setLoadFailed(false);
        }
      } catch {
        if (!cancelled && (timedOut || !controller.signal.aborted)) {
          setLoadFailed((agentRunListCache.get(cacheKey)?.length ?? 0) === 0);
        }
      } finally {
        window.clearTimeout(timeout);
        if (activeController === controller) {
          activeController = null;
          if (!cancelled) setLoading(false);
        }
      }
    }

    fetchRuns();
    const interval = setInterval(fetchRuns, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(unblockSpinner);
      clearInterval(interval);
      activeController?.abort();
    };
  }, [workspaceId, appId, cacheKey]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-12">
        <AppLoader size="xs" interactive={false} label="Loading agent runs" />
        <span className="text-[12px] text-muted-foreground">
          Loading runs…
        </span>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div className="flex size-10 items-center justify-center rounded-xl bg-muted/40">
          <BotIcon
            className="size-5 text-muted-foreground/50"
            strokeWidth={1.5}
          />
        </div>
        <div className="space-y-1">
          <p className="text-[13px] font-medium text-foreground">
            {loadFailed ? "Could not load runs" : "No agent runs yet"}
          </p>
          <p className="max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">
            {loadFailed
              ? "Check your connection and try again."
              : "Runs triggered from this app will appear here."}
          </p>
        </div>
      </div>
    );
  }

  const visibleRuns = activeTab === "running" ? activeRuns : pastRuns;

  return (
    <div className="flex flex-col">
      {/* Tab switcher */}
      <div className="px-3 pt-3 pb-2">
        <TabSwitcher
          activeTab={activeTab}
          onTabChange={setActiveTab}
          runningCount={activeRuns.length}
          recentCount={pastRuns.length}
        />
      </div>

      {/* Run list */}
      <div className="px-1.5 pb-2">
        {visibleRuns.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-[12px] text-muted-foreground">
              {activeTab === "running"
                ? "No agents running right now"
                : "No recent runs"}
            </p>
          </div>
        ) : (
          visibleRuns.slice(0, 10).map((run) => (
            <RunRow
              key={run.id}
              run={run}
              onClick={() => onRunClick?.(run)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ─── Single run viewer ─── */

type AgentRunViewerProps = {
  workspaceId: string;
  appId: string;
  runId: string;
  agentName: string;
  prompt: string;
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running":
    case "streaming":
    case "pending":
      return <AppLoader size="xs" interactive={false} label="Agent running" />;
    case "completed":
      return <CheckIcon className="size-3.5 text-emerald-500" />;
    case "failed":
      return <XCircleIcon className="size-3.5 text-destructive" />;
    default:
      return <ClockIcon className="size-3.5 text-muted-foreground" />;
  }
}

export function AgentRunViewer({
  workspaceId,
  appId,
  runId,
  agentName,
  prompt,
}: AgentRunViewerProps) {
  const [run, setRun] = useState<{
    status: string;
    result: unknown;
    messages: unknown[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchRun() {
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/apps/${appId}/agent-runs/${runId}`,
          { cache: "no-store" },
        );
        if (res.ok && !cancelled) {
          const data = await res.json();
          setRun(data);
        }
      } catch {
        // best effort
      }
    }

    fetchRun();
    const interval = setInterval(fetchRun, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [workspaceId, appId, runId]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <BotIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{agentName}</span>
        {run && <StatusIcon status={run.status} />}
      </div>
      <div className="text-xs text-muted-foreground">{prompt}</div>
      {run?.result != null && (
        <div className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
          {typeof run.result === "string"
            ? run.result
            : JSON.stringify(run.result, null, 2)}
        </div>
      )}
    </div>
  );
}
