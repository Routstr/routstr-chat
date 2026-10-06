import React, { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { wide, type Source } from "./cite";

export function useCites(root: RefObject<HTMLElement | null>, answer: RefObject<HTMLDivElement | null>, sources: Source[]) {
  // cite and note light up together
  const lite = (n: string | undefined, on: boolean) => {
    if (!n) return;
    root.current?.querySelectorAll(`.rd-cite[data-n="${n}"], .rd-note[data-n="${n}"], .rd-src[data-n="${n}"]`).forEach((el) => el.toggleAttribute("data-lit", on));
  };
  const [card, setCard] = useState<{ cite: HTMLElement; n: string; pinned: boolean } | null>(null);
  const closeT = useRef(0);
  // focus handed back from a closed card must not open it again
  const returning = useRef(false);
  const closeCard = useCallback((back?: boolean) => {
    window.clearTimeout(closeT.current);
    setCard((c) => {
      if (c) {
        if (!c.cite.matches(":hover")) c.cite.removeAttribute("data-lit");
        if (back && document.activeElement !== c.cite) {
          returning.current = true;
          c.cite.focus({ preventScroll: true });
          requestAnimationFrame(() => (returning.current = false));
        }
      }
      return null;
    });
  }, []);
  const soonClose = () => {
    window.clearTimeout(closeT.current);
    closeT.current = window.setTimeout(() => setCard((c) => (c && !c.pinned ? (c.cite.removeAttribute("data-lit"), null) : c)), 150);
  };
  const openCard = (cite: HTMLElement, pinned: boolean) => {
    window.clearTimeout(closeT.current);
    const n = cite.dataset.n;
    if (!n || !sources[Number(n) - 1]) return;
    setCard((c) => (c && c.cite === cite ? { ...c, pinned: c.pinned || pinned } : { cite, n, pinned }));
    lite(n, true);
  };
  // a press outside a pinned card closes it
  useEffect(() => {
    if (!card?.pinned) return;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".rd-card") || t === card.cite) return;
      closeCard();
    };
    window.addEventListener("pointerdown", down);
    return () => window.removeEventListener("pointerdown", down);
  }, [card, closeCard]);

  const onOver = (e: React.PointerEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".rd-cite, .rd-note, .rd-src");
    if (!c) return;
    lite(c.dataset.n, true);
    if (c.matches(".rd-cite") && !wide(answer.current) && e.pointerType !== "touch") openCard(c, false);
  };
  const onOut = (e: React.PointerEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".rd-cite, .rd-note, .rd-src");
    if (!c || c.contains(e.relatedTarget as Node)) return;
    const mine = card?.cite === c;
    if (!mine) lite(c.dataset.n, false);
    if (mine && !card?.pinned && !(e.relatedTarget as HTMLElement | null)?.closest?.(".rd-card")) soonClose();
  };
  const onFocusIn = (e: React.FocusEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".rd-cite, .rd-note");
    if (!c) return;
    lite(c.dataset.n, true);
    if (c.matches(".rd-cite") && !wide(answer.current) && !returning.current) openCard(c, false);
  };
  const onFocusOut = (e: React.FocusEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".rd-cite, .rd-note");
    if (!c) return;
    if ((e.relatedTarget as HTMLElement | null)?.closest?.(".rd-card")) return;
    lite(c.dataset.n, false);
    if (card?.cite === c && !card.pinned) closeCard();
  };
  const onClick = (e: React.MouseEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".rd-cite");
    if (!c || wide(answer.current)) return;
    // no margin: a citation opens its card instead of leaving the page
    e.preventDefault();
    if (card?.cite === c && card.pinned) return closeCard();
    openCard(c, true);
  };
  return { card, closeT, closeCard, soonClose, onOver, onOut, onFocusIn, onFocusOut, onClick };
}
