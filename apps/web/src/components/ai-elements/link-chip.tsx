"use client";

import { memo, type ComponentProps, type ReactNode } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function faviconUrl(url: string): string {
  try {
    const origin = new URL(url).origin;
    return `https://www.google.com/s2/favicons?sz=32&domain=${origin}`;
  } catch {
    return "";
  }
}

function childrenToText(children: ReactNode): string | null {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }

  if (!Array.isArray(children)) return null;

  const textParts: string[] = [];
  for (const child of children) {
    if (typeof child === "string" || typeof child === "number") {
      textParts.push(String(child));
      continue;
    }
    return null;
  }
  return textParts.join("");
}

export function splitPipedLinkLabel(
  value: string,
): { primary: string; secondary: string } | null {
  const pipeIndex = value.indexOf("|");
  if (pipeIndex < 0) return null;

  const primary = value.slice(0, pipeIndex).trim();
  const secondary = value.slice(pipeIndex + 1).trim();
  if (!primary || !secondary) return null;

  return { primary, secondary };
}

/**
 * Drop-in replacement for the default `a` element rendered by
 * react-markdown. External links render as inline chips with favicons;
 * same-page anchors stay plain.
 */
export const LinkChip = memo(function LinkChip({
  href,
  children,
  className,
  ...props
}: ComponentProps<"a">) {
  const url = href ?? "";
  const isExternal = url.startsWith("http");

  if (!isExternal) {
    return (
      <a href={url} className={className} {...props}>
        {children}
      </a>
    );
  }

  const icon = faviconUrl(url);
  const pipedLabel = splitPipedLinkLabel(childrenToText(children) ?? "");

  if (pipedLabel) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "not-prose mx-0.5 inline-flex h-5.5 max-w-full items-center gap-1.5 rounded-lg border border-border/80 bg-background/90 px-2 align-middle text-xs leading-none font-normal whitespace-nowrap no-underline text-foreground shadow-[0_1px_0_rgba(0,0,0,0.04)] transition-colors hover:border-border hover:bg-muted/50 hover:text-foreground dark:shadow-sm",
          className,
        )}
        {...props}
      >
        {icon && (
          <span className="flex size-3.5 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-border/50 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={icon}
              alt=""
              width={14}
              height={14}
              className="size-3.5 object-contain"
            />
          </span>
        )}
        <span className="min-w-0 truncate font-medium">
          {pipedLabel.primary}
        </span>
        <span className="min-w-0 truncate text-foreground/60">
          {pipedLabel.secondary}
        </span>
        <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "not-prose inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-xs leading-tight font-normal no-underline text-foreground/80 transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    >
      {icon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={icon}
          alt=""
          width={12}
          height={12}
          className="size-3 rounded-sm"
        />
      )}
      <span className="max-w-[220px] truncate">{children}</span>
      <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
    </a>
  );
});
