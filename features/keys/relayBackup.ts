import { verifyEvent, type NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";
import type { Account } from "@/features/session/service";

/* An account's private app data on its relays: one replaceable event
   (kind 30078, a d tag), NIP-44 encrypted to itself. History's relay layer
   carries the events; the account encrypts and signs. */

/** What the relays hold: a value, none yet, or something we cannot read
 *  (then nothing is ever published over it). */
export type Remote<T> = T | "none" | "unreadable";

export interface BackupPorts<T> {
  /** Calls back with the newest copy, once every relay has answered. */
  watch(listener: (remote: Remote<T>) => void): () => void;
  publish(value: T): Promise<void>;
}

/** What this needs from history's `relays.of(owner)`. */
export interface BackupRelays {
  /** The account's own relays (NIP-65) are known, or the lookup gave up. */
  ready(): Promise<void>;
  watchLatest(filter: {
    kinds: number[];
    authors: string[];
    "#d": string[];
  }): Observable<{ event: NostrEvent | null; settled: boolean }>;
  publish(event: NostrEvent): Promise<string[]>;
}

export function relayBackupPorts<T>(
  relays: BackupRelays,
  account: Account,
  d: string,
  parse: (json: unknown) => T | "unreadable"
): BackupPorts<T> {
  const self = account.pubkey;
  const nip44 = () => {
    if (!account.nip44) throw new Error("This signer cannot encrypt");
    return account.nip44;
  };
  // relays keep the lower id when two copies share a second, so each newer
  // copy gets a later second
  let last = 0;
  return {
    watch(listener) {
      let latest: string | null | undefined;
      let stopped = false;
      let sub: { unsubscribe(): void } | undefined;
      // only once the account's own relays are known does "none" mean none
      void relays.ready().then(() => {
        if (stopped) return;
        sub = relays
          .watchLatest({ kinds: [30078], authors: [self], "#d": [d] })
          .subscribe(async ({ event, settled }) => {
            // before every relay has answered, a newer copy may still come
            if (!settled) return;
            const id = event?.id ?? null;
            if (id === latest) return;
            latest = id;
            if (!event) return listener("none");
            let remote: Remote<T>;
            try {
              if (event.pubkey !== self || !verifyEvent(event)) {
                throw new Error("not ours");
              }
              remote = parse(
                JSON.parse(await nip44().decrypt(self, event.content))
              );
            } catch {
              remote = "unreadable";
            }
            // a newer copy arrived while this one was being decrypted
            if (latest === id) listener(remote);
          });
      });
      return () => {
        stopped = true;
        sub?.unsubscribe();
      };
    },
    async publish(value) {
      const signed = await account.signEvent({
        kind: 30078,
        tags: [["d", d]],
        content: await nip44().encrypt(self, JSON.stringify(value)),
        created_at: (last = Math.max(Math.floor(Date.now() / 1000), last + 1)),
      });
      await relays.publish(signed);
    },
  };
}

const DEVICE_KEY = "routstr-chat-device-id";

/** This browser's id in the provider-key backup, same key as main. */
export function deviceId(
  storage: Pick<Storage, "getItem" | "setItem">
): string {
  let id = storage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    storage.setItem(DEVICE_KEY, id);
  }
  return id;
}
