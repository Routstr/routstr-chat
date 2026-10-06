import React, { useEffect, useLayoutEffect, useState } from "react";
import type { SortKey } from "./catalog";

export function useSortMenu({
  menu,
  setMenu,
  listEl: listElRef,
  sortBtn,
  menuEl,
  card,
  sort,
  setSort,
  setDir,
}: {
  menu: boolean;
  setMenu: (m: boolean) => void;
  listEl: React.RefObject<HTMLDivElement | null>;
  sortBtn: React.RefObject<HTMLButtonElement | null>;
  menuEl: React.RefObject<HTMLDivElement | null>;
  card: React.RefObject<HTMLDivElement | null>;
  sort: SortKey;
  setSort: (k: SortKey) => void;
  setDir: React.Dispatch<React.SetStateAction<1 | -1>>;
}) {
  /* ── menu ───────────────────────────────────────────────────────────── */
  const [menuH, setMenuH] = useState(420);
  const [menuMore, setMenuMore] = useState(false);
  useLayoutEffect(() => {
    if (!menu) return;
    // the menu never runs past the list's bottom edge; if it still has to
    // scroll, its last row fades into the menu's own surface
    const bottom = Math.min(listElRef.current?.getBoundingClientRect().bottom ?? Infinity, window.visualViewport?.height ?? window.innerHeight);
    const top = sortBtn.current?.getBoundingClientRect().bottom ?? 0;
    const cap = Math.max(180, Math.min(470, bottom - top - 14));
    const el = menuEl.current;
    let h = cap;
    if (el && el.scrollHeight > cap) {
      const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      const ends = Array.from(el.querySelectorAll<HTMLElement>(".mi"), (c) => c.offsetTop + c.offsetHeight).filter((b) => b + pad <= cap);
      if (ends.length) h = Math.max(...ends) + pad;
    }
    setMenuH(h);
    requestAnimationFrame(() => {
      const m = menuEl.current;
      if (!m) return;
      setMenuMore(m.scrollHeight - m.scrollTop - m.clientHeight > 6);
      m.querySelector<HTMLElement>(".mi[aria-checked='true']")?.focus({ preventScroll: true });
    });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.(".mp-sortwrap")) return;
      setMenu(false);
      // the press closes the menu; the click it becomes must not also act
      if (card.current?.contains(t)) {
        const eat = (c: MouseEvent) => {
          c.stopPropagation();
          c.preventDefault();
        };
        window.addEventListener("click", eat, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", eat, true), 600);
      }
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [menu]);
  const menuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuEl.current?.querySelectorAll<HTMLElement>(".mi") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setMenu(false);
      sortBtn.current?.focus();
    }
  };
  const pickSort = (k: SortKey) => {
    // a second press on the checked sort flips it
    setDir(sort === k ? (d) => (d > 0 ? -1 : 1) : 1);
    setSort(k);
    setMenu(false);
    sortBtn.current?.focus();
  };
  return { menuH, menuMore, setMenuMore, menuKey, pickSort };
}
