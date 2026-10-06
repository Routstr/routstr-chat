import { useCallback, useLayoutEffect, type RefObject } from "react";
import { lineOf, wide, type Source } from "./cite";

// each source hangs beside the line that first cites it; notes never overlap
export function useNotes(answer: RefObject<HTMLDivElement | null>, sources: Source[], text: string) {
  const layoutNotes = useCallback(() => {
    const box = answer.current;
    if (!box || !wide(box)) return;
    const top0 = box.getBoundingClientRect().top;
    let floor = -Infinity;
    box.querySelectorAll<HTMLElement>(".rd-note").forEach((note) => {
      const cite = box.querySelector<HTMLElement>(`.rd-cite[data-n="${note.dataset.n}"]`);
      let y: number;
      if (cite) {
        const line = lineOf(cite);
        const nh = parseFloat(getComputedStyle(note).lineHeight) || 15;
        y = line.top - top0 + (line.height - nh) / 2 + 1;
      } else {
        // a source nobody cites hangs by the answer's last lines
        y = (box.querySelector(".rd-ans-in")?.getBoundingClientRect().bottom ?? top0) - top0 - note.offsetHeight;
      }
      y = Math.max(y, floor);
      note.style.transform = `translateY(${Math.round(y)}px)`;
      floor = y + note.offsetHeight + 12;
    });
  }, []);
  useLayoutEffect(() => {
    if (!sources.length) return;
    layoutNotes();
    const box = answer.current;
    if (!box) return;
    let w = box.clientWidth;
    const ro = new ResizeObserver(() => {
      // only a change of width moves lines; heights change while things open
      if (box.clientWidth === w) return;
      w = box.clientWidth;
      layoutNotes();
    });
    ro.observe(box);
    document.fonts?.ready.then(layoutNotes);
    return () => ro.disconnect();
  }, [sources.length, text, layoutNotes]);
}
