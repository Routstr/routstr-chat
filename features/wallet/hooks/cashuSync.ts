/**
 * Cashu wallet sync using applesauce pattern
 * Compact, reactive event fetching for NIP-60 wallet events
 */
import {
  BehaviorSubject,
  combineLatest,
  filter,
  switchMap,
  tap,
  EMPTY,
  catchError,
  shareReplay,
  distinctUntilChanged,
  map,
  from,
  mergeMap,
  firstValueFrom,
  of,
  timeout,
} from "rxjs";
import { relayUrls$ } from "@/hooks/useChatSync1081";
import { eventStore, relayPool } from "@/lib/applesauce-core";
import { CASHU_EVENT_KINDS } from "@/lib/cashu";
import type { NostrEvent } from "nostr-tools";

// Debug toggle
const DEBUG = false;
const log = (...args: unknown[]) =>
  DEBUG && console.log("[cashuSync]", ...args);

// User pubkey for cashu sync
export const cashuUserPubkey$ = new BehaviorSubject<string | null>(null);

// Derive filtered streams
const pubkeyDefined$ = cashuUserPubkey$.pipe(
  filter((p): p is string => p !== null),
  distinctUntilChanged(),
  shareReplay(1)
);

const relaysDefined$ = relayUrls$.pipe(
  filter((urls): urls is string[] => urls.length > 0),
  distinctUntilChanged(
    (a, b) => a.length === b.length && a.every((u, i) => u === b[i])
  ),
  shareReplay(1)
);

// EOSE tracking
export const walletEose$ = new BehaviorSubject<boolean>(false);
export const tokensEose$ = new BehaviorSubject<boolean>(false);
export const historyEose$ = new BehaviorSubject<boolean>(false);

// Sync wallet events (kind 17375) - replaceable, fetch latest
export const syncCashuWallet$ = combineLatest([
  pubkeyDefined$,
  relaysDefined$,
]).pipe(
  tap(() => walletEose$.next(false)),
  switchMap(([pubkey, relays]) => {
    log("Syncing wallet for", pubkey.slice(0, 8), "on", relays.length, "relays");
    return relayPool
      .subscription(relays, {
        kinds: [CASHU_EVENT_KINDS.WALLET],
        authors: [pubkey],
        limit: 1,
      })
      .pipe(
        mergeMap((value: unknown) => {
          if (value === "EOSE") {
            log("Wallet EOSE");
            walletEose$.next(true);
            return EMPTY;
          }
          return from([value as NostrEvent]);
        }),
        filter(
          (e): e is NostrEvent =>
            typeof e === "object" && e !== null && "id" in e
        ),
        tap((e) => {
          log("Wallet event:", e.id.slice(0, 8));
          eventStore.add(e);
        }),
        catchError((err) => {
          console.error("[cashuSync] Wallet sync error:", err);
          walletEose$.next(true);
          return EMPTY;
        })
      );
  }),
  shareReplay(1)
);

// Sync token events (kind 7375)
export const syncCashuTokens$ = combineLatest([
  pubkeyDefined$,
  relaysDefined$,
]).pipe(
  tap(() => tokensEose$.next(false)),
  switchMap(([pubkey, relays]) => {
    log("Syncing tokens for", pubkey.slice(0, 8));
    return relayPool
      .subscription(relays, {
        kinds: [CASHU_EVENT_KINDS.TOKEN],
        authors: [pubkey],
        limit: 100,
      })
      .pipe(
        mergeMap((value: unknown) => {
          if (value === "EOSE") {
            log("Tokens EOSE");
            tokensEose$.next(true);
            return EMPTY;
          }
          return from([value as NostrEvent]);
        }),
        filter(
          (e): e is NostrEvent =>
            typeof e === "object" && e !== null && "id" in e
        ),
        tap((e) => {
          log("Token event:", e.id.slice(0, 8));
          eventStore.add(e);
        }),
        catchError((err) => {
          console.error("[cashuSync] Token sync error:", err);
          tokensEose$.next(true);
          return EMPTY;
        })
      );
  }),
  shareReplay(1)
);

// Sync history events (kind 7376) - append-only events
export const syncCashuHistory$ = combineLatest([
  pubkeyDefined$,
  relaysDefined$,
]).pipe(
  tap(() => historyEose$.next(false)),
  switchMap(([pubkey, relays]) => {
    log("Syncing history for", pubkey.slice(0, 8));
    return relayPool
      .subscription(relays, {
        kinds: [CASHU_EVENT_KINDS.HISTORY],
        authors: [pubkey],
        limit: 500,
      })
      .pipe(
        mergeMap((value: unknown) => {
          if (value === "EOSE") {
            log("History EOSE");
            historyEose$.next(true);
            return EMPTY;
          }
          return from([value as NostrEvent]);
        }),
        filter(
          (e): e is NostrEvent =>
            typeof e === "object" && e !== null && "id" in e
        ),
        tap((e) => {
          log("History event:", e.id.slice(0, 8));
          eventStore.add(e);
        }),
        catchError((err) => {
          console.error("[cashuSync] History sync error:", err);
          historyEose$.next(true);
          return EMPTY;
        })
      );
  }),
  shareReplay(1)
);

// Combined ready state
export const cashuSyncReady$ = combineLatest([
  walletEose$,
  tokensEose$,
  historyEose$,
]).pipe(
  map(([w, t, h]) => w && t && h),
  distinctUntilChanged(),
  shareReplay(1)
);

// Helper to get events from store
export const getCashuWalletEvents = (pubkey: string) =>
  eventStore.getByFilters({
    kinds: [CASHU_EVENT_KINDS.WALLET],
    authors: [pubkey],
  });

export const getCashuTokenEvents = (pubkey: string) =>
  eventStore.getByFilters({
    kinds: [CASHU_EVENT_KINDS.TOKEN],
    authors: [pubkey],
  });

export const getCashuHistoryEvents = (pubkey: string) =>
  eventStore.getByFilters({
    kinds: [CASHU_EVENT_KINDS.HISTORY],
    authors: [pubkey],
  });

// ============================================================================
// NutzapInfo fetching (external users - kind 10019)
// ============================================================================

// Cache for nutzap info events (keyed by pubkey)
const nutzapInfoCache = new Map<string, NostrEvent | null>();

/**
 * Fetch nutzap info for a pubkey using applesauce relayPool
 * Caches results in eventStore and local map
 */
export async function fetchNutzapInfo(
  pubkey: string,
  relays: string[]
): Promise<NostrEvent | null> {
  // Check cache first
  if (nutzapInfoCache.has(pubkey)) {
    log("NutzapInfo cache hit for", pubkey.slice(0, 8));
    return nutzapInfoCache.get(pubkey) ?? null;
  }

  // Check eventStore for replaceable event
  const cached = eventStore.getReplaceable(CASHU_EVENT_KINDS.ZAPINFO, pubkey);
  if (cached) {
    log("NutzapInfo eventStore hit for", pubkey.slice(0, 8));
    nutzapInfoCache.set(pubkey, cached);
    return cached;
  }

  log("Fetching NutzapInfo for", pubkey.slice(0, 8));

  try {
    // Subscribe and wait for first event or EOSE
    const event = await firstValueFrom(
      relayPool
        .subscription(relays, {
          kinds: [CASHU_EVENT_KINDS.ZAPINFO],
          authors: [pubkey],
          limit: 1,
        })
        .pipe(
          mergeMap((value: unknown) => {
            if (value === "EOSE") {
              // No event found
              return of(null);
            }
            return of(value as NostrEvent);
          }),
          filter(
            (e): e is NostrEvent | null =>
              e === null || (typeof e === "object" && e !== null && "id" in e)
          ),
          timeout(10000), // 10 second timeout
          catchError((err) => {
            console.error("[cashuSync] NutzapInfo fetch error:", err);
            return of(null);
          })
        )
    );

    // Cache result
    nutzapInfoCache.set(pubkey, event);
    if (event) {
      eventStore.add(event);
    }

    return event;
  } catch (err) {
    console.error("[cashuSync] NutzapInfo fetch failed:", err);
    nutzapInfoCache.set(pubkey, null);
    return null;
  }
}

// Helper to get nutzap info from cache/store
export function getNutzapInfoEvent(pubkey: string): NostrEvent | null {
  // Check in-memory cache first
  if (nutzapInfoCache.has(pubkey)) {
    return nutzapInfoCache.get(pubkey) ?? null;
  }
  // Check eventStore
  return eventStore.getReplaceable(CASHU_EVENT_KINDS.ZAPINFO, pubkey) ?? null;
}

// Clear nutzap cache (useful on logout)
export function clearNutzapInfoCache(): void {
  nutzapInfoCache.clear();
}
