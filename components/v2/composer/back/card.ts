"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { tokenMs } from "../../motion";
import { phoneNow, reduced, touch } from "./bits";

type Ref<T> = React.RefObject<T | null>;

/* ── height: the card follows its content, gliding; it never pushes the words ── */
export function useCardHeight(morphRef: Ref<HTMLDivElement>, stageRef: Ref<HTMLDivElement>, footRef: Ref<HTMLDivElement>, islandRef: Ref<HTMLDivElement>, footHidden: boolean, view: string) {
  const measure = useCallback(
    (instant: boolean) => {
      const m = morphRef.current;
      const st = stageRef.current;
      const isl = islandRef.current;
      if (!m || !st || !isl) return;
      const viewEl = st.querySelector<HTMLElement>(".pa-cur > .pa-view");
      let h: number;
      if (phoneNow()) h = m.querySelector<HTMLElement>(".pa-inwrap")?.offsetHeight ?? 0;
      else {
        const natural = (viewEl?.offsetHeight ?? 0) + (footRef.current && !footHidden ? footRef.current.offsetHeight : 0);
        // the card may grow down only to the panel's floor (a new chat) or keep the
        // thread's last 160px (docked); past that the view scrolls inside
        const ir = isl.getBoundingClientRect();
        const mr = m.getBoundingClientRect();
        const panel = isl.closest(".panel");
        const pr = panel?.getBoundingClientRect();
        const centred = isl.dataset.place === "centre";
        const tw = panel?.querySelector(".thread-wrap")?.getBoundingClientRect();
        const room = centred && pr ? pr.bottom - 28 - mr.top : tw ? ir.bottom - (tw.top + 160) - (mr.top - ir.top) - 20 : natural;
        h = Math.min(natural, Math.max(160, Math.floor(room)));
      }
      if (instant) {
        m.style.transition = "none";
        m.style.setProperty("--pa-h", `${h}px`);
        void m.offsetHeight;
        m.style.transition = "";
      } else m.style.setProperty("--pa-h", `${h}px`);
    },
    [islandRef, footHidden]
  );
  const firstMeasure = useRef(true);
  useLayoutEffect(() => {
    measure(firstMeasure.current);
    firstMeasure.current = false;
  });
  useEffect(() => {
    const ro = new ResizeObserver(() => measure(false));
    if (stageRef.current) ro.observe(stageRef.current);
    if (footRef.current) ro.observe(footRef.current);
    stageRef.current?.querySelectorAll(".pa-view").forEach((v) => ro.observe(v));
    return () => ro.disconnect();
  }, [measure, view]);
}

/* the view that arrives takes no clicks until it has landed, so a double
   click on the way in never lands on a row that slid under the pointer; the
   view that leaves fades up and out while the new one arrives */
export function useViewSwap(view: string, body: React.ReactNode) {
  const [arriving, setArriving] = useState(false);
  const arrivingT = useRef(0);
  const lastKey = useRef(view);
  useLayoutEffect(() => {
    if (lastKey.current === view) return;
    lastKey.current = view;
    setArriving(true);
    window.clearTimeout(arrivingT.current);
    arrivingT.current = window.setTimeout(() => setArriving(false), 360);
  }, [view]);
  useEffect(() => () => window.clearTimeout(arrivingT.current), []);
  const [leaving, setLeaving] = useState<{ key: string; node: React.ReactNode } | null>(null);
  const lastView = useRef<{ key: string; node: React.ReactNode }>({ key: view, node: body });
  const leaveT = useRef(0);
  useLayoutEffect(() => {
    if (lastView.current.key !== view && !reduced()) {
      setLeaving(lastView.current);
      window.clearTimeout(leaveT.current);
      leaveT.current = window.setTimeout(() => setLeaving(null), 130);
    }
    lastView.current = { key: view, node: body };
  });
  useEffect(() => () => window.clearTimeout(leaveT.current), []);
  return { arriving, leaving };
}

/* focus the first useful thing once the card has turned, and again when a
   view swap took the focused control away (never on touch) */
export function useCardFocus(morphRef: Ref<HTMLDivElement>, spot: string) {
  const firstFocus = useRef(true);
  useEffect(() => {
    if (touch()) return;
    const turned = firstFocus.current;
    firstFocus.current = false;
    const t = window.setTimeout(() => {
      const a = document.activeElement;
      if (!turned && a && a !== document.body && a.isConnected && !a.closest(".pa-out")) return;
      const root = morphRef.current;
      const el =
        root?.querySelector<HTMLElement>('.pa-cur .pa-amt[data-picked], .pa-cur .pa-amt[tabindex="0"]:not([aria-disabled])') ??
        root?.querySelector<HTMLElement>(".pa-cur .pa-row, .pa-corner .prime:not(:disabled), .pa-corner .soft, .pa-cur textarea, .pa-cur input, .pa-acts .soft, .pa-lead .soft");
      el?.focus({ preventScroll: true });
    }, turned ? 440 : tokenMs("--d-mid"));
    return () => window.clearTimeout(t);
  }, [spot]);
}

/* paid: seal and words close into one group, centred in the card */
export function usePaidCentre(stageRef: Ref<HTMLDivElement>, view: string, ln: string) {
  useLayoutEffect(() => {
    const inv = stageRef.current?.querySelector<HTMLElement>(".pa-cur .pa-inv[data-paid]");
    if (!inv) return;
    const place = () => {
      if (phoneNow()) return inv.style.removeProperty("--pa-gx");
      const tile = inv.querySelector<HTMLElement>(".pa-qr, .pa-slot");
      const side = inv.querySelector<HTMLElement>(".pa-side");
      if (!tile || !side) return;
      const seal = parseFloat(getComputedStyle(inv).getPropertyValue("--pa-seal")) || 56;
      const gap = parseFloat(getComputedStyle(inv).columnGap) || 0;
      const r = document.createRange();
      const sideW = Math.max(
        ...Array.from(side.querySelectorAll(".pa-amount, .pa-line, .pa-meta"), (n) => {
          r.selectNodeContents(n);
          return r.getBoundingClientRect().width;
        })
      );
      const left = (tile.offsetWidth - seal) / 2;
      inv.style.setProperty("--pa-gx", `${Math.round((inv.clientWidth - (seal + gap + sideW)) / 2 - left)}px`);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [view, ln]);
}
