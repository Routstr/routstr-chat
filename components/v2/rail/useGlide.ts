import { useLayoutEffect, useRef, type RefObject } from "react";
import { tokenMs } from "../motion";
import { ease, reduced } from "./helpers";

/* ── the highlight: lives in the open row, travels when you pick another ── */
export function useGlide({
  root,
  list,
  finding,
  activeConversationId,
  hideTip,
  rows,
}: {
  root: RefObject<HTMLElement | null>;
  list: RefObject<HTMLElement | null>;
  finding: boolean;
  activeConversationId: string | null;
  hideTip: (now?: boolean) => void;
  /** the list's rows: its fades are read again when they change */
  rows: unknown;
}) {
  const glideFrom = useRef<DOMRect | null>(null);
  const hostKey = finding ? "" : activeConversationId ?? "new";
  useLayoutEffect(() => {
    const g = root.current?.querySelector<HTMLElement>(".sb-glide");
    const from = glideFrom.current;
    glideFrom.current = g ? g.getBoundingClientRect() : null;
    if (!g || !from || reduced()) return;
    const to = glideFrom.current!;
    const dy = from.top - to.top;
    if (Math.abs(dy) > 360) g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: tokenMs("--d-fast"), easing: ease("--e-out") });
    else if (Math.abs(dy) > 0.5)
      g.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: tokenMs("--d-move"), easing: ease("--e-spring") });
  }, [hostKey]);
  const edgeRaf = useRef(0);
  const onScroll = () => {
    hideTip(true);
    cancelAnimationFrame(edgeRaf.current);
    edgeRaf.current = requestAnimationFrame(() => {
      edges();
      glideFrom.current = root.current?.querySelector<HTMLElement>(".sb-glide")?.getBoundingClientRect() ?? null;
    });
  };
  // a fade only where there is more
  const edges = () => {
    const l = list.current;
    if (!l) return;
    l.toggleAttribute("data-more", l.scrollHeight - l.scrollTop - l.clientHeight > 2);
    l.toggleAttribute("data-scrolled", l.scrollTop > 2);
  };
  useLayoutEffect(edges, [list, hostKey, rows]);
  return { edges, onScroll };
}
