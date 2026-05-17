/**
 * Cross-tab SSE event sharing.
 *
 * Problem: each browser tab opening its own EventSource to the same
 * long-lived SSE endpoint consumes one persistent HTTP connection. Browsers limit
 * concurrent connections per origin to ~6 (HTTP/1.1), so 4+ tabs can
 * exhaust the budget and block page loads, API calls, and stream
 * resume requests.
 *
 * Solution: only one tab (the "leader") maintains the live EventSource.
 * Events are relayed to every other tab via BroadcastChannel. The Web
 * Locks API handles leader election — when the leader closes, the next
 * tab in line automatically takes over.
 *
 * Falls back to a plain per-tab EventSource when BroadcastChannel or
 * Web Locks are unavailable (older browsers, non-secure contexts).
 */

type EventCallback = (data: string) => void;

/**
 * Subscribe to an SSE endpoint, shared across browser tabs.
 *
 * Only one tab holds an actual EventSource connection to `eventsUrl`.
 * All tabs (including the leader) receive events through `onEvent`.
 *
 * @returns cleanup function — call it to unsubscribe.
 */
export function subscribeToSharedEventSource(
  eventsUrl: string,
  channelPrefix: string,
  onEvent: EventCallback,
): () => void {
  // Fallback: per-tab EventSource when sharing APIs are unavailable
  if (
    typeof BroadcastChannel === "undefined" ||
    typeof navigator === "undefined" ||
    !("locks" in navigator)
  ) {
    const es = new EventSource(eventsUrl);
    es.onmessage = (event) => onEvent(event.data);
    return () => es.close();
  }

  const channelName = `${channelPrefix}:${eventsUrl}`;
  const lockName = `${channelPrefix}-leader:${eventsUrl}`;
  const bc = new BroadcastChannel(channelName);

  let disposed = false;
  let eventSource: EventSource | null = null;
  let releaseLock: (() => void) | null = null;
  const abortController = new AbortController();

  // Every tab listens on BroadcastChannel for events relayed by the leader.
  bc.onmessage = (msg) => {
    if (disposed) return;
    if (msg.data?.t === "e") {
      onEvent(msg.data.d);
    }
  };

  // Try to acquire the leader lock.  The callback returns a Promise that
  // stays pending as long as this tab should remain leader — resolving it
  // releases the lock and lets the next tab take over.
  navigator.locks
    .request(lockName, { signal: abortController.signal }, () => {
      return new Promise<void>((resolve) => {
        // Store resolve first so cleanup can release even if it races
        // with the callback (JS is single-threaded so one of these
        // orderings always holds, no interleaving).
        releaseLock = resolve;

        if (disposed) {
          resolve();
          return;
        }

        const es = new EventSource(eventsUrl);
        eventSource = es;

        es.onmessage = (event) => {
          if (disposed) return;
          // Deliver to own handler
          onEvent(event.data);
          // Relay to other tabs
          try {
            bc.postMessage({ t: "e", d: event.data });
          } catch {
            // BroadcastChannel already closed
          }
        };
      });
    })
    .catch(() => {
      // Lock request aborted (cleanup called while waiting) — expected
    });

  return () => {
    disposed = true;
    eventSource?.close();
    if (releaseLock) {
      // We are the leader — release the lock so another tab can take over
      releaseLock();
    } else {
      // We are a follower waiting for the lock — cancel the request
      abortController.abort();
    }
    try {
      bc.close();
    } catch {
      // Already closed
    }
  };
}

/**
 * Subscribe to run lifecycle events, shared across browser tabs.
 */
export function subscribeToRunEvents(
  eventsUrl: string,
  onEvent: EventCallback,
): () => void {
  return subscribeToSharedEventSource(eventsUrl, "run-events", onEvent);
}
