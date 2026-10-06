import { useCallback } from "react";
import { useAccountChat } from "@/features/chat/view";
import { useAccountManager } from "@/features/session/view";

/** A switch stops a reply that is still coming and waits until it has fully
 *  finished, its payment too, under the account that asked; then the next
 *  one takes over, if it was not removed meanwhile. */
export function useSwitchAccount() {
  const { manager, session } = useAccountManager();
  const chat = useAccountChat()?.chat;
  return useCallback(
    (id: string) => {
      void Promise.resolve(chat?.stopAll()).finally(() => {
        if (manager.accounts$.value.some((a) => a.id === id)) session.switchTo(id);
      });
    },
    [chat, manager, session]
  );
}
