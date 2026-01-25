/**
 * Generic Config Sync - Unified Nostr subscription for all config types
 *
 * Uses applesauce relayPool to fetch all config types in a single subscription.
 * Events are stored in eventStore for reactive access.
 */

import {
  BehaviorSubject,
  Subject,
  combineLatest,
  filter,
  switchMap,
  tap,
  EMPTY,
  catchError,
  shareReplay,
  distinctUntilChanged,
  mergeMap,
  from,
} from "rxjs";
import type { NostrEvent, Filter } from "nostr-tools";
import { eventStore, relayPool } from "@/lib/applesauce-core";
import {
  relayUrlsDefined$,
  userPubkeyDefined$,
  userSignerDefined$,
  type UserSignerInfo,
} from "./chatSyncInputs";
import { getAllConfigTypes, getConfigTypeByKindAndDTag } from "./configRegistry";

// Debug toggle
const DEBUG = false;
const log = (...args: unknown[]) =>
  DEBUG && console.log("[genericConfigSync]", ...args);

/**
 * Sync statistics for monitoring
 */
export const configSyncStats = {
  eventsReceived: 0,
  lastSyncTime: null as Date | null,
};

/**
 * EOSE tracking - emits true when initial sync is complete
 */
export const configSyncEose$ = new BehaviorSubject<boolean>(false);

/**
 * Subject for real-time event notifications
 * Emits events as they arrive from relays
 */
export const configEventReceived$ = new Subject<NostrEvent>();

/**
 * Build a combined filter that fetches ALL config types in one subscription
 *
 * Since all our config types use the same kind (30078), we combine them
 * into a single filter with all d-tags.
 */
function buildConfigFilter(userPubkey: string): Filter {
  const configs = getAllConfigTypes();

  // Collect all d-tags from all config types
  const allDTags: string[] = [];
  const allKinds = new Set<number>();

  configs.forEach((config) => {
    allDTags.push(config.dTag);
    allKinds.add(config.kind);
  });

  // Build a single filter with all kinds and d-tags
  const filter: Filter = {
    kinds: Array.from(allKinds),
    authors: [userPubkey],
    "#d": allDTags,
  };

  log("Built filter:", filter);
  return filter;
}

/**
 * Extract d-tag from a Nostr event
 */
function getDTag(event: NostrEvent): string | undefined {
  const dTag = event.tags.find((tag) => tag[0] === "d");
  return dTag?.[1];
}

/**
 * Route an incoming event to its appropriate handler
 * This allows listeners to react to specific config type updates
 */
function routeEventToHandler(event: NostrEvent): void {
  const dTag = getDTag(event);
  if (!dTag) {
    log("Event has no d-tag, skipping routing:", event.id);
    return;
  }

  const configType = getConfigTypeByKindAndDTag(event.kind, dTag);
  if (!configType) {
    log("Unknown config type for event:", event.kind, dTag);
    return;
  }

  log(`Routed event to ${configType.id}:`, event.id.slice(0, 8));
  // Emit to the global subject - specific observables will filter by config type
  configEventReceived$.next(event);
}

/**
 * Main unified subscription for all config types
 *
 * Features:
 * - Single subscription for all config types (efficient)
 * - Stores events in eventStore
 * - Tracks EOSE for loading state
 * - Routes events to per-config handlers
 */
export const genericConfigSync$ = combineLatest([
  userPubkeyDefined$,
  relayUrlsDefined$,
]).pipe(
  tap(() => {
    configSyncEose$.next(false);
    configSyncStats.eventsReceived = 0;
    configSyncStats.lastSyncTime = new Date();
    log("Starting config sync");
  }),
  switchMap(([pubkey, relays]) => {
    const configFilter = buildConfigFilter(pubkey);

    if (!configFilter.kinds || configFilter.kinds.length === 0) {
      log("No config types registered, skipping sync");
      configSyncEose$.next(true);
      return EMPTY;
    }

    log("Subscribing to relays:", relays, "with filter:", configFilter);

    // Single filter with all config types
    return relayPool.subscription(relays, configFilter).pipe(
      mergeMap((value: unknown) => {
        if (value === "EOSE") {
          log("EOSE received, initial sync complete");
          configSyncEose$.next(true);
          return EMPTY;
        }
        return from([value as NostrEvent]);
      }),
      filter(
        (e): e is NostrEvent =>
          typeof e === "object" && e !== null && "id" in e
      ),
      tap((event: NostrEvent) => {
        configSyncStats.eventsReceived++;
        log("Received event:", event.id.slice(0, 8), "kind:", event.kind);

        // Store in eventStore (handles replaceable event logic)
        eventStore.add(event);

        // Route to specific handlers
        routeEventToHandler(event);
      }),
      catchError((err) => {
        console.error("[genericConfigSync] Subscription error:", err);
        configSyncEose$.next(true); // Mark as complete even on error
        return EMPTY;
      })
    );
  }),
  shareReplay(1)
);

/**
 * Combined ready state - check if sync is complete and we have a signer
 */
export const configSyncReady$ = combineLatest([
  configSyncEose$,
  userSignerDefined$,
]).pipe(
  distinctUntilChanged(
    ([eose1, signer1], [eose2, signer2]) =>
      eose1 === eose2 && signer1?.pubkey === signer2?.pubkey
  ),
  shareReplay(1)
);

/**
 * Helper to decrypt event content using NIP-44
 */
export async function decryptEventContent(
  event: NostrEvent,
  signerInfo: UserSignerInfo
): Promise<string> {
  if (!signerInfo.signer.nip44) {
    throw new Error("NIP-44 encryption not supported by signer");
  }

  return signerInfo.signer.nip44.decrypt(signerInfo.pubkey, event.content);
}

/**
 * Get a config event from the event store
 */
export function getConfigEvent(
  kind: number,
  pubkey: string,
  dTag: string
): NostrEvent | undefined {
  return eventStore.getReplaceable(kind, pubkey, dTag);
}
