import { RelayPool, completeOnEose, onlyEvents, type Relay } from "applesauce-relay";
import { normalizeURL } from "applesauce-core/helpers/url";
import { nip77, type Filter, type NostrEvent } from "nostr-tools";
import { endWith, map, type Subscription } from "rxjs";
import type { RelayPort } from "@/features/relays/ports";

/** The app's relay pool. applesauce answers a silent relay with a made-up
 *  EOSE after `eoseTimeout`; ours is longer than the relay layer's own 10 s
 *  wait, so a relay that never answers counts as failed, never as "has none". */
export const newRelayPool = () => new RelayPool({ eoseTimeout: 20_000 });

/** The relay layer's port, over applesauce's pool. */
export const poolPort = (pool: RelayPool): RelayPort => ({
  // Only the relay's own EOSE means "that is all": applesauce also ends a
  // request quietly when the socket closes, which must count as a failure.
  request: (url, filter) =>
    pool
      .relay(url)
      .req(filter)
      .pipe(
        endWith(null),
        map((message) => {
          if (message === null)
            throw new Error(`${url} closed before it answered`);
          return message;
        }),
        completeOnEose()
      ),
  subscribe: (urls, filter) =>
    pool.subscription(urls, filter).pipe(onlyEvents()),
  publish: async (url, event) => (await pool.relay(url).publish(event)).ok,
  // read without opening one (relay() would make it, and a fresh one is not
  // connected yet): bad only once it tried and failed, until then connecting
  status: (url) => {
    const relay = pool.relays.get(normalizeURL(url));
    if (!relay) return "idle";
    if (relay.connected) return "ok";
    return relay.error$.value || relay.attempts$.value > 0 ? "bad" : "wait";
  },
  // NIP-77 when the relay's NIP-11 document lists it (applesauce caches that)
  reconcile: async (url, filter, local, signal) => {
    const relay = pool.relay(url);
    if (!(await relay.getSupported())?.includes(77)) return null;
    return negentropy(relay, filter, local, signal);
  },
});

// nostr-tools' NIP-77 over the relay's socket, answering each round until
// nothing is left to ask. (applesauce-relay 5.2's own loop never sends its
// next message, so a sync that needs a second round stalls.)
function negentropy(
  relay: Relay,
  filter: Filter,
  local: NostrEvent[],
  signal: AbortSignal
): Promise<{ have: string[]; need: string[] }> {
  const storage = new nip77.NegentropyStorageVector();
  local.forEach((event) => storage.insert(event.created_at, event.id));
  storage.seal();
  const sync = new nip77.Negentropy(storage);
  const id = crypto.randomUUID();
  const have: string[] = [];
  const need: string[] = [];
  return new Promise((resolve, reject) => {
    let subscription: Subscription | undefined;
    let done = false;
    const stop = (error?: unknown) => {
      if (done) return;
      done = true;
      subscription?.unsubscribe();
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve({ have, need });
    };
    const onAbort = () => stop(new Error(`${relay.url} did not finish NIP-77 in time`));
    signal.addEventListener("abort", onAbort);
    subscription = relay
      .multiplex<unknown[]>(
        () => ["NEG-OPEN", id, filter, sync.initiate()],
        () => ["NEG-CLOSE", id],
        (message: unknown[]) =>
          (message[0] === "NEG-MSG" || message[0] === "NEG-ERR") && message[1] === id
      )
      .subscribe({
        next: ([type, , payload]) => {
          if (type === "NEG-ERR") return stop(new Error(`${relay.url}: ${payload}`));
          try {
            const next = sync.reconcile(
              String(payload),
              (theyLack) => have.push(theyLack),
              (weLack) => need.push(weLack)
            );
            if (next) relay.send(["NEG-MSG", id, next]);
            else stop();
          } catch (error) {
            stop(error);
          }
        },
        error: stop,
        complete: () => stop(new Error(`${relay.url} closed before NIP-77 finished`)),
      });
  });
}
