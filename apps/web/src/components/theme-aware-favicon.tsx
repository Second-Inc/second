"use client";

import { useEffect } from "react";

const LIGHT_FAVICON = "/favicon-light.svg?v=2";
const DARK_FAVICON = "/favicon-dark.svg?v=2";
const FAVICON_SELECTOR = 'link[rel~="icon"][data-second-theme-favicon="true"]';

function setFavicon(href: string) {
  document.querySelectorAll(FAVICON_SELECTOR).forEach((link) => link.remove());

  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = href;
  link.setAttribute("data-second-theme-favicon", "true");
  document.head.appendChild(link);
}

export function ThemeAwareFavicon() {
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncFavicon = () =>
      setFavicon(mediaQuery.matches ? DARK_FAVICON : LIGHT_FAVICON);

    syncFavicon();
    mediaQuery.addEventListener("change", syncFavicon);

    return () => mediaQuery.removeEventListener("change", syncFavicon);
  }, []);

  return null;
}
