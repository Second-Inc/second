const NAVIGATION_INTENT_EVENT = "second:navigation-intent";

type NavigationClickEvent = {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  currentTarget: HTMLAnchorElement;
};

function abortError(message: string): DOMException | Error {
  if (typeof DOMException === "function") {
    return new DOMException(message, "AbortError");
  }

  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function abortForNavigation(
  controller: AbortController,
  reason = "Navigation superseded this request.",
): void {
  if (controller.signal.aborted) return;
  controller.abort(abortError(reason));
}

export function announceNavigationIntent(href?: string): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(NAVIGATION_INTENT_EVENT, {
      detail: { href },
    }),
  );
}

export function announceNavigationIntentFromClick(
  event: NavigationClickEvent,
): void {
  if (typeof window === "undefined") return;
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const anchor = event.currentTarget;
  if (anchor.target && anchor.target !== "_self") return;
  if (anchor.hasAttribute("download")) return;

  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return;
  }

  if (url.origin !== window.location.origin) return;

  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;

  announceNavigationIntent(url.href);
}

export function subscribeNavigationIntent(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(NAVIGATION_INTENT_EVENT, listener);
  return () => {
    window.removeEventListener(NAVIGATION_INTENT_EVENT, listener);
  };
}
