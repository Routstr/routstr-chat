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
  rows,
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
  /** How many rows are drawn so far: a long list lands in steps. */
  rows: number;
}) {
  // what the list is showing, kept alive when the list changes under it
  const activeIdx = activeKey !== null && idxOf.has(activeKey) ? idxOf.get(activeKey)! : -1;
  // the list scrolls to the active row only when that row is moved to (by the keys: into sight), or
  // landed on (the model in use as the list opens: to the top); a list that changes under you
  // stays where you put it
  const scrollNext = useRef<false | "near" | "top">(false);
  useEffect(() => {
    if (!flat.length) return setActiveKey(null);
    if (activeKey !== null && idxOf.has(activeKey)) return;
    const cur = flat.findIndex(isCurrent);
    scrollNext.current = activeKey === null && "top";
    setActiveKey(flat[filtering || cur < 0 ? 0 : cur].key);
  }, [flat]);

  const [detailKey, setDetailKey] = useState<string | null>(null);
  // details follow on the next frame, so a held arrow key coalesces
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDetailKey(activeKey));
    return () => cancelAnimationFrame(raf);
  }, [activeKey]);

  // the filter changed: back to the top, and say how many (the tab the picker settles on as it
  // opens is no change)
  const filterSig = JSON.stringify([q, scope, f, only, sort, dir]);
  const lastSig = useRef<string | null>(null);
  const lastQ = useRef(q);
  const sayT = useRef(0);
  useEffect(() => {
    const was = lastSig.current;
    lastSig.current = filterSig;
    if (was === null || was === filterSig) return;
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
  const placeGlide = useCallback(
    (scrollTo: false | "near" | "top", instant = false) => {
      const g = glideRef.current;
      const list = listElRef.current;
      const el = list?.querySelector<HTMLElement>(`[data-i="${activeIdx}"]`);
      if (!g || !list) return false;
      if (!el) {
        g.style.opacity = "0";
        return false;
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
        // what you can see of the list: its box, less what its sheet keeps below the screen once it
        // rests (its scroll padding), so a sheet still rising already lands on the row
        const seen = list.clientHeight - (parseFloat(getComputedStyle(list).scrollPaddingBottom) || 0);
        const bot = y + el.offsetHeight;
        if (y < list.scrollTop + 10 || (scrollTo === "top" && bot > list.scrollTop + seen - FADE)) list.scrollTop = y - 28;
        else if (bot > list.scrollTop + seen - FADE) list.scrollTop = bot - seen + FADE;
      }
      return true;
    },
    [activeIdx]
  );
  const glideInstant = useRef(true);
  const glideSig = useRef(filterSig);
  useLayoutEffect(() => {
    if (glideSig.current === filterSig) return;
    glideSig.current = filterSig;
    glideInstant.current = true;
  }, [filterSig]);
  // a row not drawn yet is landed on once its step of the list is
  useLayoutEffect(() => {
    if (!placeGlide(scrollNext.current, glideInstant.current)) return;
    scrollNext.current = false;
    glideInstant.current = false;
  }, [placeGlide, flat, lay, rows]);

  const setActive = useCallback(
    (i: number, o: { scroll?: boolean } = {}) => {
      if (!flat.length) return;
      const j = Math.max(0, Math.min(flat.length - 1, i));
      if (flat[j].key === activeKey) return;
      scrollNext.current = o.scroll !== false && "near";
      setActiveKey(flat[j].key);
    },
    [flat, activeKey]
  );
  return { activeIdx, detailKey, setActive };
}
