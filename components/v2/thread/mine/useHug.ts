import { useLayoutEffect, type RefObject } from "react";

// a phone bubble hugs its widest line: wrapped text leaves the box at the
// width it had before wrapping, which strands an empty band on the right
export function useHug(wrapRef: RefObject<HTMLDivElement | null>, text: string) {
  useLayoutEffect(() => {
    const w = wrapRef.current;
    if (!w) return;
    const hug = () => {
      w.style.width = "";
      if (!window.matchMedia("(max-width: 760px)").matches || w.querySelector(".rd-qc")) return;
      const r = document.createRange();
      const lines = () => {
        let right = 0;
        let left = Infinity;
        let n = 0;
        w.querySelectorAll(".rd-ql").forEach((l) => {
          r.selectNodeContents(l);
          for (const b of Array.from(r.getClientRects())) {
            right = Math.max(right, b.right);
            left = Math.min(left, b.left);
            n++;
          }
        });
        return { span: right - left, n };
      };
      const was = lines();
      if (!was.n) return;
      const cs = getComputedStyle(w);
      const need = Math.ceil(was.span + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 1);
      if (need >= w.offsetWidth - 1) return;
      w.style.width = `${need}px`;
      // the narrower box must not wrap into more lines
      if (lines().n > was.n) w.style.width = "";
    };
    hug();
    let vw = window.innerWidth;
    const on = () => {
      if (window.innerWidth === vw) return;
      vw = window.innerWidth;
      hug();
    };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [text]);
}
