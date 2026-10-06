import { RelayPool, completeOnEose, onlyEvents } from "applesauce-relay";
import { endWith, map } from "rxjs";
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
  // NIP-77 when the relay's NIP-11 document lists it (applesauce caches that)
  reconcile: async (url, filter, local, signal) => {
    const relay = pool.relay(url);
    if (!(await relay.getSupported())?.includes(77)) return null;
    const have: string[] = [];
    const need: string[] = [];
    const finished = await relay.negentropy(
      local,
      filter,
      async (theyLack, weLack) => {
        have.push(...theyLack);
        need.push(...weLack);
      },
      { signal }
    );
    if (!finished) throw new Error(`${url} did not finish NIP-77 in time`);
    return { have, need };
  },
});
