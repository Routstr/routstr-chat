/**
 * Config Observables - Reactive, decrypted config state
 *
 * Provides RxJS observables for each config type that automatically:
 * - Wait for EOSE before emitting
 * - Decrypt content using NIP-44
 * - Update when new events arrive
 */

import {
  combineLatest,
  filter,
  switchMap,
  map,
  from,
  of,
  shareReplay,
  distinctUntilChanged,
  startWith,
  tap,
} from "rxjs";
import type { Observable } from "rxjs";
import type { NostrEvent } from "nostr-tools";
import {
  userPubkeyDefined$,
  userSignerDefined$,
  wotPubkey$,
  type UserSignerInfo,
} from "./chatSyncInputs";
import {
  configSyncEose$,
  configEventReceived$,
  decryptEventContent,
  getConfigEvent,
} from "./genericConfigSync";
import type { ConfigTypeDefinition } from "./configRegistry";
import { CONFIG_TYPES } from "./configRegistry";

// Debug toggle
const DEBUG = false;
const log = (...args: unknown[]) =>
  DEBUG && console.log("[configObservables]", ...args);

// The account each decrypted copy was read for. The observables replay their
// last copy, which right after a switch is still the previous account's.
const owners = new WeakMap<object, string>();
export const configOwner = (copy: unknown): string | undefined =>
  copy !== null && typeof copy === "object" ? owners.get(copy) : undefined;

/**
 * Factory to create a decrypted config observable for any config type
 *
 * @param configDef - The config type definition
 * @returns An observable that emits decrypted config data
 */
export function createConfigObservable<T>(
  configDef: ConfigTypeDefinition<T>,
  options?: {
    wotPubkey$?: Observable<string>;
  }
): Observable<T> {
  const activePubkey$ = options?.wotPubkey$ ?? userPubkeyDefined$;

  // Create a trigger for when this specific config type receives an event
  const configUpdated$ = configEventReceived$.pipe(
    filter((event) => {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1];
      return event.kind === configDef.kind && dTag === configDef.dTag;
    }),
    startWith(null as NostrEvent | null) // Initial trigger
  );

  return combineLatest([
    userSignerDefined$,
    activePubkey$,
    configSyncEose$,
    configUpdated$,
  ]).pipe(
    // Wait for EOSE before attempting to read
    filter(([_signer, _pubkey, eose]) => eose),
    switchMap(([signerInfo, pubkey]) => {
      const readFor = tap((copy: T) => {
        if (copy !== null && typeof copy === "object") owners.set(copy, pubkey);
      });
      log(`Loading ${configDef.id} for pubkey:`, pubkey.slice(0, 8));

      // Get the event from the store
      const event = getConfigEvent(configDef.kind, pubkey, configDef.dTag);

      if (!event) {
        log(`No event found for ${configDef.id}, returning default`);
        return of(configDef.defaultValue).pipe(readFor);
      }

      log(`Found event for ${configDef.id}:`, event.id.slice(0, 8));

      if (configDef.encrypted) {
        // Decrypt and parse
        return from(decryptConfig(event, signerInfo, configDef)).pipe(readFor);
      }

      // Parse unencrypted content
      try {
        const parsed = JSON.parse(event.content);
        const validated = configDef.parseContent(parsed);
        return of(validated ?? configDef.defaultValue).pipe(readFor);
      } catch (err) {
        console.error(
          `[configObservables] Failed to parse ${configDef.id}:`,
          err
        );
        return of(configDef.defaultValue);
      }
    }),
    // another account's equal copy is still a new copy
    distinctUntilChanged(
      (prev, curr) =>
        configOwner(prev) === configOwner(curr) &&
        JSON.stringify(prev) === JSON.stringify(curr)
    ),
    shareReplay(1)
  );
}

/**
 * Active pubkey for reading config: WoT override (if present) or signed-in user pubkey.
 */
export const activeConfigPubkey$ = combineLatest([
  userPubkeyDefined$,
  wotPubkey$,
]).pipe(
  map(([userPubkey, wotPubkey]) => {
    const trimmed = wotPubkey?.trim();
    return trimmed ? trimmed : userPubkey;
  }),
  distinctUntilChanged(),
  shareReplay(1)
);

/**
 * Helper to decrypt and parse a config event
 */
async function decryptConfig<T>(
  event: NostrEvent,
  signerInfo: UserSignerInfo,
  configDef: ConfigTypeDefinition<T>
): Promise<T> {
  try {
    const decrypted = await decryptEventContent(event, signerInfo);
    const parsed = JSON.parse(decrypted);
    const validated = configDef.parseContent(parsed);

    if (validated === null) {
      log(`Validation failed for ${configDef.id}, returning default`);
      return configDef.defaultValue;
    }

    log(`Successfully decrypted ${configDef.id}`);
    return validated;
  } catch (err) {
    console.error(
      `[configObservables] Failed to decrypt ${configDef.id}:`,
      err
    );
    return configDef.defaultValue;
  }
}

// ============================================================================
// Pre-built observables for each config type
// ============================================================================

/**
 * Observable for API Keys config
 * Emits decrypted array of StoredApiKey
 */
export const apiKeys$ = createConfigObservable(CONFIG_TYPES.API_KEYS);

/**
 * Observable for Invoices config
 * Emits decrypted array of StoredInvoice
 */
export const invoices$ = createConfigObservable(CONFIG_TYPES.INVOICES);

/**
 * Observable for Invoices config
 * Emits decrypted array of StoredInvoice
 */
export const theme$ = createConfigObservable(CONFIG_TYPES.THEME);

// ============================================================================
// Loading state observables
// ============================================================================

/**
 * Observable that emits true while config sync is loading (before EOSE)
 */
export const configSyncLoading$ = configSyncEose$.pipe(
  map((eose) => !eose),
  distinctUntilChanged(),
  shareReplay(1)
);

/**
 * Observable that emits true when config sync is ready (after EOSE with valid signer)
 */
export const configSyncReady$ = combineLatest([
  configSyncEose$,
  userSignerDefined$,
]).pipe(
  map(([eose, signer]) => eose && !!signer),
  distinctUntilChanged(),
  shareReplay(1)
);
