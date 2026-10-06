import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import type { RefundResult } from "@/features/payments/refund";
import type { ReplyCosts } from "./costs";
import type { RunSnapshot } from "./run";
import type { ChatService } from "./service";

/** The signed-in account's chat, as the composition root provides it. */
export interface AccountChatView {
  chat: ChatService;
  costs: ReplyCosts;
  refund(): Promise<RefundResult[]>;
  viewing(conversationId: string | null): void;
}

export const AccountChatContext = createContext<AccountChatView | null>(null);

/** The active account's chat, or null when nobody is signed in. */
export const useAccountChat = (): AccountChatView | null =>
  useContext(AccountChatContext);

const none = () => () => {};

/** The latest run of a conversation, re-rendering at most once per frame. */
export function useRun(conversationId: string | null): RunSnapshot | undefined {
  const chat = useAccountChat()?.chat;
  const subscribe = useCallback(
    (listener: () => void) =>
      chat && conversationId ? chat.watch(conversationId, listener) : () => {},
    [chat, conversationId]
  );
  return useSyncExternalStore(
    subscribe,
    () =>
      conversationId ? chat?.getRun(conversationId)?.getSnapshot() : undefined,
    () => undefined
  );
}

/** A turn of this conversation has not saved its answer yet. */
export function useAsking(conversationId: string | null): boolean {
  const chat = useAccountChat()?.chat;
  return useSyncExternalStore(
    chat?.subscribe ?? none,
    () => Boolean(conversationId && chat?.asking(conversationId)),
    () => false
  );
}

const noCosts: Record<string, number> = {};

/** What each reply of the active account cost, by reply event id. */
export function useReplyCosts(): Record<string, number> {
  const costs = useAccountChat()?.costs;
  return useSyncExternalStore(
    costs?.subscribe ?? none,
    () => costs?.getSnapshot() ?? noCosts,
    () => noCosts
  );
}
