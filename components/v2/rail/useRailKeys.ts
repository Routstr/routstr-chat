import { useEffect } from "react";
import type { useUi } from "../ui";
import { phoneNow } from "./helpers";

// Esc: the room menu, then the wallet, then the drawer. ⌘B folds.
export function useRailKeys({
  ui,
  isSidebarCollapsed,
  setFold,
  turn,
  hideTip,
}: {
  ui: ReturnType<typeof useUi>;
  isSidebarCollapsed: boolean;
  setFold: (on: boolean) => void;
  turn: (side: "chats" | "wallet") => void;
  hideTip: (now?: boolean) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setFold(!isSidebarCollapsed);
        return;
      }
      if (e.key !== "Escape") return;
      // a layer above the rail takes its own Esc
      if (ui.palette || ui.picker || ui.settings) return;
      if (ui.side === "wallet") {
        turn("chats");
        return;
      }
      if (ui.drawer) ui.setDrawer(false);
      hideTip(true);
    };
    // the palette's Collapse or Show sidebar folds through the same path as
    // ⌘B, and its Wallet turns the card over the way the balance does
    const onFold = () => setFold(!isSidebarCollapsed);
    const onWallet = () => {
      if (phoneNow()) ui.setDrawer(true);
      turn("wallet");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("v2:fold", onFold);
    window.addEventListener("v2:wallet", onWallet);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("v2:fold", onFold);
      window.removeEventListener("v2:wallet", onWallet);
    };
  });
}
