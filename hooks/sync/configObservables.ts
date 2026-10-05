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

/**
 * Result shape for callers that need to distinguish a real empty config from
 * an unreadable encrypted event.
 */
export type ConfigReadResult<T> =
  | { status: "ok"; value: T; event: NostrEvent }
  | { status: "none"; value: T; event: null }
  | { status: "error"; value: T; event: NostrEvent; error: unknown };

/**
 * Factory to create a decrypted config observable for any config type
 *
 * @param configDef - The config type definition
 * @returns An observable that emits decrypted config data with read status
 */
export function createConfigReadObservable<T>(
  configDef: ConfigTypeDefinition<T>,
  options?: {
    wotPubkey$?: Observable<string>;
  }
): Observable<ConfigReadResult<T>> {
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
      log(`Loading ${configDef.id} for pubkey:`, pubkey.slice(0, 8));

      // Get the event from the store
      const event = getConfigEvent(configDef.kind, pubkey, configDef.dTag);

      if (!event) {
        log(`No event found for ${configDef.id}, returning default`);
        return of({
          status: "none" as const,
          value: configDef.defaultValue,
          event: null,
        });
      }

      log(`Found event for ${configDef.id}:`, event.id.slice(0, 8));

      if (configDef.encrypted) {
        // Decrypt and parse
        return from(decryptConfig(event, signerInfo, configDef));
      }

      // Parse unencrypted content
      try {
        const parsed = JSON.parse(event.content);
        const validated = configDef.parseContent(parsed);
        if (validated === null) {
          return of({
            status: "error" as const,
            value: configDef.defaultValue,
            event,
            error: new Error(`Validation failed for ${configDef.id}`),
          });
        }

        return of({ status: "ok" as const, value: validated, event });
      } catch (err) {
        console.error(
          `[configObservables] Failed to parse ${configDef.id}:`,
          err
        );
        return of({
          status: "error" as const,
          value: configDef.defaultValue,
          event,
          error: err,
        });
      }
    }),
    distinctUntilChanged(
      (prev, curr) =>
        prev.status === curr.status &&
        prev.event?.id === curr.event?.id &&
        JSON.stringify(prev.value) === JSON.stringify(curr.value)
    ),
    shareReplay(1)
  );
}

/**
 * Factory to create a decrypted config observable for callers that only need
 * the value. Read errors intentionally fall back to the config default to
 * preserve the existing settings/invoice behavior.
 */
export function createConfigObservable<T>(
  configDef: ConfigTypeDefinition<T>,
  options?: {
    wotPubkey$?: Observable<string>;
  }
): Observable<T> {
  return createConfigReadObservable(configDef, options).pipe(
    map((result) => result.value)
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
): Promise<ConfigReadResult<T>> {
  try {
    const decrypted = await decryptEventContent(event, signerInfo);
    const parsed = JSON.parse(decrypted);
    const validated = configDef.parseContent(parsed);

    if (validated === null) {
      log(`Validation failed for ${configDef.id}, returning default`);
      return {
        status: "error",
        value: configDef.defaultValue,
        event,
        error: new Error(`Validation failed for ${configDef.id}`),
      };
    }

    log(`Successfully decrypted ${configDef.id}`);
    return { status: "ok", value: validated, event };
  } catch (err) {
    console.error(
      `[configObservables] Failed to decrypt ${configDef.id}:`,
      err
    );
    return {
      status: "error",
      value: configDef.defaultValue,
      event,
      error: err,
    };
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
 * Read result observable for SDK cached API keys config
 */
export const sdkApiKeysResult$ = createConfigReadObservable(
  CONFIG_TYPES.SDK_API_KEYS
);

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
