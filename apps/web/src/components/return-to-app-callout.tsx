"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  CheckIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReturnToAppCallout({
  title,
  description,
  href,
  placement = "floating",
}: {
  title: string;
  description: string;
  href: string;
  placement?: "floating" | "inline";
}) {
  const card = (
    <div className="relative w-full animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
      <div className="callout-gradient-border absolute -inset-[1px] rounded-2xl" />
      <div className="callout-focus-glow absolute -inset-2 rounded-2xl" />
      <div className="pointer-events-auto relative rounded-2xl border border-border/60 bg-background/95 px-4 py-3 shadow-xl shadow-black/10 backdrop-blur-md">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <CheckIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{title}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {description}
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href={href}>
                Back to app
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  if (placement === "inline") {
    return <div className="mt-6">{card}</div>;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div className="w-full max-w-xl">
        {card}
      </div>
    </div>
  );
}
