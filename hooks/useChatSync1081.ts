import { useEffect, useState, useRef } from "react";
import {
  BehaviorSubject,
  Subject,
  filter,
  shareReplay,
  combineLatest,
  switchMap,
  tap,
  map,
  defaultIfEmpty,
  merge,
  catchError,
  EMPTY,
  scan,
  distinctUntilChanged,
  from,
  mergeMap,
  withLatestFrom,
  share,
  take,
  timeout,
  of,
  retry,
} from "rxjs";
import { nip19, generateSecretKey } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { KIND_PNS, PnsKeys, derivePnsKeys, SALT_PNS } from "@/lib/pns";
import { decodePrivateKey } from "@/lib/nostr";
import { useAppContext } from "@/hooks/useAppContext";
import { eventStore, relayPool } from "@/lib/applesauce-core";
import { useEventDatabase } from "@/lib/eventDatabase";
import { onlyEvents, SyncDirection } from "applesauce-relay";
import { getStorageItem } from "@/utils/storageUtils";

// Debug toggle - set to false to disable console logs
const ENABLE_DEBUG_LOGS = false;

// Debug logging helpers
const debugLog = (...args: any[]) => {
  if (ENABLE_DEBUG_LOGS) console.log(...args);
};

const debugWarn = (...args: any[]) => {
  if (ENABLE_DEBUG_LOGS) console.warn(...args);
};

// Storage key for chat sync enabled (shared with useChatSync.ts)
const CHAT_SYNC_ENABLED_KEY = "chatSyncEnabled";

// Reactive chat sync enabled state - reads from localStorage
export const chatSyncEnabled$ = new BehaviorSubject<boolean>(
  typeof window !== "undefined"
    ? getStorageItem<boolean>(CHAT_SYNC_ENABLED_KEY, true)
    : true,
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

// Reactive relay URLs input - exported so it can be updated from the component
export const relayUrls$ = new BehaviorSubject<string[]>([]);

// Subject to trigger derived PNS sync manually
export const syncDerivedPnsTrigger$ = new Subject<void>();

// Function to trigger derived PNS sync manually
// This now works reliably because it uses an imperative approach that creates fresh subscriptions
export function triggerDerivedPnsSync() {
  const relays = relayUrls$.getValue();
  const signer = userSigner$.getValue();

  debugLog("[useChatSync1081] Manual derived PNS sync triggered.");

  if (relays.length === 0) {
    debugWarn(
      "[useChatSync1081] Triggered sync but relayUrls is empty! Sync will not proceed to network.",
    );
  }

  if (!signer) {
    debugWarn(
      "[useChatSync1081] Triggered sync but userSigner is null! Decryption will fail.",
    );
  }

  // Emit trigger - the subscription at module level handles this imperatively
  syncDerivedPnsTrigger$.next();
}
const relayUrlsDefined$ = relayUrls$.pipe(
  filter((urls): urls is string[] => {
    return urls.length > 0;
  }),
  distinctUntilChanged(
    (prev, curr) =>
      prev.length === curr.length && prev.every((url, i) => url === curr[i]),
  ),
  shareReplay(1),
);

// Reactive PNS keys input - exported so it can be updated from ChatProvider
export const userPubkey$ = new BehaviorSubject<string | null>(null);
const userPubkeyDefined$ = userPubkey$.pipe(
  filter((pubkey): pubkey is string => {
    return pubkey !== null;
  }),
  distinctUntilChanged(),
  shareReplay(1),
);

// User's signer for encrypting/decrypting 1081 events - exported so it can be set from auth provider
interface UserSignerInfo {
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
const userSignerDefined$ = userSigner$.pipe(
  filter(
    (info): info is UserSignerInfo =>
      info !== null &&
      info.signer?.nip44?.encrypt !== undefined &&
      info.signer?.nip44?.decrypt !== undefined &&
      info.signer?.signEvent !== undefined,
  ),
  distinctUntilChanged((prev, curr) => prev.pubkey === curr.pubkey),
  shareReplay(1),
);

// Observable to collect derived PNS keys from decrypted 1081 events
// This accumulates PNS keys extracted from nsecs found in 1081 event content
export const derivedPnsKeys$ = new BehaviorSubject<Map<string, PnsKeys>>(
  new Map(),
);

// Subject to emit newly derived PNS keys
const newDerivedPnsKey$ = new Subject<PnsKeys>();

// Accumulate derived PNS keys in the BehaviorSubject
newDerivedPnsKey$
  .pipe(
    scan((acc, pnsKeys) => {
      const newMap = new Map(acc);
      // Use pubkey as the key to avoid duplicates
      newMap.set(pnsKeys.pnsKeypair.pubKey, pnsKeys);
      return newMap;
    }, new Map<string, PnsKeys>()),
  )
  .subscribe(derivedPnsKeys$);

/**
 * Interface for the decrypted 1081 event content
 */
interface Decrypted1081Content {
  nsec?: string;
  salt?: string;
  // Add other fields that might be in the decrypted content
  [key: string]: unknown;
}

/**
 * Decrypts a 1081 event content using NIP-44 via the user's signer and extracts nsec
 * @param event The 1081 event to decrypt
 * @param signerInfo The user's signer info for decryption
 * @returns The decrypted content or null if decryption fails
 */
async function decrypt1081Event(
  event: NostrEvent,
  signerInfo: UserSignerInfo,
): Promise<Decrypted1081Content | null> {
  try {
    // Use the signer's NIP-44 decrypt method - decrypt with our own pubkey for self-encrypted content
    const plaintext = await signerInfo.signer.nip44.decrypt(
      signerInfo.pubkey,
      event.content,
    );

    // Parse as JSON
    const content = JSON.parse(plaintext) as Decrypted1081Content;

    // Remove salt property if it's an empty string
    if (content.salt === "") {
      delete content.salt;
    }

    debugLog("[useChatSync1081] Decrypted 1081 event content:", event.id);
    return content;
  } catch (error) {
    console.error(
      "[useChatSync1081] Failed to decrypt 1081 event:",
      event.id,
      error,
    );
    return null;
  }
}

/**
 * Extracts nsec from decrypted content and derives PNS keys
 * @param content The decrypted 1081 event content
 * @returns PnsKeys if nsec was found and derived successfully, null otherwise
 */
function extractAndDerivePnsKeys(
  content: Decrypted1081Content,
): PnsKeys | null {
  if (!content.nsec || typeof content.nsec !== "string") {
    debugLog("[useChatSync1081] No nsec found in decrypted content");
    return null;
  }

  // Decode the nsec to get the private key bytes
  const deviceKey = decodePrivateKey(content.nsec);
  if (!deviceKey) {
    console.error("[useChatSync1081] Failed to decode nsec from content");
    return null;
  }

  // Derive PNS keys from the device key
  // content.salt might be undefined if it was removed due to being an empty string
  const pnsKeys = derivePnsKeys(deviceKey, content.salt);
  return pnsKeys;
}

/**
 * Creates and publishes an initial 1081 event with a new nsec
 * This is called when EOSE is reached and no 1081 events exist for the user
 */
async function createAndPublishInitial1081Event(
  signerInfo: UserSignerInfo,
  relayUrls: string[],
): Promise<NostrEvent | null> {
  try {
    debugLog(
      "[useChatSync1081] No 1081 events found, creating initial event...",
    );

    // Generate new private key
    const privateKey = generateSecretKey();
    const nsec = nip19.nsecEncode(privateKey);

    // Create content with nsec and empty salt
    const contentObj: Decrypted1081Content = {
      nsec: nsec,
      salt: "",
    };
    const contentJson = JSON.stringify(contentObj);

    // Encrypt with user's own pubkey (self-encryption)
    const encrypted = await signerInfo.signer.nip44.encrypt(
      signerInfo.pubkey,
      contentJson,
    );

    // Create and sign the event
    const eventTemplate = {
      kind: 1081,
      created_at: Math.floor(Date.now() / 1000),
      tags: [] as string[][],
      content: encrypted,
    };

    const signedEvent = await signerInfo.signer.signEvent(eventTemplate);
    debugLog("[useChatSync1081] Created initial 1081 event:", signedEvent.id);

    // Publish to relays
    await relayPool.publish(relayUrls, signedEvent);
    debugLog(
      "[useChatSync1081] Published initial 1081 event to relays:",
      relayUrls,
    );

    // Add to event store
    eventStore.add(signedEvent);

    // Also derive and emit PNS keys from the new nsec
    const pnsKeys = extractAndDerivePnsKeys(contentObj);
    if (pnsKeys) {
      newDerivedPnsKey$.next(pnsKeys);
      debugLog(
        "[useChatSync1081] Added derived PNS key for new nsec:",
        pnsKeys.pnsKeypair.pubKey,
      );
    }

    return signedEvent;
  } catch (error) {
    console.error(
      "[useChatSync1081] Failed to create initial 1081 event:",
      error,
    );
    return null;
  }
}

// Track sync statistics
const syncStats1081 = {
  eventsReceived: 0,
  lastSyncTime: null as Date | null,
};

// Subject to trigger processing of stored 1081 events
const eventsReceived$ = new BehaviorSubject<number>(0);

// Function to manually trigger processing of stored 1081 events
export function triggerProcessStored1081Events() {
  debugLog(
    "[useChatSync1081] Manually triggering stored 1081 events processing",
  );
  eventsReceived$.next(syncStats1081.eventsReceived + 1); // Increment to ensure emission
}

const sync1081Event$ = combineLatest([
  userPubkeyDefined$,
  relayUrlsDefined$,
  userSignerDefined$,
]).pipe(
  switchMap(([userPubkey, relayUrls, signerInfo]) => {
    // Reset sync stats for new sync
    syncStats1081.eventsReceived = 0;
    syncStats1081.lastSyncTime = new Date();
    eventsReceived$.next(0);

    // Create the kind 1081 filter for this user's events
    const kind1081Filter = {
      kinds: [1081],
      authors: [userPubkey],
    };
    debugLog(
      "[useChatSync1081] Syncing with relays:",
      relayUrls,
      "user.pub",
      userPubkey,
      "user.sign",
      signerInfo,
    );

    // Use relayPool.subscription to get events from relays
    return relayPool.subscription(relayUrls, kind1081Filter).pipe(
      // Check for EOSE signal and handle initial 1081 creation if needed
      // Cast to unknown first since sync may emit "EOSE" at runtime even if not typed
      mergeMap((value: unknown) => {
        if (value === "EOSE") {
          debugLog("[useChatSync1081] EOSE REACHED");

          // Check if we have any 1081 events from this user in the event store
          const eventDatabase = useEventDatabase.getState();
          const existing1081Events = eventDatabase.getByFilters({
            kinds: [1081],
            authors: [userPubkey],
          });

          debugLog(
            "[useChatSync1081] Existing 1081 events after EOSE:",
            existing1081Events.length,
          );

          // If no 1081 events exist, create and publish initial one
          if (existing1081Events.length === 0) {
            return from(
              createAndPublishInitial1081Event(signerInfo, relayUrls),
            ).pipe(
              filter((event): event is NostrEvent => event !== null),
              catchError((err) => {
                console.error(
                  "[useChatSync1081] Error creating initial 1081 event:",
                  err,
                );
                return EMPTY;
              }),
            );
          }

          // EOSE received but events exist, return empty
          return EMPTY;
        }
        // Return the value wrapped in from() for non-EOSE values
        return from([value]);
      }),
      // Only process actual events, not EOSE signal (already filtered above, but double check)
      filter(
        (value): value is NostrEvent =>
          typeof value === "object" && value !== null && "id" in value,
      ),
      tap((event: NostrEvent) => {
        syncStats1081.eventsReceived++;
        debugLog(
          "[useChatSync1081] Synced 1081 event:",
          event.id,
          "Total:",
          syncStats1081.eventsReceived,
          eventStore.hasEvent(event.id),
        );
        eventStore.add(event);
        eventsReceived$.next(syncStats1081.eventsReceived);
      }),
      // Handle EmptyError when sync completes with no events to sync
      // This happens when there are no events matching the filter on any relay
      catchError((err) => {
        debugLog("[useChatSync1081] Sync error:", err);
        // EmptyError is thrown when firstValueFrom receives no emissions
        if (err.name === "EmptyError") {
          debugLog("[useChatSync1081] Sync complete - no events to sync");
          return EMPTY;
        }
        // Re-throw other errors
        throw err;
      }),
    );
  }),
  shareReplay(1),
);

// Set to track processed 1081 event IDs to avoid re-processing
const processed1081EventIds = new Set<string>();

// Observable that processes 1081 events from the store when new ones are received
const processStored1081Events$ = combineLatest([
  eventsReceived$,
  userSignerDefined$,
  userPubkeyDefined$,
]).pipe(
  tap(([count, signer, pubkey]) => {
    debugLog("[useChatSync1081] processStored1081Events$ input update:", {
      count,
      hasSigner: !!signer,
      pubkey,
    });
  }),
  filter(([count]) => count > 0),
  switchMap(([_, signerInfo, userPubkey]) => {
    // Read all 1081 events for this user from the store
    const events = eventStore.getByFilters({
      kinds: [1081],
      authors: [userPubkey],
    });

    // Filter out already processed events
    const newEvents = events.filter(
      (event) => !processed1081EventIds.has(event.id),
    );

    if (newEvents.length === 0) {
      return EMPTY;
    }

    debugLog(
      "[useChatSync1081] Processing new stored 1081 events:",
      newEvents.length,
    );

    return from(newEvents).pipe(
      mergeMap((event) => {
        // Mark as processed immediately to avoid race conditions if re-triggered quickly
        processed1081EventIds.add(event.id);
        return from(decrypt1081Event(event, signerInfo)).pipe(
          map((decryptedContent) => ({ event, decryptedContent })),
        );
      }),
      tap(({ event, decryptedContent }) => {
        if (decryptedContent) {
          // Derive PNS keys from the nsec
          const pnsKeys = extractAndDerivePnsKeys(decryptedContent);
          if (pnsKeys) {
            // Emit the newly derived PNS keys
            newDerivedPnsKey$.next(pnsKeys);
            debugLog(
              "[useChatSync1081] Added derived PNS key to observable:",
              pnsKeys.pnsKeypair.pubKey,
            );
          }
        }
      }),
      catchError((err) => {
        console.error("[useChatSync1081] Error processing stored events:", err);
        return EMPTY;
      }),
    );
  }),
  share(),
);

// Observable that emits array of all derived PNS pubkeys for syncing
export const derivedPnsPubkeys$ = derivedPnsKeys$.pipe(
  map((keysMap) => Array.from(keysMap.keys())),
  distinctUntilChanged(
    (prev, curr) =>
      prev.length === curr.length && prev.every((key, i) => key === curr[i]),
  ),
  shareReplay(1),
);

// Track sync statistics for derived PNS events
const syncStatsDerivedPns = {
  eventsReceived: 0,
  lastSyncTime: null as Date | null,
};

// Subject to emit sync results - allows imperative triggering of new sync subscriptions
const syncDerivedPnsResults$ = new Subject<NostrEvent>();

// Imperative function to perform derived PNS sync - creates a fresh subscription each time
function performDerivedPnsSync(pubkeys: string[], relayUrls: string[]): void {
  if (pubkeys.length === 0 || relayUrls.length === 0) {
    debugLog(
      "[useChatSync1081] performDerivedPnsSync: skipping, no pubkeys or relays",
    );
    return;
  }

  // Reset sync stats for new sync
  syncStatsDerivedPns.eventsReceived = 0;
  syncStatsDerivedPns.lastSyncTime = new Date();

  // Create filter for all derived PNS pubkeys
  const kind1080Filter = {
    kinds: [KIND_PNS],
    authors: pubkeys,
  };

  debugLog(
    "[useChatSync1081] Syncing derived PNS events for pubkeys:",
    pubkeys,
  );

  // Create fresh subscription for each sync - this won't be affected by previous completions
  relayPool
    .sync(relayUrls, eventStore, kind1080Filter, SyncDirection.BOTH)
    .pipe(
      tap((event: NostrEvent) => {
        syncStatsDerivedPns.eventsReceived++;
        debugLog(
          "[useChatSync1081] Synced derived PNS event:",
          event.id,
          "from:",
          event.pubkey.slice(0, 8),
        );
        eventStore.add(event);
      }),
      catchError((err: any) => {
        // Handle EmptyError which can happen when sync completes with no events
        if (
          err?.name === "EmptyError" ||
          err?.message === "no elements in sequence"
        ) {
          debugLog(
            "[useChatSync1081] Derived PNS sync complete - no events to sync",
          );
          return EMPTY;
        }
        console.error("[useChatSync1081] Derived PNS sync error:", err);
        return EMPTY;
      }),
    )
    .subscribe({
      next: (event) => syncDerivedPnsResults$.next(event),
      error: (err) =>
        console.error("[useChatSync1081] performDerivedPnsSync error:", err),
      complete: () =>
        debugLog("[useChatSync1081] performDerivedPnsSync complete"),
    });
}

// Auto-sync when pubkeys/relays become available (initial sync)
const autoSyncDerivedPns$ = combineLatest([
  derivedPnsPubkeys$,
  relayUrlsDefined$,
]).pipe(
  filter(([pubkeys, _]) => pubkeys.length > 0),
  take(1), // Only auto-sync once on initial load
  tap(([pubkeys, relayUrls]) => {
    debugLog("[useChatSync1081] Auto-triggering initial derived PNS sync");
    performDerivedPnsSync(pubkeys, relayUrls);
  }),
);

// Handle manual sync triggers - creates fresh sync each time
syncDerivedPnsTrigger$
  .pipe(
    tap(() => debugLog("[useChatSync1081] Manual sync trigger received")),
    withLatestFrom(relayUrls$),
    switchMap(([_, relayUrls]) => {
      return derivedPnsPubkeys$.pipe(
        take(1),
        tap((pubkeys) => {
          if (pubkeys.length === 0) {
            debugLog(
              "[useChatSync1081] No derived PNS keys, triggering stored events processing",
            );
            triggerProcessStored1081Events();
          }
        }),
        switchMap((pubkeys) => {
          if (pubkeys.length === 0) {
            // Wait for keys to be derived
            return derivedPnsPubkeys$.pipe(
              filter((keys) => keys.length > 0),
              take(1),
              timeout({ first: 5000 }),
              catchError((err) => {
                debugWarn(
                  "[useChatSync1081] Timed out waiting for derived PNS keys:",
                  err,
                );
                return of([]);
              }),
            );
          }
          return of(pubkeys);
        }),
        tap((pubkeys) => {
          if (pubkeys.length > 0 && relayUrls.length > 0) {
            performDerivedPnsSync(pubkeys, relayUrls);
          } else {
            debugWarn(
              "[useChatSync1081] Cannot sync: pubkeys or relays missing",
              { pubkeys: pubkeys.length, relays: relayUrls.length },
            );
          }
        }),
      );
    }),
  )
  .subscribe(); // This subscription never completes since syncDerivedPnsTrigger$ is a Subject

// Expose results stream for components to subscribe to
const syncDerivedPnsEvents$ = syncDerivedPnsResults$.pipe(
  share(), // Use share() instead of shareReplay(1) to avoid caching completed state
);

// Sync kind 1080 events for all derived PNS pubkeys
const liveDerivedPnsEvents$ = combineLatest([
  derivedPnsPubkeys$,
  relayUrlsDefined$,
]).pipe(
  filter(([pubkeys, _]) => pubkeys.length > 0),
  switchMap(([pubkeys, relayUrls]) => {
    // Reset sync stats for new sync
    syncStatsDerivedPns.lastSyncTime = new Date();

    // Create filter for all derived PNS pubkeys
    const kind1080Filter = {
      kinds: [KIND_PNS],
      authors: pubkeys,
    };

    // debugLog('[useChatSync1081] Live derived PNS events for pubkeys:', pubkeys)

    return relayPool.subscription(relayUrls, kind1080Filter).pipe(
      onlyEvents(),
      tap((event: NostrEvent) => {
        syncStatsDerivedPns.eventsReceived++;
        // debugLog('[useChatSync1081] Live derived PNS event:', event.id, 'from:', event.pubkey.slice(0, 8))
        eventStore.add(event);
      }),
      defaultIfEmpty(null),
      catchError((err) => {
        console.error("[useChatSync1081] Live derived PNS sync error:", err);
        return EMPTY;
      }),
    );
  }),
  tap({
    error: (err) =>
      console.error(
        "[useChatSync1081] liveDerivedPnsEvents$ stream error:",
        err,
      ),
    complete: () =>
      debugLog("[useChatSync1081] liveDerivedPnsEvents$ stream completed"),
  }),
  retry(1),
  shareReplay(1),
);

export function useChatSync1081() {
  const { config } = useAppContext();
  const [derivedPnsEvents, setDerivedPnsEvents] = useState<NostrEvent[]>([]);
  const [currentDerivedPnsKeys, setCurrentDerivedPnsKeys] = useState<
    Map<string, PnsKeys>
  >(new Map());
  const [loading1081, setLoading1081] = useState(false);
  const [loadingDerivedPns, setLoadingDerivedPns] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPnsKeys, setCurrentPnsKeys] = useState<PnsKeys | null>(null);
  const syncCount1081Ref = useRef(0);
  const syncCountDerivedPnsRef = useRef(0);

  // Subscribe to derived PNS keys
  useEffect(() => {
    const sub = derivedPnsKeys$.subscribe(setCurrentDerivedPnsKeys);
    return () => sub.unsubscribe();
  }, []);

  // Subscribe to process stored 1081 events
  useEffect(() => {
    const sub = processStored1081Events$.subscribe();
    return () => sub.unsubscribe();
  }, []);

  // Subscribe to auto-sync on initial load
  useEffect(() => {
    const sub = autoSyncDerivedPns$.subscribe();
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    // Find the first PNS keys with SALT_PNS from currentDerivedPnsKeys
    const firstPnsKeysWithSalt = Array.from(
      currentDerivedPnsKeys.values(),
    ).find((pnsKeys) => pnsKeys.salt === SALT_PNS);
    setCurrentPnsKeys(firstPnsKeysWithSalt || null);
  }, [currentDerivedPnsKeys]);

  // Update relay URLs when config changes
  useEffect(() => {
    if (config.relayUrls.length > 0) {
      relayUrls$.next(config.relayUrls);
    }
  }, [config.relayUrls]);

  // Subscribe to sync events
  useEffect(() => {
    const sub = sync1081Event$.subscribe({
      next: (event) => {
        if (event) {
          syncCount1081Ref.current++;
        }
      },
      error: (err) => {
        console.error("[useChatSyncProMax] Sync error:", err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading1081(false);
      },
      complete: () => {
        debugLog(
          "[useChatSyncProMax] Sync complete. Total events:",
          syncCount1081Ref.current,
        );
        setLoading1081(false);
      },
    });

    return () => {
      sub.unsubscribe();
    };
  }, []);

  // Subscribe to derived PNS events sync
  useEffect(() => {
    debugLog("[useChatSync1081] Subscribing to syncDerivedPnsEvents$");
    setLoadingDerivedPns(true);
    syncCountDerivedPnsRef.current = 0;

    const sub = syncDerivedPnsEvents$.subscribe({
      next: (event) => {
        if (event) {
          syncCountDerivedPnsRef.current++;

          // Update derived PNS events array
          setDerivedPnsEvents((prev) => {
            // Avoid duplicates
            if (prev.some((e) => e.id === event.id)) {
              return prev;
            }
            // Add new event and sort by created_at descending
            const newEvents = [...prev, event].sort(
              (a, b) => b.created_at - a.created_at,
            );
            return newEvents;
          });
        }
        setLoadingDerivedPns(false);
      },
      error: (err) => {
        console.error("[useChatSync1081] Derived PNS sync error:", err);
        setError(err instanceof Error ? err.message : String(err));
        setLoadingDerivedPns(false);
      },
      complete: () => {
        debugLog(
          "[useChatSync1081] Derived PNS sync complete. Total events:",
          syncCountDerivedPnsRef.current,
        );
        setLoadingDerivedPns(false);
      },
    });

    return () => {
      sub.unsubscribe();
    };
  }, []);

  // Subscribe to kind 1080 live events and add them to synced events
  useEffect(() => {
    if (!loading1081) {
      const sub = liveDerivedPnsEvents$.subscribe({
        next: (event: NostrEvent | null) => {
          if (event) {
            syncCountDerivedPnsRef.current++;

            // Update derived PNS events array
            setDerivedPnsEvents((prev) => {
              // Avoid duplicates
              if (prev.some((e) => e.id === event.id)) {
                return prev;
              }
              // Add new event and sort by created_at descending
              const newEvents = [...prev, event].sort(
                (a, b) => b.created_at - a.created_at,
              );
              return newEvents;
            });
          }
        },
        error: (err: Error | unknown) => {
          console.error("[useChatSyncProMax] Live subscription error:", err);
          setError(err instanceof Error ? err.message : String(err));
        },
      });

      return () => {
        sub.unsubscribe();
      };
    }
  }, []);

  // Log derived PNS sync statistics
  useEffect(() => {
    if (currentDerivedPnsKeys.size !== 0)
      debugLog(
        "[useChatSync1081] Derived PNS events count:",
        derivedPnsEvents.length,
        "Pub keys:",
        currentDerivedPnsKeys.size,
        Date.now(),
      );
  }, [derivedPnsEvents, currentDerivedPnsKeys]);

  return {
    derivedPnsEvents,
    derivedPnsKeys: currentDerivedPnsKeys,
    loading1081,
    loadingDerivedPns,
    error,
    currentPnsKeys,
    triggerDerivedPnsSync,
    triggerProcessStored1081Events,
    syncStats1081: {
      eventsReceived: syncStats1081.eventsReceived,
      lastSyncTime: syncStats1081.lastSyncTime,
    },
    syncStatsDerivedPns: {
      eventsReceived: syncStatsDerivedPns.eventsReceived,
      lastSyncTime: syncStatsDerivedPns.lastSyncTime,
    },
  };
}
