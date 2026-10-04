"use client";

import { useEffect, useState } from "react";
import { tokenMs } from "./motion";

/* The phone shell's moving parts (phone.css draws them). */

const PHONE = "(max-width: 760px)";

export function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(PHONE);
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return phone;
}

/** The drawer is opening over a reply box that has the keyboard: the keyboard is leaving anyway
    (the panel goes inert), so both cards open at full height at once and it slides away under
    them, instead of opening short and snapping tall when it has gone. */
export function dropKeyboard() {
  const html = document.documentElement;
  const a = document.activeElement;
  if (!html.hasAttribute("data-kb") || !(a instanceof HTMLElement) || !a.closest(".room > .panel")) return;
  a.blur();
  html.style.setProperty("--kb", "0px");
  html.style.setProperty("--kb-p", "0px");
  html.removeAttribute("data-kb");
  html.removeAttribute("data-kb-p");
}

/** The keyboard's height, from the visual viewport, as --kb on the page. */
export function useKeyboardInset(phone: boolean) {
  useEffect(() => {
    const vv = window.visualViewport;
    const html = document.documentElement;
    if (!phone || !vv) return;
    let was = 0;
    let wasP = 0;
    let fallback = 0;
    // each element's own running ride, so a second keyboard change starts from where it really is
    const rides = new WeakMap<HTMLElement, Animation>();
    /* The panel's own keyboard (its value and its flag, held while a sheet is up). Every change goes
       through here and rides: the composer, the greeting and the Continue line move from where they
       were (a FLIP), so nothing jumps in one frame */
    const setPanel = (kb: number) => {
      const d = kb - wasP;
      wasP = kb;
      const flip = Math.abs(d) >= 40 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const els = flip ? Array.from(document.querySelectorAll<HTMLElement>(".room > .panel :is(.dock, .stage-in, .stage-tail, .rd-latest)")) : [];
      const before = els.map((el) => el.getBoundingClientRect().top);
      // drop any ride still running, so its mid-flight offset is never taken for the rest pose
      els.forEach((el) => rides.get(el)?.cancel());
      html.style.setProperty("--kb-p", `${kb}px`);
      html.toggleAttribute("data-kb-p", kb > 80);
      const easing = getComputedStyle(html).getPropertyValue("--e-out").trim() || "ease-out";
      els.forEach((el, i) => {
        const dy = before[i] - el.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) return;
        // on top of what it already wears (the greeting shrinks while the pay card is turned)
        const cur = getComputedStyle(el).transform;
        const rest = cur === "none" ? "" : ` ${cur}`;
        rides.set(el, el.animate([{ transform: `translateY(${dy}px)${rest}` }, { transform: rest.trim() || "none" }], { duration: tokenMs(d > 0 ? "--d-move" : "--d-mid"), easing }));
      });
    };
    const room = document.querySelector(".room");
    const inPanel = () => !!document.activeElement?.closest?.(".room > .panel");
    const set = () => {
      // pinch zoom also shrinks the visual viewport: only a keyboard changes it at scale 1
      if (vv.scale > 1.01) return;
      // iOS pans the visual viewport to show a focused field at the bottom; the page is laid out to
      // the keyboard instead, so the pan goes back to the top (the header stays on screen)
      if (vv.offsetTop > 0) window.scrollTo(0, 0);
      // only a field being typed in has a keyboard: one on its way out (the field blurred) no longer
      // shapes the page, so a drawer that took the focus never shrinks back mid-open
      const a = document.activeElement;
      const typing = !!a?.matches?.("input, textarea, [contenteditable='true']");
      const kb = typing ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      was = kb;
      html.style.setProperty("--kb", `${kb}px`);
      html.toggleAttribute("data-kb", kb > 80);
      // the panel's copy holds still while a sheet is up (its field's keyboard is the sheet's)
      if (!room?.hasAttribute("data-back")) setPanel(kb);
    };
    set();
    vv.addEventListener("resize", set);
    vv.addEventListener("scroll", set);
    /* A sheet gone with its keyboard still up: the panel keeps what it had until the next event says
       which way it goes (the reply box taking the focus back keeps it; the keyboard leaving drops it,
       both through the ride). A short fallback settles it if neither comes */
    const mo = new MutationObserver(() => {
      if (room?.hasAttribute("data-back")) return;
      window.clearTimeout(fallback);
      if (inPanel() || was <= 80) return setPanel(inPanel() ? was : 0);
      fallback = window.setTimeout(() => setPanel(inPanel() ? was : 0), tokenMs("--d-slow"));
    });
    if (room) mo.observe(room, { attributes: true, attributeFilter: ["data-back"] });
    // a panel field taking the focus with the keyboard already up takes it over, through the ride
    const focus = () => {
      if (!inPanel() || room?.hasAttribute("data-back")) return;
      window.clearTimeout(fallback);
      set();
    };
    document.addEventListener("focusin", focus);
    return () => {
      window.clearTimeout(fallback);
      mo.disconnect();
      document.removeEventListener("focusin", focus);
      vv.removeEventListener("resize", set);
      vv.removeEventListener("scroll", set);
      html.style.removeProperty("--kb");
      html.style.removeProperty("--kb-p");
      html.removeAttribute("data-kb-p");
      html.removeAttribute("data-kb");
    };
  }, [phone]);
}

/* The drawer follows the finger from anywhere on the panel (to open) or on
   the panel's edge beside the open drawer (to close). The finger writes one
   number, --p (0 closed, 1 open), on the room; phone.css draws every piece
   from it. On release it settles by where the finger was heading. The click
   that ends a drag is swallowed, and only that one. */
export function useDrawerDrag(room: React.RefObject<HTMLElement | null>, open: boolean, setOpen: (v: boolean) => void, phone: boolean) {
  useEffect(() => {
    const r = room.current;
    if (!r || !phone) return;
    type S = { x: number; y: number; id: number; lock: boolean | null; p0: number; w: number; p: number; pts: { x: number; t: number }[] };
    let s: S | null = null;
    const skip = (t: Element) =>
      !!t.closest("pre, table, .katex-display, input, textarea, select, .island, .rd-card, .sb, [data-nodrag]") || !!window.getSelection()?.toString();
    // open, the drawer can be pushed away from its own quiet parts too (not a row, which swipes to
    // delete, and not a control)
    const railQuiet = (t: Element) => !!t.closest(".room > .rail") && !t.closest(".sb-row, button, a, input, textarea, .sb-rooms");
    const down = (e: PointerEvent) => {
      if (e.button > 0 || s) return;
      const t = e.target as Element;
      const onVeil = !!t.closest(".drawer-veil");
      if (open ? !onVeil && !railQuiet(t) : !t.closest(".room > .panel") || skip(t)) return;
      const rail = r.querySelector<HTMLElement>(":scope > .rail");
      // how far the panel travels: --aside, the rail's width and two gutters
      const w = (rail?.offsetWidth ?? 300) + 16;
      // grabbed mid-slide: start from where the panel really is
      const panel = r.querySelector<HTMLElement>(":scope > .panel");
      let p0 = open ? 1 : 0;
      if (panel) {
        const m = new DOMMatrix(getComputedStyle(panel).transform);
        if (m.a < 0.999 || Math.abs(m.m41) > 0.5) p0 = Math.min(1, Math.max(0, m.m41 / w));
      }
      s = { x: e.clientX, y: e.clientY, id: e.pointerId, lock: null, p0, w, p: p0, pts: [{ x: e.clientX, t: e.timeStamp }] };
    };
    const move = (e: PointerEvent) => {
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (s.lock === null) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > 1.4 * Math.abs(dy)) {
          s.lock = true;
          if (!open) dropKeyboard();
          r.setAttribute("data-drag", "");
          try {
            (e.target as Element).setPointerCapture?.(e.pointerId);
          } catch {
            // the drag still follows through the room's own listener
          }
        } else if (Math.abs(dy) > 10) {
          s = null;
          return;
        } else return;
      }
      e.preventDefault();
      s.p = Math.min(1, Math.max(0, s.p0 + dx / s.w));
      r.style.setProperty("--p", s.p.toFixed(4));
      s.pts.push({ x: e.clientX, t: e.timeStamp });
      if (s.pts.length > 6) s.pts.shift();
    };
    const up = (e: PointerEvent) => {
      if (!s || e.pointerId !== s.id) return;
      const was = s;
      s = null;
      if (!was.lock) return;
      const a = was.pts[0];
      const b = was.pts[was.pts.length - 1];
      // a finger that stopped before lifting has no speed left
      const v = e.timeStamp - b.t > 80 ? 0 : b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
      const next = was.p + (v * 180) / was.w > 0.5;
      r.removeAttribute("data-drag");
      r.style.removeProperty("--p");
      setOpen(next);
      // the click this release makes belongs to the drag
      const swallow = (c: MouseEvent) => {
        c.preventDefault();
        c.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 60);
    };
    r.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      r.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      r.removeAttribute("data-drag");
      r.style.removeProperty("--p");
    };
  }, [room, open, setOpen, phone]);
}
