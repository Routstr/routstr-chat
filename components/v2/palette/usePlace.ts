import React, { useCallback, useEffect, useLayoutEffect } from "react";
import { panelBox } from "../furniture";
import { phoneNow } from "./helpers";

export function usePlace(pk: React.RefObject<HTMLDivElement | null>, list: React.RefObject<HTMLDivElement | null>, phone: boolean) {
  /* ── where it sits: over the reading panel, never cutting the rail ─────── */
  const place = useCallback(() => {
    const el = pk.current;
    if (!el) return;
    if (phoneNow()) {
      el.style.removeProperty("--pk-x");
      el.style.removeProperty("--pk-w");
      el.removeAttribute("data-narrow");
      sizeSheet();
      return;
    }
    const panel = document.querySelector<HTMLElement>("[data-furniture='panel']");
    const r = panel ? panelBox(panel) : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const w = Math.round(Math.min(768, Math.max(560, r.width - 32), window.innerWidth - 48));
    el.style.setProperty("--pk-w", `${w}px`);
    el.toggleAttribute("data-narrow", w < 720);
    const cx = Math.max(24 + w / 2, Math.min(window.innerWidth - 24 - w / 2, r.left + r.width / 2));
    el.style.setProperty("--pk-x", `${Math.round(cx)}px`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* phone: as tall as what it holds (at least 60% of the screen), full height
     with the keyboard up. Laid out full height and slid down by what it does
     not need, so a size change is a transform, never a height animation */
  const sizeSheet = () => {
    const el = pk.current;
    const l = list.current;
    if (!el || !l || !phoneNow()) return;
    const vv = window.visualViewport;
    const kb = !!vv && vv.height < window.innerHeight - 120;
    const full = Math.round((kb && vv ? vv.height : window.innerHeight) - 40);
    const ls = getComputedStyle(l);
    const inner = l.firstElementChild as HTMLElement | null;
    const need = el.offsetHeight - l.offsetHeight + (inner?.offsetHeight ?? 0) + parseFloat(ls.paddingTop) + parseFloat(ls.paddingBottom);
    const h = kb ? full : Math.min(full, Math.max(Math.round(window.innerHeight * 0.6), Math.ceil(need)));
    el.style.setProperty("--sheet-h", `${full}px`);
    el.style.setProperty("--sheet-off", `${full - h}px`);
  };
  useLayoutEffect(place, [place, phone]);
  useLayoutEffect(() => {
    if (phone) sizeSheet();
  });
  useEffect(() => {
    const on = () => place();
    window.addEventListener("resize", on);
    window.visualViewport?.addEventListener("resize", on);
    return () => {
      window.removeEventListener("resize", on);
      window.visualViewport?.removeEventListener("resize", on);
    };
  }, [place]);
}

/* phone: the sheet follows a finger down from its handle; far or fast enough, it closes */
export const grabDown = (e: React.PointerEvent<HTMLButtonElement>, pk: React.RefObject<HTMLDivElement | null>, close: () => void) => {
  const el = pk.current;
  if (!el || e.button > 0) return;
  const y0 = e.clientY;
  let dy = 0;
  let last = { y: y0, t: e.timeStamp };
  let v = 0;
  const move = (m: PointerEvent) => {
    dy = Math.max(0, m.clientY - y0);
    v = (m.clientY - last.y) / Math.max(1, m.timeStamp - last.t);
    last = { y: m.clientY, t: m.timeStamp };
    el.style.transition = "none";
    el.style.transform = `translateY(calc(var(--sheet-off, 0px) + ${dy}px))`;
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    el.style.transition = "";
    if (dy > 90 || v > 0.5) {
      el.style.transform = "";
      close();
    } else el.style.transform = "";
    // a drag is not a tap on the handle
    if (dy > 6) window.addEventListener("click", (c) => (c.preventDefault(), c.stopPropagation()), { capture: true, once: true });
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
};
