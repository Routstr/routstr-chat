import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  shareReplay,
} from "rxjs";
import { getStorageItem } from "@/utils/storageUtils";
import type { NostrEvent } from "nostr-tools";

// Storage key for chat sync enabled (shared with [`hooks/useChatSync.ts`](hooks/useChatSync.ts:1))
const CHAT_SYNC_ENABLED_KEY = "chatSyncEnabled";

// Reactive chat sync enabled state - reads from localStorage
export const chatSyncEnabled$ = new BehaviorSubject<boolean>(
  typeof window !== "undefined"
    ? getStorageItem<boolean>(CHAT_SYNC_ENABLED_KEY, true)
    : true
);

// Function to update chatSyncEnabled$ when storage changes
// This should be called from components that update the setting
export function updateChatSyncEnabled(enabled: boolean) {
  chatSyncEnabled$.next(enabled);
}

// Listen for storage events from other tabs (only in browser)
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === CHAT_SYNC_ENABLED_KEY) {
      const newValue = e.newValue ? JSON.parse(e.newValue) : true;
      chatSyncEnabled$.next(newValue);
    }
  });
}

// Reactive relay URLs input - updated by [`useChatSync1081()`](hooks/useChatSync1081.ts:1)
export const relayUrls$ = new BehaviorSubject<string[]>([]);
export const relayUrlsDefined$ = relayUrls$.pipe(
  filter((urls): urls is string[] => urls.length > 0),
  distinctUntilChanged(
    (prev, curr) =>
      prev.length === curr.length && prev.every((url, i) => url === curr[i])
  ),
  shareReplay(1)
);

// Reactive user pubkey input - updated by [`context/ChatProvider.tsx`](context/ChatProvider.tsx:1)
export const userPubkey$ = new BehaviorSubject<string | null>(null);
export const userPubkeyDefined$ = userPubkey$.pipe(
  filter((pubkey): pubkey is string => pubkey !== null),
  distinctUntilChanged(),
  shareReplay(1)
);

// User signer for encrypting/decrypting kind-1081 events
export interface UserSignerInfo {
  signer: {
    nip44: {
      encrypt: (pubkey: string, plaintext: string) => Promise<string>;
      decrypt: (pubkey: string, content: string) => Promise<string>;
    };
    signEvent: (event: {
      kind: number;
      created_at: number;
      tags: string[][];
      content: string;
    }) => Promise<NostrEvent>;
  };
  pubkey: string;
}

export const userSigner$ = new BehaviorSubject<UserSignerInfo | null>(null);
export const userSignerDefined$ = userSigner$.pipe(
  filter(
    (info): info is UserSignerInfo =>
      info !== null &&
      info.signer?.nip44?.encrypt !== undefined &&
      info.signer?.nip44?.decrypt !== undefined &&
      info.signer?.signEvent !== undefined
  ),
  distinctUntilChanged((prev, curr) => prev.pubkey === curr.pubkey),
  shareReplay(1)
);

