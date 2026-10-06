"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* ══ one tooltip for the whole thread: a rest delay, warm for half a second ══ */
export function Tips({ scope }: { scope: React.RefObject<HTMLElement | null> }) {
  const el = useRef<HTMLDivElement>(null);
  // the host is found after the first commit: a chat open at load mounts in
  // the same commit as .v2, so looking during render finds nothing
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => setHost(document.querySelector(".v2")), []);
  useEffect(() => {
    const root = scope.current;
    const tip = el.current;
    if (!root || !tip) return;
    let forBtn: HTMLElement | null = null;
    let timer = 0;
    let warm = 0;
    const show = (b: HTMLElement, now: boolean) => {
      window.clearTimeout(timer);
      const go = () => {
        forBtn = b;
        tip.textContent = b.dataset.tip ?? "";
        tip.style.left = "0px";
        tip.style.top = "0px";
        const r = b.getBoundingClientRect();
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        let x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
        let y = r.bottom + 6;
        const side = b.dataset.tipSide;
        if (side === "right") {
          x = r.right + 6;
          y = r.top + r.height / 2 - h / 2;
        } else if (side === "left") {
          x = r.left - w - 8;
          y = r.top + r.height / 2 - h / 2;
        } else if (y + h > window.innerHeight - 8) y = r.top - h - 6;
        tip.style.left = `${Math.round(x)}px`;
        tip.style.top = `${Math.round(y)}px`;
        tip.setAttribute("data-on", "");
      };
      if (now || performance.now() < warm) go();
      else timer = window.setTimeout(go, 400);
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (tip.hasAttribute("data-on")) warm = performance.now() + 500;
      tip.removeAttribute("data-on");
      forBtn = null;
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (b && b !== forBtn && !(b as HTMLButtonElement).disabled) show(b, false);
    };
    const out = (e: PointerEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (b && !b.contains(e.relatedTarget as Node)) hide();
    };
    const focus = (e: FocusEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (b?.matches(":focus-visible")) show(b, true);
    };
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerout", out);
    root.addEventListener("focusin", focus);
    root.addEventListener("focusout", hide);
    root.addEventListener("scroll", hide, { passive: true, capture: true });
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerout", out);
      root.removeEventListener("focusin", focus);
      root.removeEventListener("focusout", hide);
      root.removeEventListener("scroll", hide, { capture: true });
    };
  }, [scope, host]);
  return host ? createPortal(<div className="rd-tip" role="tooltip" ref={el} />, host) : null;
}
