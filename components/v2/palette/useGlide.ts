import React, { useCallback, useEffect, useLayoutEffect } from "react";
import type { Group } from "./types";

export function useGlide({
  list,
  glide,
  at,
  groups,
  instant,
  instantTwice,
  scrollNext,
}: {
  list: React.RefObject<HTMLDivElement | null>;
  glide: React.RefObject<HTMLDivElement | null>;
  at: number;
  groups: Group[];
  instant: React.RefObject<boolean>;
  instantTwice: React.RefObject<boolean>;
  scrollNext: React.RefObject<boolean>;
}) {
  /* ── the glide: one selection that moves between rows ────────────────── */
  const placeGlide = useCallback(() => {
    const g = glide.current;
    const row = list.current?.querySelector<HTMLElement>(`.pk-row[data-i="${at}"]`);
    if (!g) return;
    if (!row) {
      g.style.opacity = "0";
      return;
    }
    const now = instant.current;
    instant.current = instantTwice.current;
    instantTwice.current = false;
    g.toggleAttribute("data-instant", now);
    g.style.opacity = "1";
    g.style.transform = `translateY(${row.offsetTop}px)`;
    g.style.height = `${row.offsetHeight}px`;
    if (now) {
      void g.offsetWidth;
      g.removeAttribute("data-instant");
    }
  }, [at]);
  useLayoutEffect(() => {
    placeGlide();
    // a chat title that runs out of room fades at its end; one that fits stays whole
    list.current?.querySelectorAll<HTMLElement>('.pk-row[data-kind="chat"] .pk-l').forEach((l) => l.toggleAttribute("data-cut", l.scrollWidth > l.clientWidth + 1));
    if (scrollNext.current) {
      scrollNext.current = false;
      scrollToActive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeGlide, groups]);
  // late fonts re-wrap notes and snippets: put the glide back on its row
  useEffect(() => {
    if (document.fonts?.status === "loaded") return;
    let live = true;
    document.fonts?.ready.then(() => {
      if (!live) return;
      instant.current = true;
      placeGlide();
    });
    return () => {
      live = false;
    };
  }, [placeGlide]);

  /* keep the selection in view with air, and never leave a group title cut
     by the top edge: it is shown whole or scrolled fully out of sight */
  const scrollToActive = () => {
    const l = list.current;
    const row = l?.querySelector<HTMLElement>(`.pk-row[data-i="${at}"]`);
    if (!l || !row) return;
    const lr = l.getBoundingClientRect();
    const base = l.scrollTop - lr.top;
    const rr = row.getBoundingClientRect();
    const top = rr.top + base;
    const bot = rr.bottom + base;
    const pad = 8;
    const fade = 28;
    const grp = row.closest(".pk-grp");
    const gt = grp?.querySelector<HTMLElement>(".pk-gt");
    const opens = grp?.querySelector(".pk-row") === row;
    let st = l.scrollTop;
    if (opens && gt) {
      const gtTop = gt.getBoundingClientRect().top + base;
      if (gtTop - pad < st) st = gtTop - pad;
    }
    // back in the first group, the list rests at its very top (its heading clear of the fade)
    if (top - pad < st) st = grp === l.querySelector(".pk-grp") ? 0 : top - pad;
    else if (bot + fade > st + l.clientHeight) st = bot + fade - l.clientHeight;
    st = Math.max(0, st);
    l.querySelectorAll<HTMLElement>(".pk-gt").forEach((t) => {
      const r = t.getBoundingClientRect();
      const a = r.top + base;
      const b = r.bottom + base;
      if (st > 0 && a < st + 16 && b > st) st = (t === gt && opens) || b + 4 > top - pad ? a - pad : b + 4;
    });
    l.scrollTop = Math.max(0, Math.round(st));
  };
}

// a chat that syncs in lands at the top of Recent: bring it into view, so the arrival is seen
export function useShowArrival(list: React.RefObject<HTMLDivElement | null>, came: string[], page: "root" | "rooms", q: string) {
  useEffect(() => {
    const l = list.current;
    if (!came.length || page !== "root" || q.trim() || !l || l.scrollTop === 0) return;
    // as far up as it can go while the selected row stays in view (the preview's list shows the
    // arrival when both cannot fit)
    const row = l.querySelector<HTMLElement>('.pk-row[aria-selected="true"]');
    const top = row ? Math.max(0, row.offsetTop + row.offsetHeight + 28 - l.clientHeight) : 0;
    if (top < l.scrollTop) l.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [came.length]);
}

/* ghosts: one diagonal light, each piece delayed by where it sits */
export function useGhostDelays(pageEl: React.RefObject<HTMLDivElement | null>, groups: Group[]) {
  useLayoutEffect(() => {
    const root = pageEl.current;
    if (!root) return;
    const gs = root.querySelectorAll<HTMLElement>(".pf-gw");
    if (!gs.length) return;
    const box = root.getBoundingClientRect();
    gs.forEach((el) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--wd", `${Math.round((r.left - box.left) * 1.1 + (r.top - box.top) * 1.6)}ms`);
    });
  }, [groups]);
}
