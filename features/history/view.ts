import { createContext, useContext, useSyncExternalStore } from "react";
import type { Conversation } from "@/types/chat";
import type { PnsKeys } from "@/lib/pns";
import {
  SYNC_KEY,
  flag,
  type HistoryService,
  type HistoryStatus,
} from "./service";
import type { ThreadSlot } from "./thread";

export type { HistoryService } from "./service";
export type { ThreadSlot } from "./thread";

/** The active account's history; null while no account is signed in.
 *  Filled by the composition root (/lab fills it with its simulated chats). */
export const HistoryContext = createContext<HistoryService | null>(null);

export const useHistory = (): HistoryService | null =>
  useContext(HistoryContext);

const EMPTY: Conversation[] = [];
const idle = () => () => {};

function useHistoryValue<T>(
  read: (history: HistoryService) => T,
  fallback: T
): T {
  const history = useHistory();
  return useSyncExternalStore(
    history?.subscribe ?? idle,
    () => (history ? read(history) : fallback),
    () => fallback
  );
}

/** Every chat, newest first. */
export const useConversations = (): Conversation[] =>
  useHistoryValue((history) => history.getConversations(), EMPTY);

/** True once this device's copy is on screen, or there is none to wait for
 *  (no account signed in). */
export const useHistoryLoaded = (): boolean =>
  useHistoryValue<HistoryStatus | null>((history) => history.getStatus(), null) !== "loading";

export const useThread = (
  conversationId: string | null
): ThreadSlot[] | undefined =>
  useHistoryValue(
    (history) =>
      conversationId ? history.getThread(conversationId) : undefined,
    undefined
  );

/** The account's history keys, for encrypted files on Blossom. */
export const useHistoryKeys = (): PnsKeys | undefined =>
  useHistoryValue((history) => history.writingKeys(), undefined);

const syncListeners = new Set<() => void>();
const readSync = () => flag(window.localStorage, SYNC_KEY, true);

export function useSyncSetting(): [boolean, (on: boolean) => void] {
  const history = useHistory();
  const on = useSyncExternalStore(
    (listener) => {
      syncListeners.add(listener);
      return () => syncListeners.delete(listener);
    },
    readSync,
    () => true
  );
  const set = (next: boolean) => {
    window.localStorage.setItem(SYNC_KEY, JSON.stringify(next));
    syncListeners.forEach((listener) => listener());
    if (next) history?.sync().catch(() => {});
  };
  return [on, set];
}
