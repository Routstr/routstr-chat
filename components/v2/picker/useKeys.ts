import React, { useRef } from "react";
import { useChipRef } from "../ui";
import type { Lay } from "./Details";
import type { Row, Scope } from "./catalog";

export function useKeys({
  menu,
  setMenu,
  sortBtn,
  signedOut,
  onClose,
  input,
  card,
  view,
  lay,
  push,
  q,
  setQ,
  flat,
  activeIdx,
  toggleStar,
  railOrder,
  scope,
  pickScope,
  railScroll,
  setActive,
  choose,
  hints,
  setHints,
}: {
  menu: boolean;
  setMenu: (m: boolean) => void;
  sortBtn: React.RefObject<HTMLButtonElement | null>;
  signedOut: boolean;
  onClose: () => void;
  input: React.RefObject<HTMLInputElement | null>;
  card: React.RefObject<HTMLDivElement | null>;
  view: "list" | "detail";
  lay: Lay;
  push: (v: "list" | "detail") => void;
  q: string;
  setQ: (q: string) => void;
  flat: Row[];
  activeIdx: number;
  toggleStar: (r: Row) => void;
  railOrder: string[];
  scope: Scope;
  pickScope: (id: Scope, el?: HTMLElement | null) => void;
  railScroll: React.RefObject<HTMLDivElement | null>;
  setActive: (i: number, o?: { scroll?: boolean }) => void;
  choose: (r: Row, host?: string | null) => void;
  hints: boolean;
  setHints: (h: boolean) => void;
}) {
  const chipRef = useChipRef();
  /* ── keys ───────────────────────────────────────────────────────────── */
  const onKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (menu) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMenu(false);
        sortBtn.current?.focus();
        return;
      }
      if (t.closest?.(".mp-menu")) return;
    }
    // an IME is composing: its keys are its own
    if (e.nativeEvent.isComposing) return;
    if (signedOut) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      chipRef.current?.focus();
      return;
    }
    const inList = t === input.current || t === card.current || !!t.closest?.(".mp-list");
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (view === "detail" && lay === "one") return push("list");
      if (q && t === input.current) return setQ("");
      onClose();
      chipRef.current?.focus();
      return;
    }
    if (e.key === "ArrowLeft" && lay === "one" && view === "detail" && !t.closest?.(".rte")) {
      e.preventDefault();
      return push("list");
    }
    if (e.altKey && e.code === "KeyF") {
      e.preventDefault();
      if (flat[activeIdx]) toggleStar(flat[activeIdx]);
      return;
    }
    if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const i = railOrder.indexOf(scope);
      const j = (i + (e.key === "ArrowDown" ? 1 : -1) + railOrder.length) % railOrder.length;
      pickScope(railOrder[j], railScroll.current?.querySelector<HTMLElement>(`[data-co="${railOrder[j]}"]`));
      return;
    }
    if (!inList) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(activeIdx + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      setActive(activeIdx + (e.key === "PageDown" ? 8 : -8));
    } else if (e.key === "Enter" && flat[activeIdx]) {
      e.preventDefault();
      choose(flat[activeIdx]);
    } else if (
      e.key === "ArrowRight" &&
      lay === "one" &&
      flat[activeIdx] &&
      (t !== input.current || input.current.selectionStart === input.current.value.length)
    ) {
      e.preventDefault();
      push("detail");
    }
  };

  /* ── pointer over the list ──────────────────────────────────────────── */
  const hoverT = useRef(0);
  const onListMove = (e: React.PointerEvent) => {
    if (hints) setHints(false);
    if (lay === "one" || e.pointerType === "touch") return;
    const row = (e.target as HTMLElement).closest<HTMLElement>(".row");
    if (!row) return;
    const i = Number(row.dataset.i);
    if (i === activeIdx) return;
    window.clearTimeout(hoverT.current);
    // rest a moment first, so a fast sweep does not strobe the details
    hoverT.current = window.setTimeout(() => setActive(i, { scroll: false }), 34);
  };
  const onListClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>(".row");
    if (!row) return;
    const r = flat[Number(row.dataset.i)];
    if (!r) return;
    if (t.closest(".r-star")) return toggleStar(r);
    if (t.closest(".r-more")) {
      setActive(Number(row.dataset.i), { scroll: false });
      return push("detail");
    }
    choose(r);
  };
  return { onKey, onListMove, onListClick };
}
