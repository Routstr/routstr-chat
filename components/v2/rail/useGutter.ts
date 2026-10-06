import { useLayoutEffect, type RefObject } from "react";

// the width the list's scrollbar gutter takes (0 where scrollbars overlay)
export function useGutter(list: RefObject<HTMLElement | null>, root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const l = list.current;
    const r = root.current;
    if (!l || !r) return;
    const set = () => r.style.setProperty("--gut", `${l.offsetWidth - l.clientWidth}px`);
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);
}
