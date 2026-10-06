import { useCallback, useEffect, useState } from "react";
import { useAccountManager } from "@/features/session/view";
import { useChat } from "@/context/ChatProvider";

/** A switch stops a reply that is still coming and waits until it has fully
 *  finished, its payment too, under the account that asked; then the next
 *  one takes over, if it was not removed meanwhile. */
export function useSwitchAccount() {
  const { manager, session } = useAccountManager();
  const { isLoading, streamingConversationId, stopGeneration } = useChat();
  const [next, setNext] = useState<string | null>(null);
  const idle = !isLoading && streamingConversationId === null;

  useEffect(() => {
    if (!next || !idle) return;
    if (manager.accounts$.value.some((a) => a.id === next)) {
      session.switchTo(next);
    }
  }, [next, idle, manager, session]);

  return useCallback(
    (id: string) => {
      stopGeneration();
      setNext(id);
    },
    [stopGeneration]
  );
}
