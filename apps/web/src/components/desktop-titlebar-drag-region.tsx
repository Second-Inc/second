"use client";

import { usePathname } from "next/navigation";

/**
 * Global macOS desktop title-bar drag strip.
 *
 * Frameless desktop windows need a draggable region across the top of the
 * content area. Most workspace screens render this thin absolute strip so the
 * space beside the traffic lights can move the window.
 *
 * App detail pages (`/w/<id>/apps/<appId>`) are the exception: their top bar
 * renders its own draggable region inline, to the left of the action buttons.
 * Rendering the global strip there too would stack two drag regions over the
 * toolbar and capture clicks from the buttons, so we omit it on those routes.
 */
export function DesktopTitlebarDragRegion() {
  const pathname = usePathname();
  const isAppDetailView = /\/apps\/[^/]+/.test(pathname ?? "");

  if (isAppDetailView) {
    return null;
  }

  return <div data-second-desktop-titlebar-drag-region aria-hidden="true" />;
}
