import { useEffect, useRef, type RefObject } from "react";
import { tokenMs } from "../motion";
import type { useUi } from "../ui";
import { ease, reduced } from "./helpers";

/* ── turn over to the wallet ────────────────────────────────────────── */
export function useTurn({
  root,
  clip,
  shade,
  ui,
  folded,
  setFold,
  hideTip,
  setRooms,
}: {
  root: RefObject<HTMLElement | null>;
  clip: RefObject<HTMLDivElement | null>;
  shade: RefObject<HTMLDivElement | null>;
  ui: ReturnType<typeof useUi>;
  folded: boolean;
  setFold: (on: boolean) => void;
  hideTip: (now?: boolean) => void;
  setRooms: (open: boolean) => void;
}) {
  const turn = (side: "chats" | "wallet") => {
    if (ui.side === side) return;
    hideTip(true);
    setRooms(false);
    if (side === "wallet" && folded) {
      setFold(false);
      window.setTimeout(() => ui.setSide("wallet"), reduced() ? 0 : tokenMs("--d-move") + 40);
    } else ui.setSide(side);
  };
  const lastSide = useRef(ui.side);
  useEffect(() => {
    if (lastSide.current === ui.side) return;
    lastSide.current = ui.side;
    const c = clip.current;
    c?.classList.add("is-turning");
    const turnMs = tokenMs("--d-slow") + tokenMs("--d-quick");
    const t1 = window.setTimeout(() => c?.classList.remove("is-turning"), reduced() ? 0 : turnMs + 40);
    if (!reduced()) shade.current?.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(.08)", opacity: 0.6 }, { transform: "scaleX(1)" }], { duration: turnMs, easing: ease("--e-turn") });
    const t2 = window.setTimeout(() => {
      const el = ui.side === "wallet" ? root.current?.querySelector<HTMLElement>(".face.back .wl-back") : root.current?.querySelector<HTMLElement>(".sb-bal");
      el?.focus({ preventScroll: true });
    }, reduced() ? 0 : tokenMs("--d-slow"));
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [ui.side]);
  return turn;
}
