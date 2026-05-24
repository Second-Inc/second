"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  BugIcon,
  CheckCircle2Icon,
  RotateCcwIcon,
  SendIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RecoverableErrorBoundary } from "@/components/recoverable-error-boundary";
import { readAnalyticsConsent } from "@/lib/analytics";
import { reportClientError } from "@/lib/client-error-reporting";
import { browserAllowsSentry, readSentryDsn } from "@/lib/sentry-public-config";

type DiagnosticsClientProps = {
  workspaceId: string;
};

function readProjectId(dsn: string): string {
  try {
    return new URL(dsn).pathname.replace(/^\/+/, "") || "unknown";
  } catch {
    return "unknown";
  }
}

function CrashOnRender({ nonce }: { nonce: number }): ReactNode {
  throw new Error(`Second recoverable diagnostics crash ${nonce}`);
}

function CrashHarness({ workspaceId }: { workspaceId: string }) {
  const [crashNonce, setCrashNonce] = useState<number | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const reset = () => {
    setCrashNonce(null);
    setResetKey((value) => value + 1);
  };

  return (
    <div className="flex flex-col gap-3">
      <RecoverableErrorBoundary
        name="settings-diagnostics-crash-test"
        resetKey={resetKey}
        onReset={reset}
        className="min-h-48 rounded-lg border border-border bg-card"
      >
        <div className="flex min-h-48 flex-col justify-between rounded-lg border border-dashed border-border bg-muted/20 p-4">
          {crashNonce === null ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2Icon className="size-4 text-muted-foreground" />
                Recoverable area is healthy
              </div>
              <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
                This button throws during React render inside a local error
                boundary. The expected result is a toast, a local fallback, and
                a Sentry issue without taking down the whole settings page.
              </p>
            </div>
          ) : (
            <CrashOnRender nonce={crashNonce} />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => setCrashNonce(Date.now())}
            >
              <BugIcon data-icon="inline-start" />
              Trigger recoverable crash
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={reset}
            >
              <RotateCcwIcon data-icon="inline-start" />
              Reset test area
            </Button>
          </div>
        </div>
      </RecoverableErrorBoundary>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Workspace: <span className="font-mono">{workspaceId}</span>
      </p>
    </div>
  );
}

export default function DiagnosticsClient({
  workspaceId,
}: DiagnosticsClientProps) {
  const dsn = readSentryDsn();
  const projectId = useMemo(() => readProjectId(dsn), [dsn]);
  const sentryEnabled =
    Boolean(dsn) &&
    browserAllowsSentry() &&
    readAnalyticsConsent().shareUsageData;
  const [sending, setSending] = useState(false);

  const sendManualReport = async () => {
    setSending(true);
    try {
      const sent = await reportClientError({
        source: "manual-diagnostics",
        error: new Error(`Second manual Sentry diagnostics test ${Date.now()}`),
        context: {
          workspace_id: workspaceId,
          diagnostic_kind: "manual-report",
          sentry_project_id: projectId,
        },
      });

      if (sent) {
        toast.success("Sent Sentry diagnostics report.");
      } else {
        toast.info("Sentry diagnostics report was not sent.", {
          description:
            "Error reporting may be disabled, consent may be off, or this event was deduped.",
        });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-8 pt-8 pb-5">
        <div className="mx-auto max-w-5xl">
          <div
            data-second-desktop-drag-region
            className="flex items-start justify-between gap-4"
          >
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Diagnostics
              </h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Test error reporting and local crash recovery for this workspace.
              </p>
            </div>
            <Badge variant={sentryEnabled ? "secondary" : "outline"}>
              {sentryEnabled ? "Sentry enabled" : "Sentry disabled"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 pb-10">
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>Use this page only for diagnostics.</AlertTitle>
            <AlertDescription>
              These actions intentionally create test errors. They do not change
              workspace data, but they will create events in Sentry when error
              reporting is enabled.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Sentry report</CardTitle>
              <CardDescription>
                Sends one handled error through the same client reporting path
                used by window errors and recoverable UI boundaries.
              </CardDescription>
              <CardAction>
                <Button
                  type="button"
                  size="sm"
                  onClick={sendManualReport}
                  disabled={sending}
                >
                  <SendIcon data-icon="inline-start" />
                  {sending ? "Sending" : "Send test report"}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>Project</span>
                  <span className="font-mono text-foreground">second-next</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>Project ID</span>
                  <span className="font-mono text-foreground">{projectId}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recoverable crash</CardTitle>
              <CardDescription>
                Throws during render inside a recoverable boundary so you can
                verify the app stays usable and Sentry receives the crash.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CrashHarness workspaceId={workspaceId} />
            </CardContent>
            <Separator />
            <CardContent>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Source maps are verified in Sentry by opening the created issue
                and checking whether the stack points back to files under
                <span className="font-mono"> apps/web/src/</span> instead of
                minified Next.js chunks.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
