"use client";

import { useEffect } from "react";

/**
 * Reports that the visitor has left the site.
 *
 * What is and is not detectable here is the whole point of the component:
 *
 * - **Moving between pages of the wiki is already known**, and not by this. Each
 *   page render broadcasts its own event under the visitor's session, so opening
 *   another article simply walks their avatar into the next room. Nothing extra
 *   is needed, and nothing here fires: a client-side navigation does not raise
 *   `pagehide`, which is exactly the behaviour wanted.
 * - **Leaving the site is not knowable server-side at all** — no request is made
 *   when a tab closes — so it takes a beacon from the page itself.
 *
 * `pagehide` rather than `visibilitychange`: switching tabs hides a page without
 * leaving it, and reporting that as a departure would walk an avatar off the
 * floor every time its reader glanced at something else. `sendBeacon` rather
 * than `fetch`, because a request started during unload is otherwise cancelled.
 */
export function VisitBeacon() {
  useEffect(() => {
    const report = (): void => {
      // No payload: the endpoint derives the session from the request itself.
      navigator.sendBeacon?.("/api/v1/events/leave", new Blob([], { type: "text/plain" }));
    };
    window.addEventListener("pagehide", report);
    return () => window.removeEventListener("pagehide", report);
  }, []);

  return null;
}
