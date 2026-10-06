import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  shareReplay,
} from "rxjs";
import { getStorageItem } from "@/utils/storageUtils";
import type { NostrEvent } from "nostr-tools";

const WOT_PUBKEY_KEY = "wotPubkey";

export function updateWotPubkey(pubkey: string | null) {
  wotPubkey$.next(pubkey);
}

// Listen for storage events from other tabs (only in browser)
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === WOT_PUBKEY_KEY) {
      const newValue = e.newValue ? JSON.parse(e.newValue) : null;
      wotPubkey$.next(newValue);
    }
  });
}

// Reactive relay URLs input - updated by the old sync hooks from the app config
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

// Optional WoT pubkey override for config sync reads
export const wotPubkey$ = new BehaviorSubject<string | null>(
  typeof window !== "undefined"
    ? getStorageItem<string | null>(WOT_PUBKEY_KEY, null)
    : null
);
export const wotPubkeyDefined$ = wotPubkey$.pipe(
  filter((pubkey): pubkey is string => pubkey !== null && pubkey.length > 0),
  distinctUntilChanged(),
  shareReplay(1)
);

// User signer for the old config sync (kind 30078)
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
