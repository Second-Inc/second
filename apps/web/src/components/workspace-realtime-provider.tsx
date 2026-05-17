"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { WorkspaceEvent } from "@/lib/events/workspace-events";
import { subscribeToSharedEventSource } from "@/lib/tab-events";

type WorkspaceRealtimeListener = (event: WorkspaceEvent) => void;

type WorkspaceRealtimeContextValue = {
  workspaceId: string;
  subscribe: (listener: WorkspaceRealtimeListener) => () => void;
};

const WorkspaceRealtimeContext =
  createContext<WorkspaceRealtimeContextValue | null>(null);

function parseWorkspaceEvent(
  raw: string,
  expectedWorkspaceId: string,
): WorkspaceEvent | null {
  let event: WorkspaceEvent;
  try {
    event = JSON.parse(raw) as WorkspaceEvent;
  } catch {
    return null;
  }

  if (event.version !== 1) return null;
  if (event.workspaceId !== expectedWorkspaceId) return null;
  if (typeof event.type !== "string" || typeof event.scope !== "string") {
    return null;
  }

  return event;
}

export function WorkspaceRealtimeProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const listenersRef = useRef(new Set<WorkspaceRealtimeListener>());

  const subscribe = useCallback((listener: WorkspaceRealtimeListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    return subscribeToSharedEventSource(
      `/api/workspaces/${workspaceId}/events`,
      "workspace-events",
      (rawEvent) => {
        const event = parseWorkspaceEvent(rawEvent, workspaceId);
        if (!event) return;

        for (const listener of [...listenersRef.current]) {
          startTransition(() => listener(event));
        }
      },
    );
  }, [workspaceId]);

  const value = useMemo(
    () => ({
      workspaceId,
      subscribe,
    }),
    [subscribe, workspaceId],
  );

  return (
    <WorkspaceRealtimeContext.Provider value={value}>
      {children}
    </WorkspaceRealtimeContext.Provider>
  );
}

export function useWorkspaceRealtimeEvent(
  listener: WorkspaceRealtimeListener,
): void {
  const context = useContext(WorkspaceRealtimeContext);
  const listenerRef = useRef(listener);

  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);

  useEffect(() => {
    if (!context) return;
    return context.subscribe((event) => listenerRef.current(event));
  }, [context]);
}
