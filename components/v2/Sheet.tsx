"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/* A phone sheet. It rises from the bottom to a resting height (a detent),
   follows the finger from its grabber or from anything marked
   `data-sheet-drag`, rubber-bands past the top, and on release lands on the
   nearest detent the throw points at, or closes. Only transform and opacity
   move; the exit is faster than the entrance. */

export type Detent = "mid" | "full";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  label: string;
  detents?: Detent[];
  /** Asked for from outside, e.g. details pushed in want the full height. */
  detent?: Detent;
  onDetent?: (d: Detent) => void;
  className?: string;
  children: React.ReactNode;
  initialFocus?: React.RefObject<HTMLElement | null>;
}

const MID = 0.62; // the middle detent shows this much of the screen

export default function Sheet(props: SheetProps) {
  const [mounted, setMounted] = useState(props.open);
  useEffect(() => {
    if (props.open) setMounted(true);
  }, [props.open]);
  if (!mounted) return null;
  return <SheetBody {...props} onGone={() => setMounted(false)} />;
}

function SheetBody({
  open,
  onClose,
  label,
  detents = ["mid", "full"],
  detent,
  onDetent,
  className,
  children,
  initialFocus,
  onGone,
}: SheetProps & { onGone: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const [rest, setRest] = useState<Detent>(detent ?? detents[0]);
  const moved = useRef(false);
  const drag = useRef<{ id: number; y0: number; from: number; t: number; v: number; last: number } | null>(null);

  const H = () => el.current?.offsetHeight ?? window.innerHeight;
  const yOf = useCallback((d: Detent | "closed") => {
    const h = H();
    if (d === "closed") return h;
    if (d === "full") return 0;
    return Math.max(0, h - window.innerHeight * MID);
  }, []);

  // write the position straight onto the element; React never re-renders mid drag
  const put = useCallback(
    (y: number, how: "drag" | "in" | "out") => {
      const s = el.current;
      const v = veil.current;
      if (!s || !v) return;
      s.dataset.move = how;
      v.dataset.move = how;
      s.style.transform = `translateY(${y}px)`;
      const span = Math.max(1, H() - yOf(detents[0]));
      v.style.opacity = String(Math.max(0, Math.min(1, (H() - y) / span)));
    },
    [yOf, detents]
  );

  // rise on open, fall on close
  useLayoutEffect(() => {
    if (!open) return;
    put(yOf("closed"), "drag");
    el.current?.getBoundingClientRect();
    requestAnimationFrame(() => put(yOf(rest), "in"));
    requestAnimationFrame(() => (initialFocus?.current ?? el.current)?.focus({ preventScroll: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) return;
    put(yOf("closed"), "out");
    const t = window.setTimeout(onGone, 260);
    return () => window.clearTimeout(t);
  }, [open, put, yOf, onGone]);

  // a detent asked for from outside
  useEffect(() => {
    if (!open || !detent || detent === rest) return;
    setRest(detent);
    put(yOf(detent), "in");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detent]);

  useEffect(() => {
    onDetent?.(rest);
  }, [rest, onDetent]);

  // the content can scroll its last rows clear of the screen's bottom edge
  useLayoutEffect(() => {
    el.current?.style.setProperty("--sh-pad", `${yOf(rest)}px`);
  }, [rest, yOf]);

  useEffect(() => {
    const onResize = () => put(yOf(rest), "drag");
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [rest, put, yOf]);

  const down = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest(".sh-grab, [data-sheet-drag]") || t.closest("input, textarea")) return;
    const m = new DOMMatrixReadOnly(getComputedStyle(el.current!).transform);
    moved.current = false;
    drag.current = { id: e.pointerId, y0: e.clientY, from: m.m42, t: e.timeStamp, v: 0, last: e.clientY };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y0;
    if (Math.abs(dy) < 4 && !el.current?.hasAttribute("data-dragging")) return;
    if (!el.current?.hasAttribute("data-dragging")) {
      el.current?.setAttribute("data-dragging", "");
      moved.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const dt = Math.max(1, e.timeStamp - d.t);
    d.v = (e.clientY - d.last) / dt;
    d.last = e.clientY;
    d.t = e.timeStamp;
    let y = d.from + dy;
    if (y < 0) y = -Math.sqrt(-y) * 3; // rubber band past the top
    put(y, "drag");
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !el.current?.hasAttribute("data-dragging")) return;
    el.current.removeAttribute("data-dragging");
    const m = new DOMMatrixReadOnly(getComputedStyle(el.current).transform);
    const aim = m.m42 + d.v * 180;
    const stops: (Detent | "closed")[] = [...detents, "closed"];
    const best = stops.reduce((a, b) => (Math.abs(yOf(b) - aim) < Math.abs(yOf(a) - aim) ? b : a));
    if (best === "closed") return onClose();
    setRest(best);
    put(yOf(best), "in");
  };
  // modal: Tab and Shift+Tab stay inside the sheet
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !el.current) return;
    const all = Array.from(
      el.current.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')
    ).filter((x) => x.tabIndex >= 0 && !x.hasAttribute("disabled") && !x.closest("[inert]") && x.getClientRects().length > 0);
    if (!all.length) return;
    const first = all[0];
    const last = all[all.length - 1];
    const a = document.activeElement;
    if (e.shiftKey && (a === first || a === el.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && a === last) {
      e.preventDefault();
      first.focus();
    }
  };
  // a tap on the grabber toggles between the two heights
  const tapGrab = () => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    if (detents.length < 2) return onClose();
    const next = rest === "full" ? "mid" : "full";
    setRest(next);
    put(yOf(next), "in");
  };

  return (
    <>
      <div ref={veil} className="sh-veil" onClick={onClose} aria-hidden="true" />
      <div
        ref={el}
        className={`sheet${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-rest={rest}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={trap}
      >
        <button className="sh-grab" type="button" aria-label={rest === "full" ? "Make smaller" : "Make taller"} onClick={tapGrab}>
          <span />
        </button>
        {children}
      </div>
    </>
  );
}
