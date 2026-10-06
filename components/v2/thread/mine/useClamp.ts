import { useLayoutEffect, useState, type RefObject } from "react";

// the clamp ends on the last whole line of text inside seven (six on a
// phone), never on a blank one, so the fade always lies over words
export function useClamp(wrap: RefObject<HTMLDivElement | null>, long: boolean, text: string) {
  const [more, setMore] = useState(0);
  useLayoutEffect(() => {
    const w = wrap.current;
    if (!long || !w) return;
    const measure = () => {
      const q = w.querySelector<HTMLElement>(".rd-q");
      if (!q) return;
      const top = q.getBoundingClientRect().top;
      const lh = parseFloat(getComputedStyle(q).lineHeight) || 28;
      const limit = lh * (window.innerWidth <= 760 ? 6 : 7) + 1;
      const ls = Array.from(q.querySelectorAll<HTMLElement>(".rd-ql"));
      const r = document.createRange();
      let at = 0;
      let lastK = -1;
      ls.forEach((l, k) => {
        if (!l.textContent?.trim()) return;
        r.selectNodeContents(l);
        for (const b of Array.from(r.getClientRects())) {
          const y = b.bottom - top;
          if (y <= limit && y > at) {
            at = y;
            lastK = k;
          }
        }
      });
      w.style.setProperty("--rd-clamp", `${Math.round(at + 4)}px`);
      setMore(ls.slice(lastK + 1).filter((l) => l.textContent?.trim()).length);
    };
    measure();
    let wd = w.clientWidth;
    const ro = new ResizeObserver(() => {
      if (w.clientWidth === wd) return;
      wd = w.clientWidth;
      measure();
    });
    ro.observe(w);
    return () => ro.disconnect();
  }, [long, text]);
  return more;
}
