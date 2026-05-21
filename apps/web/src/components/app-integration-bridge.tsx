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
      if (data.type !== "second:integration:execute") return;

      const requestId =
        typeof data.requestId === "string" ? data.requestId : "";
      const toolName = typeof data.toolName === "string" ? data.toolName : "";
      if (!requestId || !toolName) {
        postToIframe({
          type: "second:integration:execute-response",
          requestId,
          toolName,
          success: false,
          mock: false,
          error: "requestId and toolName are required.",
        });
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
