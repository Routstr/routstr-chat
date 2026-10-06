import React, { type RefObject } from "react";
import type { useUndoDelete } from "./useUndoDelete";

export function useRailHover({
  tip,
  folded,
  tipFor,
  armTip,
  hideTip,
  armRoll,
  rollBack,
  ringOf,
  delAt,
}: {
  tip: RefObject<HTMLDivElement | null>;
  folded: boolean;
  tipFor: RefObject<Element | null>;
  armTip: (el: HTMLElement, kind: string) => void;
  hideTip: (now?: boolean) => void;
  armRoll: (row: HTMLElement, wait?: number) => void;
  rollBack: (only?: Element) => void;
  ringOf: ReturnType<typeof useUndoDelete>["ringOf"];
  delAt: RefObject<number>;
}) {
  const onRailOver = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const t = e.target as Element;
    const row = t.closest<HTMLElement>(".sb-row");
    if (row && !row.classList.contains("is-leaving")) armRoll(row);
    const k = t.closest<HTMLElement>("[data-tipk]");
    if (k) {
      const kind = k.dataset.tipk!;
      if (folded || kind === "fold" || kind === "gear") return armTip(k, kind);
    }
    if (tipFor.current && !tipFor.current.contains(t)) hideTip();
    // an open title layer mirrors the real delete button's hover
    const tl = tip.current;
    if (tl) tl.classList.toggle("is-x", !!t.closest(".sb-x") && tl.classList.contains("is-title"));
  };
  // the ring holds while you point at its line; only a real move counts, not
  // the Undo that just appeared under a still cursor
  const onRailMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || performance.now() - delAt.current < 350) return;
    ringOf(e.target as Element)?.a?.pause();
  };
  const onRailOut = (e: React.PointerEvent) => {
    const t = e.target as Element;
    const row = t.closest(".sb-row");
    if (row && !row.contains(e.relatedTarget as Node | null)) rollBack(row);
    const r = ringOf(t);
    if (r && !r.row.contains(e.relatedTarget as Node | null)) {
      const a = document.activeElement;
      if (!(r.row.contains(a) && a?.matches(":focus-visible"))) r.a?.play();
    }
  };
  const onListFocus = (e: React.FocusEvent) => {
    const t = e.target as HTMLElement;
    const r = ringOf(t);
    if (r && t.matches(":focus-visible")) r.a?.pause();
    const go = t.closest(".sb-go");
    if (!go || !t.matches(":focus-visible")) return;
    const row = go.closest<HTMLElement>(".sb-row")!;
    row.classList.add("is-kbd");
    armRoll(row, 700);
  };
  const onListBlur = (e: React.FocusEvent) => {
    const t = e.target as HTMLElement;
    const r = ringOf(t);
    if (r && !r.row.contains(e.relatedTarget as Node | null) && !r.row.matches(":hover")) r.a?.play();
    const row = t.closest(".sb-row");
    if (row && !row.contains(e.relatedTarget as Node | null)) {
      row.classList.remove("is-kbd");
      rollBack(row);
    }
  };
  return { onRailOver, onRailMove, onRailOut, onListFocus, onListBlur };
}
