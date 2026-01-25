import {
  BehaviorSubject,
  Subject,
  catchError,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  filter,
  from,
  map,
  mergeMap,
  scan,
  share,
  shareReplay,
  switchMap,
  tap,
} from "rxjs";
import { nip19, generateSecretKey } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { PnsKeys, derivePnsKeys } from "@/lib/pns";
import { decodePrivateKey } from "@/lib/nostr";
import { eventStore, relayPool } from "@/lib/applesauce-core";
import { useEventDatabase } from "@/lib/eventDatabase";
import {
  relayUrlsDefined$,
  userPubkeyDefined$,
  userSignerDefined$,
  type UserSignerInfo,
} from "./chatSyncInputs";

// Debug toggle - set to false to disable console logs
const ENABLE_DEBUG_LOGS = false;

const debugLog = (...args: any[]) => {
  if (ENABLE_DEBUG_LOGS) console.log(...args);
};

/**
 * Track sync statistics for kind-1081.
 * Exported so [`useChatSync1081()`](hooks/useChatSync1081.ts:1) can report it.
 */
export const syncStats1081 = {
  eventsReceived: 0,
  lastSyncTime: null as Date | null,
};

// Subject to trigger processing of stored 1081 events
const eventsReceived$ = new BehaviorSubject<number>(0);

// Function to manually trigger processing of stored 1081 events
export function triggerProcessStored1081Events() {
  debugLog(
    "[sync1081Keyring] Manually triggering stored 1081 events processing"
  );
  eventsReceived$.next(syncStats1081.eventsReceived + 1); // increment to ensure emission
}

/**
 * Observable to collect derived PNS keys from decrypted 1081 events.
 * This accumulates PNS keys extracted from nsecs found in 1081 event content.
 */
export const derivedPnsKeys$ = new BehaviorSubject<Map<string, PnsKeys>>(
  new Map()
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
    }, new Map<string, PnsKeys>())
  )
  .subscribe(derivedPnsKeys$);

/**
 * Observable that emits array of all derived PNS pubkeys for syncing kind-1080.
 */
export const derivedPnsPubkeys$ = derivedPnsKeys$.pipe(
  map((keysMap) => Array.from(keysMap.keys())),
  distinctUntilChanged(
    (prev, curr) =>
      prev.length === curr.length && prev.every((key, i) => key === curr[i])
  ),
  shareReplay(1)
);

/**
 * Interface for the decrypted 1081 event content.
 */
interface Decrypted1081Content {
  nsec?: string;
  salt?: string;
  [key: string]: unknown;
}

async function decrypt1081Event(
  event: NostrEvent,
  signerInfo: UserSignerInfo
): Promise<Decrypted1081Content | null> {
  try {
    // Decrypt with our own pubkey for self-encrypted content
    const plaintext = await signerInfo.signer.nip44.decrypt(
      signerInfo.pubkey,
      event.content
    );

    const content = JSON.parse(plaintext) as Decrypted1081Content;

    // Remove salt property if it's an empty string
    if (content.salt === "") {
      delete content.salt;
    }

    debugLog("[sync1081Keyring] Decrypted 1081 event content:", event.id);
    return content;
  } catch (error) {
    console.error("[sync1081Keyring] Failed to decrypt 1081 event:", event.id);
    return null;
  }
}

function extractAndDerivePnsKeys(content: Decrypted1081Content): PnsKeys | null {
  if (!content.nsec || typeof content.nsec !== "string") {
    debugLog("[sync1081Keyring] No nsec found in decrypted content");
    return null;
  }

  const deviceKey = decodePrivateKey(content.nsec);
  if (!deviceKey) {
    console.error("[sync1081Keyring] Failed to decode nsec from content");
    return null;
  }

  return derivePnsKeys(deviceKey, content.salt);
}

async function createAndPublishInitial1081Event(
  signerInfo: UserSignerInfo,
  relayUrls: string[]
): Promise<NostrEvent | null> {
  try {
    debugLog("[sync1081Keyring] No 1081 events found; creating initial event");

    // Generate new private key
    const privateKey = generateSecretKey();
    const nsec = nip19.nsecEncode(privateKey);

    // Create content with nsec and empty salt
    const contentObj: Decrypted1081Content = { nsec, salt: "" };
    const contentJson = JSON.stringify(contentObj);

    // Encrypt with user's own pubkey (self-encryption)
    const encrypted = await signerInfo.signer.nip44.encrypt(
      signerInfo.pubkey,
      contentJson
    );

    const eventTemplate = {
      kind: 1081,
      created_at: Math.floor(Date.now() / 1000),
      tags: [] as string[][],
      content: encrypted,
    };

    const signedEvent = await signerInfo.signer.signEvent(eventTemplate);
    debugLog("[sync1081Keyring] Created initial 1081 event:", signedEvent.id);

    await relayPool.publish(relayUrls, signedEvent);
    debugLog("[sync1081Keyring] Published initial 1081 event to relays", relayUrls);

    eventStore.add(signedEvent);

    // Also derive and emit PNS keys from the new nsec
    const pnsKeys = extractAndDerivePnsKeys(contentObj);
    if (pnsKeys) newDerivedPnsKey$.next(pnsKeys);

    return signedEvent;
  } catch (error) {
    console.error("[sync1081Keyring] Failed to create initial 1081 event:", error);
    return null;
  }
}

/**
 * Network sync for kind-1081 events. This only fetches/stores 1081 events.
 * Key derivation happens via [`processStored1081Events$`](hooks/sync/sync1081Keyring.ts:1).
 */
export const sync1081Event$ = combineLatest([
  userPubkeyDefined$,
  relayUrlsDefined$,
  userSignerDefined$,
]).pipe(
  switchMap(([userPubkey, relayUrls, signerInfo]) => {
    syncStats1081.eventsReceived = 0;
    syncStats1081.lastSyncTime = new Date();
    eventsReceived$.next(0);

    const kind1081Filter = { kinds: [1081], authors: [userPubkey] };
    debugLog("[sync1081Keyring] Syncing 1081 with relays:", relayUrls);

    return relayPool.subscription(relayUrls, kind1081Filter).pipe(
      mergeMap((value: unknown) => {
        if (value === "EOSE") {
          debugLog("[sync1081Keyring] EOSE reached");

          const eventDatabase = useEventDatabase.getState();
          const existing1081Events = eventDatabase.getByFilters({
            kinds: [1081],
            authors: [userPubkey],
          });

          if (existing1081Events.length === 0) {
            return from(createAndPublishInitial1081Event(signerInfo, relayUrls)).pipe(
              filter((event): event is NostrEvent => event !== null),
              catchError((err) => {
                console.error(
                  "[sync1081Keyring] Error creating initial 1081 event:",
                  err
                );
                return EMPTY;
              })
            );
          }

          return EMPTY;
        }

        return from([value]);
      }),
      filter(
        (value): value is NostrEvent =>
          typeof value === "object" && value !== null && "id" in value
      ),
      tap((event: NostrEvent) => {
        syncStats1081.eventsReceived++;
        eventStore.add(event);
        eventsReceived$.next(syncStats1081.eventsReceived);
      }),
      catchError((err) => {
        if (err?.name === "EmptyError") return EMPTY;
        throw err;
      })
    );
  }),
  shareReplay(1)
);

// Set to track processed 1081 event IDs to avoid re-processing
const processed1081EventIds = new Set<string>();

/**
 * Processes stored kind-1081 events (decrypt + derive PNS keys).
 * This is intentionally separate from the network sync above.
 */
export const processStored1081Events$ = combineLatest([
  eventsReceived$,
  userSignerDefined$,
  userPubkeyDefined$,
]).pipe(
  filter(([count]) => count > 0),
  switchMap(([_, signerInfo, userPubkey]) => {
    const events = eventStore.getByFilters({ kinds: [1081], authors: [userPubkey] });

    const newEvents = events.filter((event) => !processed1081EventIds.has(event.id));
    if (newEvents.length === 0) return EMPTY;

    return from(newEvents).pipe(
      mergeMap((event) => {
        processed1081EventIds.add(event.id);
        return from(decrypt1081Event(event, signerInfo)).pipe(
          map((decryptedContent) => ({ event, decryptedContent }))
        );
      }),
      tap(({ decryptedContent }) => {
        if (!decryptedContent) return;
        const pnsKeys = extractAndDerivePnsKeys(decryptedContent);
        if (pnsKeys) newDerivedPnsKey$.next(pnsKeys);
      }),
      catchError((err) => {
        console.error("[sync1081Keyring] Error processing stored events:", err);
        return EMPTY;
      })
    );
  }),
  share()
);
