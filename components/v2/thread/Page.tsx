"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { HEIGHT, SANDBOX } from "./pageDoc";

/* The page in the thread: as tall as it draws itself, up to most of the
   window, past which it scrolls inside its box. A page drawn to its window's
   height (and a margin more) would grow the box each time it is told the new
   height: once it grows by the same overhang twice, the box stays. */
export function PageBox({ doc, label }: { doc: string; label: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState<number>();
  useEffect(() => {
    let over = -1;
    // only this box's own window is listened to, and only for two numbers
    const on = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const got: unknown = typeof e.data === "object" && e.data ? (e.data as Record<string, unknown>)[HEIGHT] : undefined;
      if (!Array.isArray(got) || !got.every((n) => typeof n === "number" && Number.isFinite(n))) return;
      const [page, view] = got as number[];
      const was = over;
      over = page > view ? page - view : -1;
      if (over < 0 || over !== was) setH(Math.max(48, Math.ceil(page)));
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  return <iframe ref={frame} className="rd-page" title={label} sandbox={SANDBOX} srcDoc={doc} style={h ? { height: h } : undefined} />;
}

/* The page over the whole window, in the picture viewer's room, under a bar
   of the app's own that names it (so a page drawn like the app's wallet still
   reads as a page): Save and Close under it on a desktop, above it on a
   phone. The app behind is out of reach while it is open. */
export function PageViewer({ doc, label, onSave, onClose }: { doc: string; label: string; onSave: () => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  const closing = useRef(false);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => {
      setOn(true);
      root.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const behind = Array.from(root.current?.parentElement?.children ?? []).filter(
      (el): el is HTMLElement => el !== root.current && el instanceof HTMLElement && !el.inert
    );
    behind.forEach((el) => (el.inert = true));
    return () => {
      behind.forEach((el) => (el.inert = false));
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setOn(false);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(onClose, reduce ? 0 : 220);
  }, [onClose]);

  // Esc closes while the app has the keys (inside the page, the page has them)
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  const host = typeof document !== "undefined" ? document.querySelector(".v2") ?? document.body : null;
  if (!host) return null;
  return createPortal(
    <div className="rd-viewer rd-pageview" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={root} data-on={on ? "" : undefined} onKeyDown={onKey}>
      <div className="rd-viewer-scrim" onClick={close} />
      <iframe className="rd-pageview-frame" title={label} sandbox={SANDBOX} srcDoc={doc} />
      <div className="rd-viewer-bar">
        <span className="rd-pageview-t">{label}</span>
        <button type="button" className="rd-vbtn" data-save="" onClick={onSave} aria-label="Save">
          <Icon name="download" size={16} />
          <span>Save</span>
        </button>
        <button type="button" className="rd-vbtn" data-close="" onClick={close} aria-label="Close">
          <Icon name="close" size={16} />
          <span>Close</span>
        </button>
      </div>
    </div>,
    host
  );
}
