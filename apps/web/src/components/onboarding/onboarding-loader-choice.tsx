"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, FileTextIcon } from "lucide-react";
import { AppLoader } from "@/components/app-loader";

const READ_ROW_REVEAL_DELAY_MS = 940;
const READ_LOADING_DURATION_MS = 1040;

type OnboardingLoaderChoiceProps = {
  onLoaderPopoverDismissed?: () => void;
};

export function OnboardingLoaderChoice({
  onLoaderPopoverDismissed,
}: OnboardingLoaderChoiceProps) {
  const openedLoaderPopoverRef = useRef(false);
  const [readDone, setReadDone] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setReadDone(true),
      READ_ROW_REVEAL_DELAY_MS + READ_LOADING_DURATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, []);

  function handleLoaderOpenChange(open: boolean) {
    if (open) {
      openedLoaderPopoverRef.current = true;
      return;
    }

    if (!openedLoaderPopoverRef.current) return;
    onLoaderPopoverDismissed?.();
  }

  return (
    <div className="relative">
      <div className="onboarding-bento-surface relative overflow-hidden rounded-[14px] p-5">
        <div className="mx-auto flex max-w-[720px] flex-col gap-5">
          <div>
            <div className="onboarding-transcript-reveal onboarding-transcript-reveal-1 flex justify-end">
              <div className="onboarding-bento-inset max-w-[82%] rounded-2xl px-4 py-2.5 text-sm text-foreground">
                Build a secure approvals dashboard for finance.
              </div>
            </div>
          </div>

          <div>
            <div className="space-y-3.5">
              <p className="onboarding-transcript-reveal onboarding-transcript-reveal-2 text-sm leading-relaxed text-foreground">
                I will inspect the workspace patterns first, then shape the
                app around review state and permission boundaries.
              </p>

              <div className="onboarding-transcript-reveal onboarding-transcript-reveal-3 not-prose flex items-center gap-2 text-sm text-muted-foreground">
                <FileTextIcon className="size-4" />
                <span className="text-primary">
                  {readDone ? "Read" : "Reading"}
                </span>
                <span className="truncate">landing.html</span>
                {readDone ? (
                  <CheckIcon className="size-3.5 text-muted-foreground" />
                ) : (
                  <AppLoader size="xs" interactive={false} />
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="onboarding-transcript-reveal onboarding-transcript-reveal-4 flex justify-end">
              <div className="onboarding-bento-inset max-w-[82%] rounded-2xl px-4 py-2.5 text-sm text-foreground">
                Thanks.
              </div>
            </div>
          </div>

          <div className="min-h-[8.75rem]">
            <div className="onboarding-transcript-reveal onboarding-transcript-reveal-5 relative h-[8.75rem] pt-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AppLoader size="sm" onOpenChange={handleLoaderOpenChange} />
                <span className="text-primary">Thinking</span>
                <span className="truncate">
                  Designing the first workspace-safe build prompt
                </span>
              </div>

              <svg
                viewBox="0 0 132 82"
                aria-hidden="true"
                className="absolute left-4 top-[38px] h-16 w-28 text-muted-foreground/80"
                fill="none"
              >
                <defs>
                  <marker
                    id="onboarding-loader-arrowhead"
                    markerHeight="8"
                    markerWidth="8"
                    orient="auto"
                    refX="3"
                    refY="3"
                  >
                    <path d="M6 3 0 0v6z" fill="currentColor" />
                  </marker>
                </defs>
                <path
                  d="M118 66C82 61 45 42 18 16"
                  markerEnd="url(#onboarding-loader-arrowhead)"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="2.75"
                />
              </svg>

              <div className="absolute left-16 right-0 top-20 sm:left-32">
                <p className="onboarding-loader-click-hint text-sm font-medium leading-none sm:text-base">
                  Click the loader to change it.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
