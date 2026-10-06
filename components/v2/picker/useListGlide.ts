import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { tokenMs } from "../motion";
import type { Lay } from "./Details";
import type { Catalog } from "./useCatalog";
import { nounFor, type Filters } from "./helpers";
import type { Row, Scope, SortKey } from "./catalog";

const FADE = 48; // the list's bottom fade (picker.css, .mp-list)

export function useListGlide({
  flat,
  idxOf,
  filtering,
  isCurrent,
  activeKey,
  setActiveKey,
  q,
  scope,
  f,
  only,
  sort,
  dir,
  cat,
  makerLabel,
  say,
  listEl: listElRef,
  glide: glideRef,
  lay,
}: {
  flat: Row[];
  idxOf: Map<string, number>;
  filtering: boolean;
  isCurrent: (r: Row) => boolean;
  activeKey: string | null;
  setActiveKey: (k: string | null) => void;
  q: string;
  scope: Scope;
  f: Filters;
  only: string | null;
  sort: SortKey;
  dir: 1 | -1;
  cat: Catalog;
  makerLabel: (id: string) => string;
  say: (t: string) => void;
  listEl: React.RefObject<HTMLDivElement | null>;
  glide: React.RefObject<HTMLDivElement | null>;
  lay: Lay;
}) {
  // what the list is showing, kept alive when the list changes under it
  const activeIdx = activeKey !== null && idxOf.has(activeKey) ? idxOf.get(activeKey)! : -1;
  useEffect(() => {
    if (!flat.length) return setActiveKey(null);
    if (activeKey !== null && idxOf.has(activeKey)) return;
    const cur = flat.findIndex(isCurrent);
    setActiveKey(flat[filtering || cur < 0 ? 0 : cur].key);
  }, [flat]);

  const [detailKey, setDetailKey] = useState<string | null>(null);
  // details follow on the next frame, so a held arrow key coalesces
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDetailKey(activeKey));
    return () => cancelAnimationFrame(raf);
  }, [activeKey]);

  // the filter changed: back to the top, and say how many
  const filterSig = JSON.stringify([q, scope, f, only, sort, dir]);
  const lastSig = useRef(filterSig);
  const lastQ = useRef(q);
  const sayT = useRef(0);
  useEffect(() => {
    if (lastSig.current === filterSig) return;
    lastSig.current = filterSig;
    if (listElRef.current) listElRef.current.scrollTop = 0;
    setActiveKey(flat[0]?.key ?? null);
    const host = only ? cat.hosts.find((h) => h.base === only)?.host ?? only : "";
    const words = `${flat.length} ${nounFor(flat.length, !!q.trim(), scope, makerLabel)}${host ? ` on ${host}` : ""}`;
    window.clearTimeout(sayT.current);
    if (lastQ.current === q) return say(words);
    lastQ.current = q;
    sayT.current = window.setTimeout(() => say(words), tokenMs("--d-slow"));
  }, [filterSig]);
  useEffect(() => () => window.clearTimeout(sayT.current), []);

  /* ── the tile under the active row ──────────────────────────────────── */
  const settleTries = useRef(0);
  const placeGlideRef = useRef<(scrollTo: boolean, instant?: boolean) => void>(() => {});
  const placeGlide = useCallback(
    (scrollTo: boolean, instant = false) => {
      const g = glideRef.current;
      const list = listElRef.current;
      const el = list?.querySelector<HTMLElement>(`[data-i="${activeIdx}"]`);
      if (!g || !list) return;
      if (!el) {
        g.style.opacity = "0";
        return;
      }
      const inner = el.offsetParent as HTMLElement | null;
      const y = el.offsetTop + (inner && inner !== list ? inner.offsetTop : 0);
      if (instant) g.style.transition = "none";
      g.style.opacity = "1";
      g.style.transform = `translateY(${y}px)`;
      g.style.height = `${el.offsetHeight}px`;
      if (instant) {
        void g.offsetWidth;
        g.style.transition = "";
      }
      if (scrollTo) {
        // a sheet still rising has not reached its height yet: measure once it rests
        const sheet = list.closest<HTMLElement>(".sheet");
        const moving = sheet?.getAnimations().filter((a) => a.playState === "running");
        if (moving?.length) {
          Promise.all(moving.map((a) => a.finished.catch(() => undefined))).then(() => placeGlideRef.current(true, true));
          return;
        }
        // a sheet moved by script (no animation to wait on) that has not risen yet: look again next frame
        const vh = window.visualViewport?.height ?? window.innerHeight;
        if (sheet && list.getBoundingClientRect().top >= vh - 1 && (settleTries.current += 1) < 60) {
          requestAnimationFrame(() => placeGlideRef.current(true, true));
          return;
        }
        settleTries.current = 0;
        // what you can see of the list: its box, or less where a sheet runs past the screen
        const lr = list.getBoundingClientRect();
        const seen = Math.min(list.clientHeight, (window.visualViewport?.height ?? window.innerHeight) - lr.top);
        const bot = y + el.offsetHeight;
        if (y < list.scrollTop + 10) list.scrollTop = y - 28;
        else if (bot > list.scrollTop + seen - FADE) list.scrollTop = bot - seen + FADE;
      }
    },
    [activeIdx]
  );
  useLayoutEffect(() => {
    placeGlideRef.current = placeGlide;
  }, [placeGlide]);
  const scrollNext = useRef(true);
  const glideInstant = useRef(true);
  const glideSig = useRef(filterSig);
  useLayoutEffect(() => {
    if (glideSig.current === filterSig) return;
    glideSig.current = filterSig;
    glideInstant.current = true;
  }, [filterSig]);
  useLayoutEffect(() => {
    placeGlide(scrollNext.current, glideInstant.current);
    scrollNext.current = true;
    glideInstant.current = false;
  }, [placeGlide, flat, lay]);

  const setActive = useCallback(
    (i: number, o: { scroll?: boolean } = {}) => {
      if (!flat.length) return;
      const j = Math.max(0, Math.min(flat.length - 1, i));
      scrollNext.current = o.scroll !== false;
      setActiveKey(flat[j].key);
    },
    [flat]
  );
  return { activeIdx, detailKey, setActive };
}
