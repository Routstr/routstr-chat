import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { tokenMs } from "../motion";
import { ease, phoneNow, reduced } from "./helpers";

/* ── fold: the card becomes a spine ─────────────────────────────────── */
export function useFold({
  root,
  list,
  shade: shadeRef,
  folded,
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  hideTip,
  rollBack,
  closeMenus,
  edges,
  say,
}: {
  root: RefObject<HTMLElement | null>;
  list: RefObject<HTMLElement | null>;
  shade: RefObject<HTMLDivElement | null>;
  folded: boolean;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (on: boolean) => void;
  hideTip: (now?: boolean) => void;
  rollBack: (only?: Element) => void;
  closeMenus: () => void;
  edges: () => void;
  say: (t: string) => void;
}) {
  const flipFrom = useRef<DOMRect[] | null>(null);
  const flipEls = () =>
    [".sb-fold", ".sb-sw", ".sb-gear"].map((s) => root.current?.querySelector<HTMLElement>(`.face.front ${s}`)).filter((x): x is HTMLElement => !!x);
  const setFold = useCallback(
    (on: boolean) => {
      if (phoneNow() || on === isSidebarCollapsed) return;
      hideTip(true);
      rollBack();
      closeMenus();
      flipFrom.current = reduced() ? null : flipEls().map((el) => el.getBoundingClientRect());
      flipEls().forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
      // leaving the rest box: back on the scaled form first, so the shadow grows with the card
      const s = shadeRef.current;
      if (s?.classList.contains("is-rest")) {
        s.style.transition = "none";
        s.classList.remove("is-rest");
        void s.offsetWidth;
        s.style.transition = "";
      }
      // the list goes inert when folded: focus in it moves to the fold button,
      // and comes back to the list's row when the card opens again
      const a = document.activeElement;
      const fold = root.current?.querySelector<HTMLElement>(".face.front .sb-fold");
      const back = !on && (!a || a === document.body || a === fold);
      if (on && a && list.current?.contains(a)) fold?.focus({ preventScroll: true });
      setIsSidebarCollapsed(on);
      if (back && a === fold)
        requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('.sb-go[tabindex="0"]')?.focus({ preventScroll: true }));
    },
    [isSidebarCollapsed, setIsSidebarCollapsed]
  );
  const lastFold = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const s = shadeRef.current;
    const was = lastFold.current;
    lastFold.current = folded;
    if (was === folded) return;
    if (was === null) {
      if (folded) s?.classList.add("is-rest");
      return;
    }
    const before = flipFrom.current;
    flipFrom.current = null;
    const d = tokenMs("--d-move");
    if (before) {
      flipEls().forEach((el, i) => {
        const a = before[i];
        const b = el.getBoundingClientRect();
        if (!a) return;
        const dx = a.left - b.left;
        const dy = a.top - b.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: d, easing: ease("--e-spring") });
      });
    }
    if (!folded) {
      if (!reduced()) {
        list.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: tokenMs("--d-mid"), delay: 90, easing: ease("--e-out"), fill: "backwards" });
        root.current?.querySelectorAll(".face.front :is(.sb-lbl, .sb-word, .sb-sw-n)").forEach((el) =>
          el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: tokenMs("--d-mid"), delay: 60, easing: ease("--e-out"), fill: "backwards" })
        );
      }
      requestAnimationFrame(edges);
      say("Sidebar shown");
      return;
    }
    say("Sidebar collapsed");
    // at rest the spine's shadow is a real 60px box again, four round corners
    if (!s) return;
    if (reduced()) return void s.classList.add("is-rest");
    const rest = (e?: TransitionEvent) => {
      if (e && (e.target !== s || e.propertyName !== "transform")) return;
      window.clearTimeout(t);
      s.removeEventListener("transitionend", rest);
      s.classList.add("is-rest");
    };
    s.addEventListener("transitionend", rest);
    const t = window.setTimeout(rest, d + 120);
    return () => {
      window.clearTimeout(t);
      s.removeEventListener("transitionend", rest);
    };
  }, [folded]);
  return setFold;
}
