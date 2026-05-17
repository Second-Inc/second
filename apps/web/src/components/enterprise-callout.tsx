"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowRight, Building2, Globe, Info, Laptop, Zap } from "lucide-react"

type EnterpriseCalloutProps = {
  /** Explains why this specific screen is shown locally instead of being pre-configured. */
  reason: string;
};

const iconGradientStyle = {
  backgroundColor: "hsla(259,84%,37%,1)",
  backgroundImage:
    "radial-gradient(circle at 20% 55%, hsla(248,82%,99%,1) 13%,transparent 67%),radial-gradient(circle at 26% 19%, hsla(318,83%,77%,1) 16%,transparent 58%),radial-gradient(circle at 37% 0%, hsla(302,95%,45%,1) 2%,transparent 60%),radial-gradient(circle at 38% 72%, hsla(210,87%,65%,1) 19%,transparent 85%),radial-gradient(circle at 39% 60%, hsla(317,98%,84%,1) 5%,transparent 61%)",
  backgroundBlendMode: "normal,normal,normal,normal,normal",
} as React.CSSProperties;


export function LocalModeNotice() {
  return (
    <button
      type="button"
      onClick={() => document.dispatchEvent(new CustomEvent("open-deployment-options"))}
      className="group/badge relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border border-foreground/10 bg-muted px-2 py-0.5 hover:bg-muted/80 transition-colors cursor-pointer"
    >
      <span className="inline-flex items-center gap-1.5 transition-transform duration-200 group-hover/badge:-translate-x-4">
        <Info className="size-3 text-muted-foreground transition-opacity duration-200 group-hover/badge:opacity-0" strokeWidth={1.5} />
        <span className="text-[11px] font-medium text-muted-foreground">Local mode only</span>
      </span>
      <ArrowRight className="size-3 text-muted-foreground absolute right-2 translate-x-5 opacity-0 transition-all duration-200 group-hover/badge:translate-x-0 group-hover/badge:opacity-100" strokeWidth={1.5} />
    </button>
  );
}

export function EnterpriseCallout({ reason }: EnterpriseCalloutProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    document.addEventListener("open-deployment-options", handler);
    return () => document.removeEventListener("open-deployment-options", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <>
      {open && createPortal(
        <div className="fixed inset-0 z-40 flex flex-col items-center p-4 pt-[28vh]">
          {/* Overlay */}
          <div className="absolute inset-0 bg-background" onClick={() => setOpen(false)} />

          {/* Panel */}
          <div className="relative w-full max-w-sm rounded-lg bg-popover p-0 text-popover-foreground shadow-lg ring-1 ring-foreground/10 overflow-hidden animate-fade-in-up" style={{ animationDuration: "0.3s" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
              <div>
                <p className="text-xs/relaxed text-primary">
                  {reason.split(".")[0]}.
                </p>
                <p className="text-xs/relaxed text-primary font-semibold">
                  {reason.slice(reason.indexOf(".") + 2)}
                </p>
              </div>
              <a
                href="https://second.so"
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 ml-4 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-2"
              >
                second.so
                <ArrowRight className="size-2.5" />
              </a>
            </div>

            <div className="border-t mx-4" />

            {/* Options */}
            <div className="px-4 py-3 space-y-0">
              <div className="flex items-start gap-3 py-2.5">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted mt-0.5">
                  <Building2 className="size-3 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-xs font-medium">Local CLI</p>
                  <p className="text-xs/relaxed text-muted-foreground">
                    Run Second on a trusted workstation for evaluation.
                  </p>
                </div>
              </div>

              <div className="border-t border-foreground/5" />

              <div className="flex items-start gap-3 py-2.5">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted mt-0.5">
                  <Zap className="size-3 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-xs font-medium">Customer cloud</p>
                  <p className="text-xs/relaxed text-muted-foreground">
                    Deploy on-prem in your GCP environment.
                  </p>
                </div>
              </div>

              <div className="border-t border-foreground/5" />

              <div className="flex items-start gap-3 py-2.5">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted mt-0.5">
                  <Globe className="size-3 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-xs font-medium">Managed instance</p>
                  <p className="text-xs/relaxed text-muted-foreground">
                    Dedicated enterprise infrastructure operated with Second.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative z-50 w-full text-left"
      >
        <div className="callout-gradient-border absolute -inset-[1px] rounded-lg" />
        <div className="callout-focus-glow absolute -inset-1.5 rounded-lg" />
        <div className="relative inline-flex w-full items-center gap-3 rounded-lg bg-card px-3.5 py-3 transition-colors hover:bg-muted cursor-pointer">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-[10px] overflow-hidden"
            style={iconGradientStyle}
          >
            <div className="flex items-center justify-center rounded-md bg-black/50 p-1.5">
              <Laptop className="size-3.5 text-white" strokeWidth={1.5} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground">Enterprise deployment</p>
            <p className="text-xs/relaxed text-muted-foreground">Local, customer cloud, or managed instance</p>
          </div>
          <ArrowRight className="size-3 shrink-0 opacity-40" />
        </div>
      </button>
    </>
  )
}
