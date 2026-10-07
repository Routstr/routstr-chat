/**
 * The spending history (NIP-60, kind 7376) synced into the event store,
 * applesauce pattern
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
  from,
  mergeMap,
} from "rxjs";
import { relayUrls$ } from "@/hooks/sync/chatSyncInputs";
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
export const historyEose$ = new BehaviorSubject<boolean>(false);

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

export const getCashuHistoryEvents = (pubkey: string) =>
  eventStore.getByFilters({
    kinds: [CASHU_EVENT_KINDS.HISTORY],
    authors: [pubkey],
  });
