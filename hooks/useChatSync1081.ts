import { useEffect, useRef, useState } from "react";
import type { NostrEvent } from "nostr-tools";
import { PnsKeys, SALT_PNS } from "@/lib/pns";
import { useAppContext } from "@/hooks/useAppContext";
import {
  chatSyncEnabled$,
  relayUrls$,
  relayUrlsDefined$,
  userPubkey$,
  userSigner$,
  updateChatSyncEnabled,
} from "./sync/chatSyncInputs";
import {
  derivedPnsKeys$,
  derivedPnsPubkeys$,
  processStored1081Events$,
  sync1081Event$,
  syncStats1081,
  triggerProcessStored1081Events,
} from "./sync/sync1081Keyring";
import {
  create1080PnsSync,
  syncStatsDerivedPns,
  type Create1080PnsSyncResult,
} from "./sync/sync1080Pns";

// Create the 1080 sync controller once at module init.
const pns1080: Create1080PnsSyncResult = create1080PnsSync({
  derivedPubkeys$: derivedPnsPubkeys$,
  relayUrls$,
  relayUrlsDefined$,
  getCurrentRelayUrls: () => relayUrls$.getValue(),
  getCurrentSigner: () => userSigner$.getValue(),
  ensureDerivedKeys: triggerProcessStored1081Events,
});

// Re-export the original trigger API + trigger subject.
export const syncDerivedPnsTrigger$ = pns1080.syncDerivedPnsTrigger$;
export const triggerDerivedPnsSync = pns1080.triggerDerivedPnsSync;

// Internal-only streams used by the hook.
const autoSyncDerivedPns$ = pns1080.autoSyncDerivedPns$;
const syncDerivedPnsEvents$ = pns1080.syncDerivedPnsEvents$;
const liveDerivedPnsEvents$ = pns1080.liveDerivedPnsEvents$;

// Keep original exports stable.
export {
  chatSyncEnabled$,
  updateChatSyncEnabled,
  relayUrls$,
  userPubkey$,
  userSigner$,
  derivedPnsKeys$,
  derivedPnsPubkeys$,
  triggerProcessStored1081Events,
  syncStats1081,
  syncStatsDerivedPns,
};

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
      currentDerivedPnsKeys.values()
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
        console.error("[useChatSync1081] 1081 sync error:", err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading1081(false);
      },
      complete: () => {
        // No-op: stream completion is not expected in normal operation.
        setLoading1081(false);
      },
    });

    return () => {
      sub.unsubscribe();
    };
  }, []);

  // Subscribe to derived PNS events sync
  useEffect(() => {
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
              (a, b) => b.created_at - a.created_at
            );
            return newEvents;
          });
        }
        setLoadingDerivedPns(false);
      },
      error: (err) => {
        console.error("[useChatSync1081] 1080 sync error:", err);
        setError(err instanceof Error ? err.message : String(err));
        setLoadingDerivedPns(false);
      },
      complete: () => {
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
                (a, b) => b.created_at - a.created_at
              );
              return newEvents;
            });
          }
        },
        error: (err: Error | unknown) => {
          console.error("[useChatSync1081] 1080 live subscription error:", err);
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
    // Intentionally quiet by default.
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
