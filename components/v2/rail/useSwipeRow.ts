import React, { useEffect, useRef } from "react";
import { tokenMs } from "../motion";
import type { useUi } from "../ui";
import { ease, phoneNow } from "./helpers";

/* ── phone: swipe a row left to delete ──────────────────────────────── */
export function useSwipeRow(ui: ReturnType<typeof useUi>) {
  // raw: how far the finger has taken the row from closed (a row resting open starts at -96)
  // hold: the press-and-hold timer (a second way to Delete for someone who never swipes)
  const sw = useRef<{ go: HTMLElement; row: HTMLElement; x: number; y: number; dx: number; raw: number; base: number; on: boolean; id: number; hold: number; held: boolean; pts: { x: number; t: number }[] } | null>(null);
  const justSwiped = useRef(-1e9);
  const swDown = (e: React.PointerEvent) => {
    const go = (e.target as Element).closest<HTMLElement>(".sb-go");
    if (!go || !phoneNow() || e.button > 0) return;
    const row = go.closest<HTMLElement>(".sb-row")!;
    if (row.classList.contains("is-leaving")) return;
    const base = openRow.current === row ? -96 : 0;
    const s = { go, row, x: e.clientX, y: e.clientY, dx: base, raw: base, base, on: false, id: e.pointerId, hold: 0, held: false, pts: [{ x: e.clientX, t: e.timeStamp }] };
    // held still for 450ms, a closed row gives a small press and opens on its Delete
    if (!base)
      s.hold = window.setTimeout(() => {
        s.held = true;
        row.animate([{ transform: "scale(1)" }, { transform: "scale(.975)" }, { transform: "scale(1)" }], { duration: tokenMs("--d-mid") * 2, easing: ease("--e-out") });
        row.classList.remove("is-homing");
        row.classList.add("is-swiping", "is-open");
        row.style.setProperty("--sw", "1");
        go.style.transition = `transform ${tokenMs("--d-mid")}ms ${ease("--e-spring")}`;
        go.style.transform = "translateX(-96px)";
        closeOpen(true);
        openRow.current = row;
        navigator.vibrate?.(8);
      }, 450);
    sw.current = s;
  };
  const swMove = (e: React.PointerEvent) => {
    const s = sw.current;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.held) return;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) window.clearTimeout(s.hold);
    if (!s.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (sw.current = null);
      // a closed row starts only leftwards; one resting open can go either way
      if (!((s.base ? Math.abs(dx) > 8 : dx < -8) && Math.abs(dx) > Math.abs(dy))) return;
      s.on = true;
      s.row.classList.remove("is-homing");
      s.row.classList.add("is-swiping");
      try {
        s.go.setPointerCapture(e.pointerId);
      } catch {
        // a pointer that is already gone cannot be captured; the swipe still follows it
      }
    }
    const w = s.go.offsetWidth;
    // 1:1 to the Delete (96px), then it resists
    s.raw = s.base + dx;
    s.pts.push({ x: e.clientX, t: e.timeStamp });
    if (s.pts.length > 6) s.pts.shift();
    s.dx = s.raw > 0 ? s.raw * 0.2 : s.raw >= -96 ? s.raw : -96 + (s.raw + 96) * 0.6;
    s.go.style.transition = "none";
    s.go.style.transform = `translateX(${s.dx}px)`;
    s.row.style.setProperty("--sw", Math.min(1, -s.dx / (w * 0.25)).toFixed(3));
  };
  // a swipe never deletes on its own: however far or fast, it rests open on Delete, which takes a
  // tap (a push over the list to shut the drawer can never remove a chat). A pointercancel springs
  // back. The click that ends a real swipe is ignored by time
  const swEnd = (e: React.PointerEvent) => {
    const s = sw.current;
    if (!s) return;
    sw.current = null;
    window.clearTimeout(s.hold);
    if (s.held) {
      // the click this lift makes belongs to the hold, not to the row it just opened
      const swallow = (c: MouseEvent) => {
        c.preventDefault();
        c.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 60);
      return;
    }
    if (!s.on) return;
    if (e.type === "pointerup") justSwiped.current = performance.now();
    // a fast push left, or one far past the Delete, is the drawer being pushed shut: the row goes
    // home and the drawer closes. A slow, deliberate drag rests open on Delete
    const a = s.pts[0];
    const z = s.pts[s.pts.length - 1];
    const v = e.timeStamp - z.t > 80 ? 0 : z.t > a.t ? (a.x - z.x) / (z.t - a.t) : 0;
    const shut = e.type === "pointerup" && !s.base && phoneNow() && ui.drawer && (v > 0.6 || s.raw < -156);
    if (shut) ui.setDrawer(false);
    if (!shut && e.type === "pointerup" && -s.raw > 48 && !(s.base && s.raw - s.base > 8)) {
      // (a row resting open that the finger pushed right, however little, closes)
      // part of the way: the row rests open on its Delete, which a tap then takes
      s.go.style.transition = `transform ${tokenMs("--d-mid")}ms ${ease("--e-spring")}`;
      s.go.style.transform = "translateX(-96px)";
      s.row.style.setProperty("--sw", "1");
      s.row.classList.add("is-open");
      openRow.current = s.row;
    } else {
      s.go.style.transition = `transform ${tokenMs("--d-move")}ms ${ease("--e-spring")}`;
      s.go.style.transform = "";
      s.row.style.removeProperty("--sw");
      s.row.classList.remove("is-open");
      // the edge fade and the inset go home with the row, so nothing changes after it settles
      s.row.classList.add("is-homing");
      if (openRow.current === s.row) openRow.current = null;
      window.setTimeout(() => s.row.classList.remove("is-swiping", "is-homing"), tokenMs("--d-move"));
    }
  };
  // a row resting open closes on any touch elsewhere, or on another row
  const openRow = useRef<HTMLElement | null>(null);
  const closeOpen = (now = false) => {
    const row = openRow.current;
    if (!row) return;
    openRow.current = null;
    const go = row.querySelector<HTMLElement>(".sb-go");
    if (go) {
      go.style.transition = now ? "none" : `transform ${tokenMs("--d-mid")}ms ${ease("--e-spring")}`;
      go.style.transform = "";
    }
    row.style.removeProperty("--sw");
    row.classList.remove("is-open");
    row.classList.add("is-homing");
    window.setTimeout(() => row.classList.remove("is-swiping", "is-homing"), now ? 0 : tokenMs("--d-mid"));
  };
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const row = openRow.current;
      if (row && !row.contains(e.target as Node)) closeOpen();
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { swDown, swMove, swEnd, openRow, closeOpen, justSwiped };
}
