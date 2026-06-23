"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Image from "next/image";
import {
  ArrowRightIcon,
  CheckIcon,
  KeyRoundIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDefaultRuntimeSettings,
  type AgentRuntimeId,
  writePreferredRuntimeSettings,
} from "@/lib/agent/runtime-registry";
import { cn } from "@/lib/utils";

type DetectionResult = {
  claudeCli: { available: boolean; version?: string };
  codexCli: { available: boolean; version?: string };
  opencodeCli: { available: boolean; version?: string };
  runtimes?: Record<
    string,
    {
      available: boolean;
      version?: string;
      features?: {
        jsonEvents?: boolean;
        subprocessEnvScrub?: boolean;
        linuxBubblewrapRequired?: boolean;
        linuxBubblewrapAvailable?: boolean;
      };
      auth: {
        envKeyConfigured: boolean;
        cliLikelyConfigured: boolean;
        localAuthConfigured?: boolean;
      };
      error?: string;
    }
  >;
  apiKeyConfigured: boolean;
  workerReachable?: boolean;
  error?: string;
};

function StatusBadge({
  state,
  label,
}: {
  state: "ready" | "warn" | "missing";
  label: string;
}) {
  if (state === "ready") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-transparent bg-[#eaf8ef] text-[11px] text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
      >
        <CheckIcon className="size-3" />
        {label}
      </Badge>
    );
  }
  if (state === "warn") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-300"
      >
        <TriangleAlertIcon className="size-3" />
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[11px] text-muted-foreground">
      <TriangleAlertIcon className="size-2.5" />
      {label}
    </Badge>
  );
}

function ProviderCard({
  loading,
  iconSrc,
  iconAlt,
  icon,
  name,
  tagline,
  detected,
  statusState,
  statusLabel,
  description,
  hint,
  actionLabel,
  onChoose,
}: {
  loading: boolean;
  iconSrc?: string;
  iconAlt?: string;
  icon?: ReactNode;
  name: string;
  tagline: string;
  detected: boolean;
  statusState: "ready" | "warn" | "missing";
  statusLabel: string;
  description: string;
  hint: ReactNode;
  actionLabel?: string;
  onChoose?: () => void;
}) {
  const canChoose = !loading && detected && Boolean(onChoose);

  function choose() {
    if (!canChoose) return;
    onChoose?.();
  }

  return (
    <div
      className={cn(
        "onboarding-bento-surface grid h-72 grid-rows-[2.75rem_auto_minmax(0,1fr)_2rem] gap-y-4 rounded-[14px] p-4",
        canChoose && "onboarding-bento-interactive cursor-pointer",
      )}
      role={canChoose ? "button" : undefined}
      tabIndex={canChoose ? 0 : undefined}
      onClick={choose}
      onKeyDown={(event) => {
        if (!canChoose) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        choose();
      }}
    >
      {loading ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="size-11 rounded-xl" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>

          <div className="min-w-0">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>

          <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-2/3" />
          </div>

          <div className="flex items-center justify-end">
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </>
      ) : (
        <>
          <div className="animate-provider-card-fade-in flex items-start justify-between gap-3">
            {icon ?? (
              <Image
                src={iconSrc ?? ""}
                alt={iconAlt ?? ""}
                width={44}
                height={44}
                className="size-11 rounded-xl border border-border bg-white p-1.5 shadow-sm"
                unoptimized
              />
            )}
            <StatusBadge state={statusState} label={statusLabel} />
          </div>

          <div className="animate-provider-card-fade-in min-w-0">
            <h2 className="truncate text-sm font-medium">{name}</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">{tagline}</p>
          </div>

          <div className="animate-provider-card-fade-in flex min-h-0 flex-col gap-2 overflow-hidden text-xs text-muted-foreground">
            <p className="leading-5">{description}</p>
            <div className="text-[11px] leading-5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_code]:text-foreground">
              {hint}
            </div>
          </div>

          <div className="animate-provider-card-fade-in flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!canChoose}
              onClick={(event) => {
                event.stopPropagation();
                choose();
              }}
            >
              {detected ? (actionLabel ?? "Choose") : (actionLabel ?? "Unavailable")}
              {detected ? <ArrowRightIcon data-icon="inline-end" /> : null}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function ProviderSetup() {
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    detect();
  }, []);

  async function detect() {
    setLoading(true);
    try {
      const res = await fetch("/api/setup/detect-provider");
      const data: DetectionResult = await res.json();
      setDetection(data);
    } catch {
      setDetection({
        claudeCli: { available: false },
        codexCli: { available: false },
        opencodeCli: { available: false },
        runtimes: {},
        apiKeyConfigured: false,
        workerReachable: false,
        error: "Could not reach the worker service.",
      });
    } finally {
      setLoading(false);
    }
  }

  const hasAny =
    detection?.runtimes?.["claude-code"]?.available ||
    detection?.runtimes?.["codex-cli"]?.available ||
    detection?.runtimes?.opencode?.available;

  async function continueToStart(runtimeId?: AgentRuntimeId) {
    if (choosing) return;
    setChoosing(true);
    if (runtimeId) {
      writePreferredRuntimeSettings(getDefaultRuntimeSettings(runtimeId));
    }
    await fetch("/api/onboarding/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "start" }),
    }).catch(() => {});
    document.dispatchEvent(
      new CustomEvent("second:onboarding-navigate", {
        detail: { href: "/onboarding/start" },
      }),
    );
  }

  const claudeRuntime = detection?.runtimes?.["claude-code"];
  const claudeDetected = !!claudeRuntime?.available;
  const claudeInstalled = !!detection?.claudeCli.available;
  const codexRuntimeReady = !!detection?.runtimes?.["codex-cli"]?.available;
  const codexInstalled = !!detection?.codexCli.available;
  const opencodeRuntime = detection?.runtimes?.opencode;
  const opencodeRuntimeReady = !!opencodeRuntime?.available;
  const opencodeInstalled = !!detection?.opencodeCli.available;
  const opencodeJsonEvents = !!opencodeRuntime?.features?.jsonEvents;
  const opencodeConfigured =
    !!opencodeRuntime?.auth.envKeyConfigured ||
    !!opencodeRuntime?.auth.localAuthConfigured;
  // const apiKeyReady = !!detection?.apiKeyConfigured;

  return (
    <div className="w-full">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ProviderCard
          loading={loading}
          icon={
            <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-background shadow-sm">
              <KeyRoundIcon className="size-5 text-muted-foreground" />
            </div>
          }
          name="API Key / AWS Bedrock"
          tagline="Deployment only"
          detected={false}
          statusState="warn"
          statusLabel="Deployment only"
          description="Managed and on-prem deployments can preconfigure API keys or AWS Bedrock for the worker."
          hint={
            <span>
              Not available in local onboarding. Read the deployment docs or contact sales
              for these deployments.
            </span>
          }
          actionLabel="Deployment only"
        />

        <ProviderCard
          loading={loading}
          iconSrc="/icons/claude.png"
          iconAlt="Claude"
          name="Claude Code CLI"
          tagline="Anthropic · subscription"
          detected={claudeDetected}
          statusState={claudeDetected ? "ready" : claudeInstalled ? "warn" : "missing"}
          statusLabel={
            claudeDetected
              ? "Detected"
              : claudeInstalled
                ? "Needs worker setup"
                : "Not found"
          }
          description={
            claudeDetected
              ? detection?.workerReachable === false
                ? "Detected locally. Worker connection will be retried when building."
                : "Uses your Claude subscription (Pro/Max)."
              : claudeInstalled && claudeRuntime?.error
                ? "Claude CLI is installed, but the worker is missing a runtime dependency."
              : "Uses your Claude subscription. Install the CLI to enable."
          }
          hint={
            claudeDetected ? (
              <span>
                Authenticated via <code>claude login</code>
              </span>
            ) : claudeInstalled && claudeRuntime?.error ? (
              <span>{claudeRuntime.error}</span>
            ) : (
              <span>
                <a
                  href="https://docs.anthropic.com/en/docs/claude-code/overview"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  Install Claude Code
                </a>
                , then run <code>claude login</code>
              </span>
            )
          }
          onChoose={
            claudeDetected ? () => void continueToStart("claude-code") : undefined
          }
        />

        <ProviderCard
          loading={loading}
          iconSrc="/icons/codex.png"
          iconAlt="Codex"
          name="Codex CLI"
          tagline="OpenAI · CLI"
          detected={codexRuntimeReady}
          statusState={
            codexRuntimeReady ? "ready" : codexInstalled ? "warn" : "missing"
          }
          statusLabel={
            codexRuntimeReady
              ? "Detected"
              : codexInstalled
                ? "Needs auth"
                : "Not found"
          }
          description={
            codexRuntimeReady
              ? "Uses Codex CLI in non-interactive JSON mode."
              : codexInstalled
                ? "Codex CLI is installed, but it is not authenticated."
                : "Uses OpenAI through Codex CLI. Install to enable."
          }
          hint={
            codexRuntimeReady ? (
              <span>
                <code>codex</code> found
                {detection?.codexCli.version ? `: ${detection.codexCli.version}` : ""}
              </span>
            ) : codexInstalled ? (
              <span>
                Run <code>codex login</code> or set <code>CODEX_API_KEY</code> /{" "}
                <code>OPENAI_API_KEY</code>
              </span>
            ) : (
              <span>
                Install Codex CLI and configure <code>CODEX_API_KEY</code> or{" "}
                <code>OPENAI_API_KEY</code>
              </span>
            )
          }
          onChoose={
            codexRuntimeReady ? () => void continueToStart("codex-cli") : undefined
          }
        />

        <ProviderCard
          loading={loading}
          icon={
            <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-background shadow-sm">
              <TerminalIcon className="size-5 text-muted-foreground" />
            </div>
          }
          name="OpenCode CLI"
          tagline="OpenCode · provider/model"
          detected={opencodeRuntimeReady}
          statusState={
            opencodeRuntimeReady ? "ready" : opencodeInstalled ? "warn" : "missing"
          }
          statusLabel={
            opencodeRuntimeReady
              ? "Detected"
              : opencodeInstalled && !opencodeJsonEvents
                ? "Upgrade required"
                : opencodeInstalled && !opencodeConfigured
                  ? "Needs auth"
                  : "Not found"
          }
          description={
            opencodeRuntimeReady
              ? "Uses OpenCode CLI with scoped Second MCP tools."
              : opencodeInstalled && !opencodeJsonEvents
                ? "OpenCode is installed, but this version cannot stream JSON events."
                : opencodeInstalled
                  ? "OpenCode is installed, but no provider credentials were found."
                  : "Uses OpenCode with provider/model IDs such as openai/gpt-5.5."
          }
          hint={
            opencodeRuntimeReady ? (
              <span>
                <code>opencode</code> found
                {detection?.opencodeCli.version
                  ? `: ${detection.opencodeCli.version}`
                  : ""}
                {opencodeRuntime?.auth.localAuthConfigured
                  ? "; using local OpenCode auth"
                  : ""}
              </span>
            ) : opencodeInstalled && !opencodeJsonEvents ? (
              <span>
                Upgrade OpenCode until <code>opencode run --help</code> lists{" "}
                <code>--format json</code>
              </span>
            ) : opencodeInstalled ? (
              <span>
                Run <code>opencode auth login</code> or set{" "}
                <code>OPENAI_API_KEY</code>
              </span>
            ) : (
              <span>
                Install OpenCode, then run <code>opencode auth login</code>
              </span>
            )
          }
          onChoose={
            opencodeRuntimeReady ? () => void continueToStart("opencode") : undefined
          }
        />
      </div>

      {!loading && detection?.error && (
        <p
          className={cn(
            "animate-provider-card-fade-in mt-3 text-xs",
            hasAny ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {hasAny
            ? "Provider detected locally. If builds cannot start, restart the worker process."
            : detection.error}
        </p>
      )}

      {!loading && !hasAny && !detection?.error && (
        <p className="animate-provider-card-fade-in mt-3 text-xs text-muted-foreground">
          At least one provider is needed to run agents.
        </p>
      )}

      {!loading && !hasAny && (
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={detect}
          >
            Retry
          </Button>
          <Button
            variant="ghost"
            className="flex-1"
            disabled={choosing}
            onClick={() => void continueToStart()}
          >
            Skip for now
          </Button>
        </div>
      )}
    </div>
  );
}
