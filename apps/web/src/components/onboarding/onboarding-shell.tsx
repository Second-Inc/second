"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CheckIcon, InfoIcon, ShieldCheckIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SecondLogo } from "@/components/second-logo";
import { cn } from "@/lib/utils";
import { OnboardingShader } from "@/components/onboarding/onboarding-shader";

type OnboardingStep =
  | "intro"
  | "identity"
  | "workspace"
  | "loader"
  | "provider"
  | "start";

type OnboardingShellProps = {
  step: OnboardingStep;
  eyebrow?: string;
  title: string;
  titleShimmer?: boolean;
  titleSuffix?: string;
  description?: string;
  calloutTitle?: string;
  calloutDescription?: string;
  calloutTone?: "default" | "warning";
  children: ReactNode;
  contentAlign?: "left" | "center";
  fitViewport?: boolean;
  trackProgress?: boolean;
};

type OnboardingFrameState = {
  step: OnboardingStep;
  asideTitle: string;
  asideDescription: string;
  showProgress: boolean;
};

const DEFAULT_ASIDE_TITLE = "Second enterprise workspace";
const DEFAULT_ASIDE_DESCRIPTION =
  "A governed place for internal AI apps, agent runs, integrations, and app data.";
const ONBOARDING_EXIT_MS = 560;

const DEFAULT_FRAME_STATE: OnboardingFrameState = {
  step: "intro",
  asideTitle: DEFAULT_ASIDE_TITLE,
  asideDescription: DEFAULT_ASIDE_DESCRIPTION,
  showProgress: false,
};

const FRAME_STATE_BY_STEP: Record<OnboardingStep, OnboardingFrameState> = {
  intro: {
    step: "intro",
    asideTitle: "Second enterprise workspace",
    asideDescription:
      "Start with a secure local setup, then create the workspace boundary that owns apps, runs, integrations, and app data.",
    showProgress: false,
  },
  identity: {
    step: "identity",
    asideTitle: DEFAULT_ASIDE_TITLE,
    asideDescription:
      "Start with identity, then create the workspace boundary that will own apps, runs, integrations, and app data.",
    showProgress: true,
  },
  workspace: {
    step: "workspace",
    asideTitle: "Governed from the first record",
    asideDescription:
      "Every workspace-owned query is scoped by workspaceId, and cross-workspace resources return not found.",
    showProgress: true,
  },
  loader: {
    step: "loader",
    asideTitle: "A signature for long-running work",
    asideDescription:
      "Loader preferences are personal user preferences. They do not affect workspace data, app output, or tenant-scoped records.",
    showProgress: true,
  },
  provider: {
    step: "provider",
    asideTitle: "Your local runtime stays explicit",
    asideDescription:
      "Provider detection is a setup check. Workspace access and app creation still go through the same membership and workspace-scoped routes.",
    showProgress: true,
  },
  start: {
    step: "start",
    asideTitle: "Context before building",
    asideDescription:
      "Future builders and app agents receive the approved company and user context in their system prompt, never as a hidden chat message.",
    showProgress: true,
  },
};

const LOCAL_PROGRESS_STEPS: Array<{
  id: OnboardingStep;
  label: string;
}> = [
  {
    id: "identity",
    label: "Identity",
  },
  {
    id: "workspace",
    label: "Workspace",
  },
  {
    id: "loader",
    label: "Loader",
  },
  {
    id: "provider",
    label: "Runtime",
  },
];

const CONTEXT_PROGRESS_STEPS: Array<{
  id: OnboardingStep;
  label: string;
}> = [
  {
    id: "identity",
    label: "Identity",
  },
  {
    id: "workspace",
    label: "Workspace",
  },
  {
    id: "loader",
    label: "Loader",
  },
  {
    id: "start",
    label: "Context",
  },
];

const STEP_HREF: Record<OnboardingStep, string> = {
  intro: "/onboarding/intro",
  identity: "/onboarding/identity",
  workspace: "/onboarding/workspace",
  loader: "/onboarding/loader",
  provider: "/onboarding/provider",
  start: "/onboarding/start",
};

type OnboardingNavigateEvent = CustomEvent<{ href: string }>;

function isOnboardingNavigateEvent(
  event: Event,
): event is OnboardingNavigateEvent {
  return (
    "detail" in event &&
    typeof (event as OnboardingNavigateEvent).detail?.href === "string"
  );
}

function StepIndicator({
  label,
  state,
  onClick,
}: {
  label: string;
  state: "complete" | "current" | "upcoming";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={state === "current" ? "step" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2.5 py-2.5 text-left transition-colors",
        state === "current"
          ? "border-white/25 bg-white/15 text-white"
          : "border-white/10 bg-black/10 text-white/75 hover:bg-white/10 hover:text-white",
      )}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border",
          state === "complete"
            ? "border-white bg-white text-black"
            : state === "current"
              ? "border-white bg-white/20"
              : "border-white/25",
        )}
      >
        {state === "complete" ? <CheckIcon className="size-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{label}</span>
      </span>
    </button>
  );
}

function pathnameStartsWith(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function frameStateForPathname(pathname: string): OnboardingFrameState {
  if (pathnameStartsWith(pathname, STEP_HREF.identity)) {
    return FRAME_STATE_BY_STEP.identity;
  }

  if (pathnameStartsWith(pathname, STEP_HREF.workspace)) {
    return FRAME_STATE_BY_STEP.workspace;
  }

  if (pathnameStartsWith(pathname, STEP_HREF.loader)) {
    return FRAME_STATE_BY_STEP.loader;
  }

  if (pathnameStartsWith(pathname, STEP_HREF.provider)) {
    return FRAME_STATE_BY_STEP.provider;
  }

  if (pathnameStartsWith(pathname, STEP_HREF.start)) {
    return FRAME_STATE_BY_STEP.start;
  }

  if (pathnameStartsWith(pathname, STEP_HREF.intro)) {
    return FRAME_STATE_BY_STEP.intro;
  }

  return DEFAULT_FRAME_STATE;
}

export function OnboardingFrame({
  children,
  isLocalMode = false,
}: {
  children: ReactNode;
  isLocalMode?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const navigationTimeoutRef = useRef<number | null>(null);
  const syncFrameRef = useRef<number | null>(null);
  const [leavingPathname, setLeavingPathname] = useState<string | null>(null);
  const frameState = frameStateForPathname(pathname);
  const [shaderStep, setShaderStep] = useState<OnboardingStep>(
    frameState.step,
  );
  const progressSteps = isLocalMode
    ? LOCAL_PROGRESS_STEPS
    : CONTEXT_PROGRESS_STEPS;
  const activeIndex = progressSteps.findIndex(
    (item) => item.id === frameState.step,
  );
  const isLeaving = leavingPathname === pathname;

  const navigate = useCallback(
    (href: string) => {
      if (href === pathname) return;

      if (navigationTimeoutRef.current !== null) {
        window.clearTimeout(navigationTimeoutRef.current);
      }

      if (syncFrameRef.current !== null) {
        window.cancelAnimationFrame(syncFrameRef.current);
        syncFrameRef.current = null;
      }

      setShaderStep(frameStateForPathname(href).step);
      setLeavingPathname(pathname);
      navigationTimeoutRef.current = window.setTimeout(() => {
        router.push(href);
        navigationTimeoutRef.current = null;
      }, ONBOARDING_EXIT_MS);
    },
    [pathname, router],
  );

  useEffect(() => {
    syncFrameRef.current = window.requestAnimationFrame(() => {
      setLeavingPathname(null);
      setShaderStep(frameState.step);
      syncFrameRef.current = null;
    });

    return () => {
      if (syncFrameRef.current !== null) {
        window.cancelAnimationFrame(syncFrameRef.current);
        syncFrameRef.current = null;
      }
    };
  }, [frameState.step, pathname]);

  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current !== null) {
        window.clearTimeout(navigationTimeoutRef.current);
      }
      if (syncFrameRef.current !== null) {
        window.cancelAnimationFrame(syncFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      if (!isOnboardingNavigateEvent(event)) return;
      navigate(event.detail.href);
    };

    document.addEventListener("second:onboarding-navigate", handleNavigate);
    return () => {
      document.removeEventListener("second:onboarding-navigate", handleNavigate);
    };
  }, [navigate]);

  return (
    <main data-onboarding-shell className="h-svh overflow-hidden bg-background">
      <div className="grid h-svh lg:grid-cols-[minmax(0,1fr)_minmax(400px,34vw)]">
        <section
          data-onboarding-leaving={isLeaving ? "true" : undefined}
          className={cn(
            "onboarding-left-pane flex min-h-0 flex-col px-5 py-5 sm:px-8 lg:px-10",
            frameState.step === "start" ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          <div
            data-onboarding-brand-row
            data-second-desktop-drag-region
            className="flex shrink-0 items-center justify-between gap-4"
          >
            <div className="flex items-center gap-2">
              <SecondLogo className="text-foreground" />
              <span className="text-base font-semibold">Second</span>
            </div>
          </div>

          {children}
        </section>

        <aside className="relative hidden h-svh overflow-hidden p-4 lg:flex">
          <div className="relative h-full w-full">
            <div className="relative h-full overflow-hidden rounded-[32px] border border-white/10">
              <OnboardingShader step={shaderStep} />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <div className="rounded-lg border border-white/10 bg-black/45 p-4 text-white shadow-2xl backdrop-blur-md">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/10">
                      <ShieldCheckIcon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {frameState.asideTitle}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-white/70">
                        {frameState.asideDescription}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {frameState.showProgress ? (
              <div className="absolute left-1/2 top-1/2 w-60 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/10 bg-black/45 p-3 text-white shadow-2xl backdrop-blur-md">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium">Setup progress</span>
                  <span className="font-mono text-[10px] text-white/60">
                    {Math.max(activeIndex + 1, 1)}/{progressSteps.length}
                  </span>
                </div>
                <div className="grid gap-1.5">
                  {progressSteps.map((item, index) => (
                    <StepIndicator
                      key={item.id}
                      label={item.label}
                      onClick={() => navigate(STEP_HREF[item.id])}
                      state={
                        index < activeIndex
                          ? "complete"
                          : index === activeIndex
                            ? "current"
                            : "upcoming"
                      }
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}

export function OnboardingShell({
  step,
  eyebrow,
  title,
  titleShimmer = false,
  titleSuffix,
  description,
  calloutTitle,
  calloutDescription,
  calloutTone = "default",
  children,
  contentAlign = "left",
  fitViewport = false,
  trackProgress = false,
}: OnboardingShellProps) {
  useEffect(() => {
    if (!trackProgress) return;

    void fetch("/api/onboarding/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step }),
    }).catch(() => {});
  }, [step, trackProgress]);

  return (
    <div
      key={step}
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col",
        fitViewport
          ? "min-h-0 flex-1 justify-start gap-4 overflow-hidden py-4 lg:py-5"
          : "min-h-[calc(100svh-5rem)] justify-center gap-8 py-10 lg:py-14",
        contentAlign === "center" && "items-center text-center",
        "onboarding-step-in",
      )}
    >
      <div className={cn("flex flex-col gap-5", fitViewport && "shrink-0")}>
        <div
          className={cn(
            "flex max-w-2xl flex-col gap-3",
            contentAlign === "center" && "items-center text-center",
          )}
        >
          {eyebrow ? (
            <Badge variant="outline" className="w-fit">
              {eyebrow}
            </Badge>
          ) : null}
          <h1
            className="text-4xl font-medium tracking-tight text-balance sm:text-5xl"
            style={{
              fontFamily: "AlphaLyrae, sans-serif",
              fontFeatureSettings: '"calt" 1',
            }}
          >
            {titleShimmer ? (
              <>
                <span className="working-text-shimmer">{title}</span>
                {titleSuffix ? (
                  <span className="ml-2 inline-block align-baseline text-2xl text-foreground sm:text-3xl">
                    {titleSuffix}
                  </span>
                ) : null}
              </>
            ) : (
              <>
                {title}
                {titleSuffix ? (
                  <span className="ml-2 inline-block align-baseline text-2xl sm:text-3xl">
                    {titleSuffix}
                  </span>
                ) : null}
              </>
            )}
          </h1>
          {description ? (
            <p className="max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "w-full",
          fitViewport ? "min-h-0 flex-1 max-w-3xl overflow-hidden" : "max-w-2xl",
          contentAlign === "center" && "flex justify-center",
        )}
      >
        {children}
      </div>

      {calloutDescription ? (
        <Alert
          className={cn(
            "max-w-2xl px-3 py-2.5",
            calloutTone === "warning" && "onboarding-alert-warning",
          )}
        >
          <InfoIcon className="size-3.5" />
          {calloutTitle ? <AlertTitle>{calloutTitle}</AlertTitle> : null}
          <AlertDescription
            className={cn(!calloutTitle && "font-medium text-current")}
          >
            {calloutDescription}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
