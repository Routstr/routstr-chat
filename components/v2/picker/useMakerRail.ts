import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MODEL_COMPANIES } from "@/components/v2/picker/modelCompanies";
import type { IconName } from "../icons";
import type { Lay } from "./Details";
import type { Catalog } from "./useCatalog";
import { makerOf, type Row, type Scope } from "./catalog";

export function useMakerRail({
  lay,
  cat,
  liveFavs,
  favScope,
  makerLabel,
  scope,
  searching,
  setScope,
  setActiveKey,
  railScroll: railScrollRef,
  railGlide: railGlideRef,
}: {
  lay: Lay;
  cat: Catalog;
  liveFavs: Row[];
  /** What the Favorites tab lists: your favorites as the picker opened, and any starred since. */
  favScope: Row[];
  makerLabel: (id: string) => string;
  scope: Scope;
  /** A search looks through every model: no tab is the one shown. */
  searching: boolean;
  setScope: (s: Scope) => void;
  setActiveKey: (k: string | null) => void;
  railScroll: React.RefObject<HTMLDivElement | null>;
  railGlide: React.RefObject<HTMLDivElement | null>;
}) {
  /* ── rail ───────────────────────────────────────────────────────────── */
  const strip = lay === "one" || lay === "two";
  const railItems = useMemo(() => {
    const counts = new Map<string, number>();
    cat.models.forEach((m) => counts.set(makerOf(m), (counts.get(makerOf(m)) ?? 0) + 1));
    const makers = [...MODEL_COMPANIES.map((c) => c.id), "other"].filter((id) => counts.get(id));
    const picks = cat.models.filter((m) => cat.picks.has(m.id)).length;
    const deals = cat.deals;
    return {
      scopes: [
        ...(favScope.length ? [{ id: "favorites", label: "Favorites", short: "Favorites", icon: "star" as IconName, n: liveFavs.length }] : []),
        ...(picks ? [{ id: "picks", label: "Routstr picks", short: "Picks", icon: "spark" as IconName, n: picks }] : []),
        ...(deals ? [{ id: "deals", label: "Deals", short: "Deals", icon: "tag" as IconName, n: deals }] : []),
        { id: "all", label: "All models", short: "All", icon: "grid" as IconName, n: cat.models.length },
      ],
      makers: makers.map((id) => ({ id, label: makerLabel(id), n: counts.get(id) ?? 0 })),
    };
  }, [cat.models, cat.picks, cat.deals, favScope.length, liveFavs.length, makerLabel]);
  const railOrder = useMemo(() => [...railItems.scopes.map((s) => s.id), ...railItems.makers.map((m) => m.id)], [railItems]);

  const placeRailGlide = useCallback((instant: boolean) => {
    const g = railGlideRef.current;
    const b = railScrollRef.current?.querySelector<HTMLElement>(".rail-b[aria-pressed='true']");
    if (!g) return null;
    g.style.opacity = b ? "" : "0";
    if (!b) return null;
    if (instant) g.style.transition = "none";
    g.style.width = `${b.offsetWidth}px`;
    g.style.height = `${b.offsetHeight}px`;
    g.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
    if (instant) {
      void g.offsetWidth;
      g.style.transition = "";
    }
    return b;
  }, []);
  // a tab in view, the rail alone scrolled: on a strip, a maker comes with its left neighbour whole
  // beside it
  const reveal = useCallback(
    (el: HTMLElement, smooth: boolean) => {
      const s = railScrollRef.current;
      if (!s) return;
      const behavior = smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto";
      if (!strip) {
        if (el.offsetTop < s.scrollTop) s.scrollTo({ top: el.offsetTop, behavior });
        else if (el.offsetTop + el.offsetHeight > s.scrollTop + s.clientHeight) s.scrollTo({ top: el.offsetTop + el.offsetHeight - s.clientHeight, behavior });
        return;
      }
      const prev = el.previousElementSibling as HTMLElement | null;
      const want = el.hasAttribute("data-scope") || !prev ? 0 : Math.max(0, prev.offsetLeft - 10);
      if (el.offsetLeft < s.scrollLeft || el.offsetLeft + el.offsetWidth > s.scrollLeft + s.clientWidth) s.scrollTo({ left: want, behavior });
    },
    [strip]
  );
  // the tab kept from the last open is in view as the picker opens
  const railFirst = useRef(true);
  useLayoutEffect(() => {
    const b = placeRailGlide(railFirst.current);
    if (!b) return;
    if (railFirst.current) reveal(b, false);
    railFirst.current = false;
  }, [scope, searching, lay, railItems, placeRailGlide]);

  const [edges, setEdges] = useState({ left: false, right: false });
  const stripEdges = useCallback(() => {
    const s = railScrollRef.current;
    if (!s || !strip) return;
    const left = s.scrollLeft > 4;
    const right = s.scrollWidth - s.scrollLeft - s.clientWidth > 4;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, [strip]);
  useLayoutEffect(() => {
    stripEdges();
  }, [stripEdges, lay, railItems]);

  const pickScope = (id: Scope, el?: HTMLElement | null) => {
    setScope(id);
    setActiveKey(null);
    if (el) reveal(el, true);
  };
  const railKey = (e: React.KeyboardEvent) => {
    const keys = strip ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (!keys.includes(e.key) && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    e.stopPropagation();
    const i = railOrder.indexOf(scope);
    const j = e.key === "Home" ? 0 : e.key === "End" ? railOrder.length - 1 : Math.max(0, Math.min(railOrder.length - 1, i + (e.key === keys[1] ? 1 : -1)));
    const b = railScrollRef.current?.querySelector<HTMLElement>(`[data-co="${railOrder[j]}"]`);
    b?.focus();
    pickScope(railOrder[j], b);
  };
  return { strip, railItems, railOrder, edges, stripEdges, pickScope, railKey };
}
