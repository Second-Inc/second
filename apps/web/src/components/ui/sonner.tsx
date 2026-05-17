"use client";

import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster({ toastOptions, style, ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      theme="system"
      closeButton
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast:
            "group-[.toaster]:border-border group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-lg group-[.toaster]:ring-1 group-[.toaster]:ring-foreground/5",
          description: "group-[.toaster]:text-muted-foreground",
          icon: "group-[.toaster]:text-muted-foreground",
          closeButton:
            "group-[.toaster]:border-border group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground",
          ...toastOptions?.classNames,
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--popover)",
          "--success-text": "var(--popover-foreground)",
          "--success-border": "var(--border)",
          "--info-bg": "var(--popover)",
          "--info-text": "var(--popover-foreground)",
          "--info-border": "var(--border)",
          "--warning-bg": "var(--popover)",
          "--warning-text": "var(--popover-foreground)",
          "--warning-border": "var(--border)",
          "--error-bg": "var(--popover)",
          "--error-text": "var(--popover-foreground)",
          "--error-border": "var(--border)",
          "--border-radius": "var(--radius)",
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
