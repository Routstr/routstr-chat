import { useRef } from "react";
import { tokenMs } from "../motion";
import { ease, phoneNow, reduced } from "./helpers";

const ROLL_MAX = 1.5; // title width / row width above which the whole title opens instead of rolling

/* ── a cut title shows the rest of itself after a still moment. A little
      over: the words glide left and hold. Much longer: the row opens. ── */
export function useTitleRoll({
  folded,
  showTip,
  hideTip,
}: {
  folded: boolean;
  showTip: (el: HTMLElement, kind: string) => void;
  hideTip: (now?: boolean) => void;
}) {
  const rolling = useRef<{ row: HTMLElement; anim: Animation | null; peek: boolean } | null>(null);
  const rollTimer = useRef(0);
  const rollBack = (only?: Element) => {
    window.clearTimeout(rollTimer.current);
    const r = rolling.current;
    if (!r || (only && r.row !== only)) return;
    rolling.current = null;
    if (r.peek) hideTip();
    const t = r.row.querySelector(".sb-t");
    const tt = r.row.querySelector<HTMLElement>(".sb-tt");
    t?.classList.remove("is-rolling");
    if (!r.anim || !tt) return;
    const m = new DOMMatrix(getComputedStyle(tt).transform);
    r.anim.cancel();
    if (Math.abs(m.m41) > 0.5)
      tt.animate([{ transform: `translateX(${m.m41}px)` }, { transform: "none" }], { duration: tokenMs("--d-move"), easing: ease("--e-out") });
  };
  const roll = (row: HTMLElement) => {
    const t = row.querySelector<HTMLElement>(".sb-t");
    const tt = row.querySelector<HTMLElement>(".sb-tt");
    if (!t || !tt) return;
    const over = tt.scrollWidth - t.clientWidth;
    if (over <= 0) return;
    if (reduced() || tt.scrollWidth > t.clientWidth * ROLL_MAX) {
      showTip(row, "title");
      rolling.current = { row, anim: null, peek: true };
      return;
    }
    const dist = over + 34; // clear of the right fade and the delete slot
    t.classList.add("is-rolling");
    const anim = tt.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-dist}px)` }], {
      duration: Math.min(1600, Math.max(900, (dist / 42) * 1000)),
      easing: ease("--e-in-out"),
      fill: "forwards",
    });
    rolling.current = { row, anim, peek: false };
  };
  const armRoll = (row: HTMLElement, wait = 480) => {
    if (phoneNow() || folded || rolling.current?.row === row) return;
    rollBack();
    const t = row.querySelector<HTMLElement>(".sb-t");
    if (!t || t.scrollWidth <= t.clientWidth + 1) return; // measured on rest, so a late web font never fools it
    rollTimer.current = window.setTimeout(() => roll(row), wait);
    rolling.current = { row, anim: null, peek: false };
  };
  return { rollBack, armRoll };
}
