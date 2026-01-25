import {
  Subject,
  catchError,
  combineLatest,
  defaultIfEmpty,
  EMPTY,
  filter,
  of,
  retry,
  share,
  shareReplay,
  switchMap,
  take,
  tap,
  timeout,
  withLatestFrom,
  type Observable,
} from "rxjs";
import type { NostrEvent } from "nostr-tools";
import { KIND_PNS } from "@/lib/pns";
import { eventStore, relayPool } from "@/lib/applesauce-core";
import { onlyEvents, SyncDirection } from "applesauce-relay";

// Debug toggle - set to false to disable console logs
const ENABLE_DEBUG_LOGS = false;
const debugLog = (...args: any[]) => {
  if (ENABLE_DEBUG_LOGS) console.log(...args);
};
const debugWarn = (...args: any[]) => {
  if (ENABLE_DEBUG_LOGS) console.warn(...args);
};

export const syncStatsDerivedPns = {
  eventsReceived: 0,
  lastSyncTime: null as Date | null,
};

export interface Create1080PnsSyncDeps {
  derivedPubkeys$: Observable<string[]>;
  /** Raw relay urls (can be empty). Used for manual trigger semantics. */
  relayUrls$: Observable<string[]>;
  /** Relay urls that are known to be non-empty. Used for auto/live subscriptions. */
  relayUrlsDefined$: Observable<string[]>;

  /** Used only for debug warnings in [`triggerDerivedPnsSync()`](hooks/useChatSync1081.ts:1). */
  getCurrentRelayUrls: () => string[];
  /** Optional: used only for debug warnings. */
  getCurrentSigner: () => unknown;
  /** Optional: called when a manual sync is requested but we have no derived pubkeys yet. */
  ensureDerivedKeys?: () => void;
}

export interface Create1080PnsSyncResult {
  syncDerivedPnsTrigger$: Subject<void>;
  triggerDerivedPnsSync: () => void;

  autoSyncDerivedPns$: Observable<unknown>;
  syncDerivedPnsEvents$: Observable<NostrEvent>;
  liveDerivedPnsEvents$: Observable<NostrEvent | null>;
}

function performDerivedPnsSync(
  pubkeys: string[],
  relayUrls: string[]
): Subject<NostrEvent> {
  const results$ = new Subject<NostrEvent>();

  if (pubkeys.length === 0 || relayUrls.length === 0) {
    debugLog("[sync1080Pns] performDerivedPnsSync: skipping, no pubkeys or relays");
    return results$;
  }

  syncStatsDerivedPns.eventsReceived = 0;
  syncStatsDerivedPns.lastSyncTime = new Date();

  const kind1080Filter = { kinds: [KIND_PNS], authors: pubkeys };

  relayPool
    .sync(relayUrls, eventStore, kind1080Filter, SyncDirection.BOTH)
    .pipe(
      tap((event: NostrEvent) => {
        syncStatsDerivedPns.eventsReceived++;
        eventStore.add(event);
        results$.next(event);
      }),
      catchError((err: any) => {
        if (err?.name === "EmptyError" || err?.message === "no elements in sequence") {
          debugLog("[sync1080Pns] Derived PNS sync complete - no events to sync");
          return EMPTY;
        }
        console.error("[sync1080Pns] Derived PNS sync error:", err);
        return EMPTY;
      })
    )
    .subscribe({
      error: (err) => console.error("[sync1080Pns] performDerivedPnsSync error:", err),
      complete: () => {
        debugLog("[sync1080Pns] performDerivedPnsSync complete");
        results$.complete();
      },
    });

  return results$;
}

export function create1080PnsSync(deps: Create1080PnsSyncDeps): Create1080PnsSyncResult {
  const syncDerivedPnsTrigger$ = new Subject<void>();
  const syncDerivedPnsResults$ = new Subject<NostrEvent>();

  const triggerDerivedPnsSync = () => {
    const relays = deps.getCurrentRelayUrls();
    const signer = deps.getCurrentSigner();

    debugLog("[sync1080Pns] Manual derived PNS sync triggered");

    if (relays.length === 0) {
      debugWarn(
        "[sync1080Pns] Triggered sync but relayUrls is empty! Sync will not proceed to network."
      );
    }

    if (!signer) {
      debugWarn(
        "[sync1080Pns] Triggered sync but signer is null! (warning only; 1080 sync does not decrypt)"
      );
    }

    syncDerivedPnsTrigger$.next();
  };

  // Auto-sync once when pubkeys + relays become available.
  const autoSyncDerivedPns$ = combineLatest([deps.derivedPubkeys$, deps.relayUrlsDefined$]).pipe(
    filter(([pubkeys]) => pubkeys.length > 0),
    take(1),
    tap(([pubkeys, relayUrls]) => {
      debugLog("[sync1080Pns] Auto-triggering initial derived PNS sync");
      const results$ = performDerivedPnsSync(pubkeys, relayUrls);
      results$.subscribe((event) => syncDerivedPnsResults$.next(event));
    })
  );

  // Manual sync triggers: wait for derived pubkeys (bounded) if needed.
  syncDerivedPnsTrigger$
    .pipe(
      // IMPORTANT: use raw relayUrls$ so a manual trigger isn't dropped before relays are set.
      // We still validate length before syncing.
      withLatestFrom(deps.relayUrls$),
      switchMap(([_, relayUrls]) =>
        deps.derivedPubkeys$.pipe(
          take(1),
          tap((pubkeys) => {
            if (pubkeys.length === 0) deps.ensureDerivedKeys?.();
          }),
          switchMap((pubkeys) => {
            if (pubkeys.length > 0) return of(pubkeys);

            return deps.derivedPubkeys$.pipe(
              filter((keys) => keys.length > 0),
              take(1),
              timeout({ first: 5000 }),
              catchError((err) => {
                debugWarn("[sync1080Pns] Timed out waiting for derived pubkeys:", err);
                return of([] as string[]);
              })
            );
          }),
          tap((pubkeys) => {
            if (pubkeys.length > 0 && relayUrls.length > 0) {
              const results$ = performDerivedPnsSync(pubkeys, relayUrls);
              results$.subscribe((event) => syncDerivedPnsResults$.next(event));
            } else {
              debugWarn("[sync1080Pns] Cannot sync: pubkeys or relays missing", {
                pubkeys: pubkeys.length,
                relays: relayUrls.length,
              });
            }
          })
        )
      )
    )
    .subscribe();

  const syncDerivedPnsEvents$ = syncDerivedPnsResults$.pipe(share());

  const liveDerivedPnsEvents$ = combineLatest([deps.derivedPubkeys$, deps.relayUrlsDefined$]).pipe(
    filter(([pubkeys]) => pubkeys.length > 0),
    switchMap(([pubkeys, relayUrls]) => {
      syncStatsDerivedPns.lastSyncTime = new Date();

      const kind1080Filter = { kinds: [KIND_PNS], authors: pubkeys };
      return relayPool.subscription(relayUrls, kind1080Filter).pipe(
        onlyEvents(),
        tap((event: NostrEvent) => {
          syncStatsDerivedPns.eventsReceived++;
          eventStore.add(event);
        }),
        defaultIfEmpty(null),
        catchError((err) => {
          console.error("[sync1080Pns] Live derived PNS sync error:", err);
          return EMPTY;
        })
      );
    }),
    retry(1),
    shareReplay(1)
  );

  return {
    syncDerivedPnsTrigger$,
    triggerDerivedPnsSync,
    autoSyncDerivedPns$,
    syncDerivedPnsEvents$,
    liveDerivedPnsEvents$,
  };
}
