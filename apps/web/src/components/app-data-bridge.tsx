"use client";

import { useCallback, useEffect, useRef } from "react";
import { subscribeToSharedEventSource } from "@/lib/tab-events";

type AppDataBridgeProps = {
  workspaceId: string;
  appId: string;
  sourceVersion: "draft" | "published";
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onDataChange?: (change: AppDataLiveChange) => void;
};

export type AppDataLiveChange = {
  type: "insert" | "update" | "delete";
  sourceVersion: "draft" | "published";
  collection: string;
  doc?: unknown;
  docId?: string;
};

export function AppDataBridge({
  workspaceId,
  appId,
  sourceVersion,
  iframeRef,
  onDataChange,
}: AppDataBridgeProps) {
  const pendingChangesRef = useRef<AppDataLiveChange[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const flushLiveChangesRef = useRef<() => void>(() => {});

  const postToIframe = useCallback(
    (data: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage(
        { source: "second-platform", ...data },
        "*",
      );
    },
    [iframeRef],
  );

  const flushLiveChanges = useCallback(() => {
    flushTimerRef.current = null;

    const batch = pendingChangesRef.current.splice(0, 24);
    for (const change of batch) {
      onDataChange?.(change);
      postToIframe({
        type: "second:data:change",
        collection: change.collection,
        operation: change.type,
        doc: change.doc,
        docId: change.docId,
      });
    }

    if (pendingChangesRef.current.length > 0) {
      flushTimerRef.current = window.setTimeout(() => {
        flushLiveChangesRef.current();
      }, 16);
    }
  }, [onDataChange, postToIframe]);

  useEffect(() => {
    flushLiveChangesRef.current = flushLiveChanges;
  }, [flushLiveChanges]);

  const enqueueLiveChange = useCallback(
    (change: AppDataLiveChange) => {
      pendingChangesRef.current.push(change);
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(() => {
        flushLiveChangesRef.current();
      }, 50);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingChangesRef.current = [];
    };
  }, []);

  // Handle CRUD postMessage events from the iframe
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow || event.source !== iframeWindow) return;

      const data = event.data;
      if (data?.source !== "second-app") return;

      const versionParam = `version=${encodeURIComponent(sourceVersion)}`;
      const basePath = `/api/workspaces/${workspaceId}/apps/${appId}/data`;
      const dataPath = `${basePath}?${versionParam}`;

      // List docs
      if (data.type === "second:data:list") {
        try {
          const res = await fetch(
            `${dataPath}&collection=${encodeURIComponent(data.collection)}`,
          );
          const json = (await res.json()) as { docs: unknown[] };
          postToIframe({
            type: "second:data:list-response",
            collection: data.collection,
            requestId: data.requestId,
            docs: json.docs ?? [],
          });
        } catch {
          postToIframe({
            type: "second:data:list-response",
            collection: data.collection,
            requestId: data.requestId,
            docs: [],
          });
        }
        return;
      }

      // Get single doc
      if (data.type === "second:data:doc") {
        try {
          const res = await fetch(
            `${basePath}/${data.docId}?${versionParam}&collection=${encodeURIComponent(data.collection)}`,
          );
          const json = (await res.json()) as { doc: unknown };
          postToIframe({
            type: "second:data:doc-response",
            collection: data.collection,
            requestId: data.requestId,
            doc: json.doc ?? null,
          });
        } catch {
          postToIframe({
            type: "second:data:doc-response",
            collection: data.collection,
            requestId: data.requestId,
            doc: null,
          });
        }
        return;
      }

      // Insert doc
      if (data.type === "second:data:insert") {
        try {
          const res = await fetch(dataPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              collection: data.collection,
              data: data.data,
            }),
          });
          const json = (await res.json()) as { doc: unknown };
          postToIframe({
            type: "second:data:insert-response",
            collection: data.collection,
            requestId: data.requestId,
            doc: json.doc,
          });
        } catch {
          postToIframe({
            type: "second:data:insert-response",
            collection: data.collection,
            requestId: data.requestId,
            doc: null,
          });
        }
        return;
      }

      // Update doc
      if (data.type === "second:data:update") {
        try {
          const res = await fetch(`${basePath}/${data.docId}?${versionParam}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              collection: data.collection,
              data: data.data,
            }),
          });
          const json = (await res.json()) as { doc: unknown };
          postToIframe({
            type: "second:data:update-response",
            collection: data.collection,
            requestId: data.requestId,
            docId: data.docId,
            doc: json.doc,
          });
        } catch {
          postToIframe({
            type: "second:data:update-response",
            collection: data.collection,
            requestId: data.requestId,
            docId: data.docId,
            doc: null,
          });
        }
        return;
      }

      // Delete doc
      if (data.type === "second:data:delete") {
        try {
          await fetch(
            `${basePath}/${data.docId}?${versionParam}&collection=${encodeURIComponent(data.collection)}`,
            { method: "DELETE" },
          );
          postToIframe({
            type: "second:data:delete-response",
            collection: data.collection,
            requestId: data.requestId,
            docId: data.docId,
          });
        } catch {
          postToIframe({
            type: "second:data:delete-response",
            collection: data.collection,
            requestId: data.requestId,
            docId: data.docId,
          });
        }
        return;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [workspaceId, appId, sourceVersion, iframeRef, postToIframe]);

  // Subscribe to Change Stream SSE for live updates
  useEffect(() => {
    const streamUrl = `/api/workspaces/${workspaceId}/apps/${appId}/data/stream?version=${encodeURIComponent(sourceVersion)}`;
    return subscribeToSharedEventSource(streamUrl, "app-data-events", (data) => {
      try {
        const change = JSON.parse(data) as Omit<
          AppDataLiveChange,
          "sourceVersion"
        >;
        const scopedChange: AppDataLiveChange = {
          ...change,
          sourceVersion,
        };
        enqueueLiveChange(scopedChange);
      } catch {
        // Ignore malformed events
      }
    });
  }, [workspaceId, appId, sourceVersion, enqueueLiveChange]);

  return null;
}
