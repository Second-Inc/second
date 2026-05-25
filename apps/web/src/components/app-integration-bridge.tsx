"use client";

import { useCallback, useEffect } from "react";

type AppIntegrationBridgeProps = {
  workspaceId: string;
  appId: string;
  sourceVersion: "draft" | "published";
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
};

type IntegrationBridgeResponse = {
  success?: boolean;
  data?: unknown;
  mock?: boolean;
  mockReason?: string;
  statusCode?: number;
  error?: string;
  errorCode?: string;
  errorCategory?: string;
  resolution?: string;
  retryable?: boolean;
  canRequestBuilderRepair?: boolean;
  details?: Record<string, unknown>;
};

type IntegrationFailureReportResponse = {
  ok?: boolean;
  status?: string;
  builderRunId?: string;
  appendedToExisting?: boolean;
  error?: string;
  message?: string;
};

export function AppIntegrationBridge({
  workspaceId,
  appId,
  sourceVersion,
  iframeRef,
}: AppIntegrationBridgeProps) {
  const postToIframe = useCallback(
    (data: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage(
        { source: "second-platform", ...data },
        "*",
      );
    },
    [iframeRef],
  );

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow || event.source !== iframeWindow) return;

      const data = event.data;
      if (data?.source !== "second-app") return;

      const requestId =
        typeof data.requestId === "string" ? data.requestId : "";
      const toolName = typeof data.toolName === "string" ? data.toolName : "";
      if (
        data.type !== "second:integration:execute" &&
        data.type !== "second:integration:report-failure"
      ) {
        return;
      }

      if (!requestId || !toolName) {
        postToIframe({
          type: data.type === "second:integration:report-failure"
            ? "second:integration:report-failure-response"
            : "second:integration:execute-response",
          requestId,
          toolName,
          success: false,
          mock: false,
          error: "requestId and toolName are required.",
        });
        return;
      }

      if (data.type === "second:integration:report-failure") {
        try {
          const versionParam = `version=${encodeURIComponent(sourceVersion)}`;
          const res = await fetch(
            `/api/workspaces/${workspaceId}/apps/${appId}/app-tools/${encodeURIComponent(toolName)}/report-failure?${versionParam}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                input: data.input ?? {},
                result: data.result ?? {},
                description: data.description,
                attemptedTask: data.attemptedTask,
              }),
            },
          );
          const json = (await res.json().catch(() => null)) as
            | IntegrationFailureReportResponse
            | null;

          postToIframe({
            type: "second:integration:report-failure-response",
            requestId,
            toolName,
            ok: Boolean(json?.ok),
            status: json?.status,
            builderRunId: json?.builderRunId,
            appendedToExisting: json?.appendedToExisting,
            error: json?.error ?? json?.message ?? (res.ok ? undefined : `Request failed: ${res.status}`),
          });
        } catch (err) {
          postToIframe({
            type: "second:integration:report-failure-response",
            requestId,
            toolName,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      try {
        const versionParam = `version=${encodeURIComponent(sourceVersion)}`;
        const res = await fetch(
          `/api/workspaces/${workspaceId}/apps/${appId}/app-tools/${encodeURIComponent(toolName)}/execute?${versionParam}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input: data.input ?? {} }),
          },
        );
        const json = (await res.json().catch(() => null)) as
          | IntegrationBridgeResponse
          | null;

        postToIframe({
          type: "second:integration:execute-response",
          requestId,
          toolName,
          success: Boolean(json?.success),
          data: json?.data,
          mock: Boolean(json?.mock),
          mockReason: json?.mockReason,
          statusCode: json?.statusCode ?? res.status,
          error: json?.error ?? (res.ok ? undefined : `Request failed: ${res.status}`),
          errorCode: json?.errorCode,
          errorCategory: json?.errorCategory,
          resolution: json?.resolution,
          retryable: json?.retryable,
          canRequestBuilderRepair: json?.canRequestBuilderRepair,
          details: json?.details,
        });
      } catch (err) {
        postToIframe({
          type: "second:integration:execute-response",
          requestId,
          toolName,
          success: false,
          mock: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [workspaceId, appId, sourceVersion, iframeRef, postToIframe]);

  return null;
}
