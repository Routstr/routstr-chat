import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import type { RefundResult } from "@/features/payments/refund";
import type { ReplyCosts } from "./costs";
import { DEFAULT_FILE_SERVERS, type Files, type FileSync } from "./ports";
import type { RunSnapshot } from "./run";
import type { ChatService } from "./service";

/** The signed-in account's chat, as the composition root provides it. */
export interface AccountChatView {
  chat: ChatService;
  costs: ReplyCosts;
  refund(): Promise<RefundResult[]>;
  /** Sats this account holds at providers, main's old shared credit too. */
  held: {
    subscribe(listener: () => void): () => void;
    get(): number;
    /** What its key at each provider holds while the next message there
     *  spends it first (the API-key path), by address with the closing
     *  slash; the same object until that changes. */
    keys(): Readonly<Record<string, number>>;
  };
  viewing(conversationId: string | null): void;
  /** The account's files: kept here, copied to Blossom. */
  files: Files;
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

/** The chat whose turn started last, until its answer is saved. */
export function useAnswering(): string | null {
  const chat = useAccountChat()?.chat;
  return useSyncExternalStore(
    chat?.subscribe ?? none,
    () => chat?.answering() ?? null,
    () => null
  );
}

/** A turn of this account has not finished paying yet. */
export function useBusy(): boolean {
  const chat = useAccountChat()?.chat;
  return useSyncExternalStore(
    chat?.subscribe ?? none,
    () => chat?.busy() ?? false,
    () => false
  );
}

/** Sats the active account holds at providers, until a refund brings them home. */
export function useHeldCredit(): number {
  const held = useAccountChat()?.held;
  return useSyncExternalStore(
    held?.subscribe ?? none,
    () => held?.get() ?? 0,
    () => 0
  );
}

const NO_CREDIT: Readonly<Record<string, number>> = {};

/** What the active account's key at each provider will spend before the
 *  wallet, by address with the closing slash. */
export function useKeyCredit(): Readonly<Record<string, number>> {
  const held = useAccountChat()?.held;
  return useSyncExternalStore(
    held?.subscribe ?? none,
    () => held?.keys() ?? NO_CREDIT,
    () => NO_CREDIT
  );
}

/** The account's file store; null while nobody is signed in. */
export const useFiles = (): Files | null => useAccountChat()?.files ?? null;

const SYNC_OFF: FileSync = { on: false, servers: DEFAULT_FILE_SERVERS };
const keepSync = () => {};

/** Whether files are copied to Blossom, and where; off while nobody is
 *  signed in (nothing uploads without the account's keys). */
export function useFileSync(): [FileSync, (change: Partial<FileSync>) => void] {
  const files = useFiles();
  const sync = useSyncExternalStore(
    files?.subscribe ?? none,
    () => files?.sync() ?? SYNC_OFF,
    () => SYNC_OFF
  );
  return [sync, files?.setSync ?? keepSync];
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

export { editedOf, questionOf } from "./question";
export type { ChatModel, FileSync } from "./ports";
export { DEFAULT_FILE_SERVERS } from "./ports";
export type { RunSnapshot } from "./run";
