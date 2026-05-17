"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { captureAnalyticsEvent } from "@/lib/analytics";

type WorkspaceAnalyticsTrackerProps = {
  workspaceId: string;
};

export function WorkspaceAnalyticsTracker({
  workspaceId,
}: WorkspaceAnalyticsTrackerProps) {
  const pathname = usePathname();
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastTrackedPathRef.current === pathname) return;
    lastTrackedPathRef.current = pathname;

    void captureAnalyticsEvent("page viewed", {
      workspace_id: workspaceId,
    });
  }, [pathname, workspaceId]);

  return null;
}
