"use client";

export function navigateToResponseUrl(response: Response, fallbackHref: string) {
  const destination = response.url
    ? new URL(response.url)
    : new URL(fallbackHref, window.location.origin);

  if (destination.origin !== window.location.origin) {
    window.location.assign(destination.href);
    return;
  }

  document.dispatchEvent(
    new CustomEvent("second:onboarding-navigate", {
      detail: {
        href: `${destination.pathname}${destination.search}${destination.hash}`,
      },
    }),
  );
}
