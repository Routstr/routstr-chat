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
    const script = withBase("/sw.js");
    const wb = new Workbox(script, { scope: withBase("/") });
    // a page this app's own worker already runs: only then is a worker taking
    // over a new version. Beside main, main's worker (scope /) may hold the
    // page first, and this one taking it from main is no update.
    const ours = navigator.serviceWorker.controller?.scriptURL === new URL(script, window.location.href).href;
    let prompted = false;

    wb.addEventListener("waiting", () => {
      // TODO: Replace with your own toast/dialog UX. For now, auto-activate.
      if (!prompted) {
        prompted = true;
        wb.messageSkipWaiting();
      }
    });

    // only a new version of this app's worker reloads the page; its first
    // worker takes over a page that is already current
    wb.addEventListener("controlling", () => {
      if (ours) window.location.reload();
    });

    wb.register().catch(() => {
      // no-op: ignore registration failure in dev or unsupported contexts
    });
  }, []);

  return null;
}
