"use client";

import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { AlertTriangleIcon, RefreshCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/client-error-reporting";
import { cn } from "@/lib/utils";

type RecoverableErrorBoundaryProps = {
  name: string;
  children: ReactNode;
  resetKey?: string | number | null;
  className?: string;
  onReset?: () => void;
  fallbackTitle?: string;
  fallbackDescription?: string;
};

type RecoverableErrorBoundaryState = {
  error: Error | null;
};

export class RecoverableErrorBoundary extends Component<
  RecoverableErrorBoundaryProps,
  RecoverableErrorBoundaryState
> {
  state: RecoverableErrorBoundaryState = { error: null };

  private handleReset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(
      `[RecoverableErrorBoundary:${this.props.name}]`,
      error.message,
      info.componentStack,
    );
    toast.error("Something went wrong.", {
      description: "We sent the error to the Second team.",
    });
    void reportClientError({
      source: "component-error-boundary",
      error,
      componentStack: info.componentStack,
      context: { component: this.props.name },
    });
  }

  componentDidUpdate(prevProps: RecoverableErrorBoundaryProps) {
    if (
      this.state.error &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center bg-background p-4",
          this.props.className,
        )}
      >
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="flex size-9 items-center justify-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive">
            <AlertTriangleIcon className="size-4" />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">
              {this.props.fallbackTitle ?? "This section hit an error"}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {this.props.fallbackDescription ??
                "The rest of Second is still usable. We sent the error report."}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={this.handleReset}
          >
            <RefreshCcwIcon data-icon="inline-start" />
            Try again
          </Button>
        </div>
      </div>
    );
  }
}
