"use client";

import dynamic from "next/dynamic";
import { Loader2, WaypointsIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="top-2 right-2 bottom-2 left-2 flex h-auto w-auto max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-2xl p-0 sm:top-4 sm:right-4 sm:bottom-4 sm:left-4 sm:max-w-none md:top-6 md:right-6 md:bottom-6 md:left-6 lg:top-8 lg:right-8 lg:bottom-8 lg:left-8">
        <DialogHeader className="flex-row items-center gap-2.5 border-b border-border px-3.5 py-2.5 pr-12">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/50 text-foreground/80">
            <WaypointsIcon className="size-4" strokeWidth={1.75} />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="shrink-0 text-[13px] font-semibold tracking-[-0.01em] text-foreground">
              Architecture
            </DialogTitle>
            <span
              className="size-1 shrink-0 rounded-full bg-border"
              aria-hidden
            />
            <span className="truncate text-[13px] text-muted-foreground">
              {appName}
            </span>
          </div>
        </DialogHeader>

        <div className="relative min-h-0 flex-1">
          <AppArchitecture workspaceId={workspaceId} appId={appId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
