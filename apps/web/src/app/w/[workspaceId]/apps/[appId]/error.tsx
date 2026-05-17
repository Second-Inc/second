"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ArrowLeftIcon, RefreshCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/client-error-reporting";

export default function AppRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    void reportClientError({
      source: "route-error-boundary",
      error,
      context: {
        route: "/w/[workspaceId]/apps/[appId]",
        digest: error.digest,
      },
    });
  }, [error]);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-10 items-center justify-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive">
          <AlertTriangleIcon className="size-5" />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            This app page could not load
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            The error was reported. Reload this app page, or go back to the workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={reset}>
            <RefreshCcwIcon data-icon="inline-start" />
            Reload
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => router.back()}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Go back
          </Button>
        </div>
      </div>
    </div>
  );
}
