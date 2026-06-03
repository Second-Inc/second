"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { Loader2, WaypointsIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const AppArchitecture = dynamic(
  () => import("./app-architecture").then((m) => m.AppArchitecture),
  {
    ssr: false,
    loading: () => (
      <div className="flex size-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

type AppArchitectureDialogProps = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  appId: string;
  appName: string;
};

export function AppArchitectureDialog({
  open,
  onClose,
  workspaceId,
  appId,
  appName,
}: AppArchitectureDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 animate-in fade-in-0"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="absolute inset-2 flex flex-col overflow-hidden rounded-2xl bg-background shadow-2xl ring-1 ring-foreground/10 duration-200 animate-in fade-in-0 zoom-in-[0.98] sm:inset-4 md:inset-6 lg:inset-8">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-3.5 py-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/50 text-foreground/80">
            <WaypointsIcon className="size-4" strokeWidth={1.75} />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[13px] font-semibold tracking-[-0.01em] text-foreground">
              Architecture
            </span>
            <span
              className="size-1 shrink-0 rounded-full bg-border"
              aria-hidden
            />
            <span className="truncate text-[13px] text-muted-foreground">
              {appName}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto shrink-0 rounded-full text-muted-foreground"
            onClick={onClose}
            aria-label="Close architecture view"
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Canvas */}
        <div className="relative min-h-0 flex-1">
          <AppArchitecture workspaceId={workspaceId} appId={appId} />
        </div>
      </div>
    </div>
  );
}
