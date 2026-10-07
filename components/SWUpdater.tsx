"use client";

import { useEffect } from "react";
import { Workbox } from "workbox-window";
import { withBase } from "@/lib/base";

export default function SWUpdater() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Don't register service worker in development to avoid HMR conflicts
    if (process.env.NODE_ENV === "development") return;

    // its scope is the folder it is served from: the base, never main's root
    const wb = new Workbox(withBase("/sw.js"), { scope: withBase("/") });
    let prompted = false;

    wb.addEventListener("waiting", () => {
      // TODO: Replace with your own toast/dialog UX. For now, auto-activate.
      if (!prompted) {
        prompted = true;
        wb.messageSkipWaiting();
      }
    });

    // only a new version taking over reloads; the first worker of a first
    // visit takes over a page that is already current
    wb.addEventListener("controlling", (event) => {
      if (event.isUpdate) window.location.reload();
    });

    wb.register().catch(() => {
      // no-op: ignore registration failure in dev or unsupported contexts
    });
  }, []);

  return null;
}
