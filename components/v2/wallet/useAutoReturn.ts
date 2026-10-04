import { useEffect, useRef } from "react";
import { useChat } from "@/context/ChatProvider";
import { useSdkCachedBalance } from "@/hooks/useSdkCachedBalance";
import { useNodePays } from "@/hooks/useRemoteNode";

/** Money a provider still holds after a reply failed comes home by itself: once the wallet has
 *  loaded, and again after each reply ends. Never while a reply runs, since its token is in use. */
export function useAutoReturn(walletLoaded: boolean) {
  const { isLoading, returnHeld } = useChat();
  const held = useSdkCachedBalance();
  const node = useNodePays();
  const busy = useRef(false);
  // the latest action, so a new function identity (the chat context re-renders often) is not a new trigger
  const run = useRef(returnHeld);
  run.current = returnHeld;
  useEffect(() => {
    if (!walletLoaded || isLoading || node || held <= 0 || busy.current) return;
    // a moment's grace: a reply that just ended may still be settling its change
    const t = window.setTimeout(() => {
      busy.current = true;
      void run.current().finally(() => {
        busy.current = false;
      });
    }, 3000);
    return () => window.clearTimeout(t);
  }, [walletLoaded, isLoading, node, held]);
}
