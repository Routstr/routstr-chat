import React, { useRef, type RefObject } from "react";
import { ACT } from "./useSwipeRow";

/* ── pointer and keys on the list ───────────────────────────────────── */
export function useListActions({
  list,
  remove,
  pin,
  undo,
  open,
  finalise,
  setFocusId,
  openRow,
  closeOpen,
  justSwiped,
}: {
  list: RefObject<HTMLElement | null>;
  remove: (id: string, key: boolean) => void;
  pin: (id: string) => void;
  undo: (id: string) => void;
  open: (id: string) => void;
  finalise: (id: string) => void;
  setFocusId: (id: string) => void;
  openRow: RefObject<HTMLElement | null>;
  closeOpen: (now?: boolean) => void;
  justSwiped: RefObject<number>;
}) {
  const delAt = useRef(-1e9);
  const onListClick = (e: React.MouseEvent) => {
    const t = e.target as Element;
    const row = t.closest<HTMLElement>(".sb-row");
    if (!row) return;
    const id = row.dataset.id!;
    if (t.closest(".sb-x")) {
      if (e.detail !== 0) delAt.current = performance.now();
      return remove(id, e.detail === 0);
    }
    if (t.closest(".sb-pin")) return pin(id);
    // a row resting open: its Pin pins, its Delete deletes, a tap on the row itself closes it
    // (not the click that ends the swipe that opened it, wherever the pointer stopped)
    if (openRow.current === row) {
      if (performance.now() - justSwiped.current < 350) return;
      // Delete is the row's right ACT, Pin the ACT before it, their clipped edges too
      const x = row.getBoundingClientRect().right - e.clientX;
      if (t.closest(".sb-under-d") || x < ACT) {
        closeOpen(true);
        return remove(id, false);
      }
      if (t.closest(".sb-under-p") || x < 2 * ACT) {
        closeOpen(true);
        return pin(id);
      }
      return closeOpen();
    }
    // Undo takes the bin's place: a second click of a double-click is not an undo
    if (t.closest(".sb-undo-b")) return performance.now() - delAt.current < 350 ? undefined : undo(id);
    if (t.closest(".sb-go")) {
      if (performance.now() - justSwiped.current < 350) return;
      open(id);
    }
  };
  const onListKey = (e: React.KeyboardEvent) => {
    const t = e.target as Element;
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>(".sb-row:not(.is-gone)") ?? []);
    // from Undo the arrows carry on through the list (leaving Undo lets the ring run)
    const ub = t.closest(".sb-undo-b");
    if (ub && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const i = rows.indexOf(ub.closest(".sb-row") as HTMLElement);
      const dir = e.key === "ArrowDown" ? 1 : -1;
      let j = i + dir;
      while (rows[j]?.classList.contains("is-leaving")) j += dir;
      const n = rows[j];
      if (!n) return;
      e.preventDefault();
      setFocusId(n.dataset.id!);
      n.querySelector<HTMLElement>(".sb-go")?.focus();
      n.scrollIntoView({ block: "nearest" });
      return;
    }
    const go = t.closest(".sb-go");
    if (!go) return;
    const live = rows.filter((r) => !r.classList.contains("is-leaving"));
    const i = live.indexOf(go.closest(".sb-row") as HTMLElement);
    let n: HTMLElement | undefined;
    if (e.key === "ArrowDown") n = live[Math.min(live.length - 1, i + 1)];
    if (e.key === "ArrowUp") n = live[Math.max(0, i - 1)];
    if (e.key === "Home") n = live[0];
    if (e.key === "End") n = live[live.length - 1];
    if (e.key === "Delete" || (e.key === "Backspace" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      return remove((go.closest(".sb-row") as HTMLElement).dataset.id!, true);
    }
    // only a chat reached by keys: a P typed after a click on the open chat goes to the composer
    if ((e.key === "p" || e.key === "P") && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && go.matches(":focus-visible")) {
      e.preventDefault();
      return pin((go.closest(".sb-row") as HTMLElement).dataset.id!);
    }
    if (!n) return;
    e.preventDefault();
    setFocusId(n.dataset.id!);
    n.querySelector<HTMLElement>(".sb-go")?.focus();
    n.scrollIntoView({ block: "nearest" });
  };
  const onListEnd = (e: React.TransitionEvent) => {
    if (e.propertyName !== "grid-template-rows") return;
    const el = e.target as HTMLElement;
    if (!el.classList.contains("is-gone")) return;
    el.querySelectorAll<HTMLElement>(".sb-row.is-gone").forEach((r) => finalise(r.dataset.id!));
    if (el.classList.contains("sb-row")) finalise(el.dataset.id!);
  };
  return { delAt, onListClick, onListKey, onListEnd };
}
