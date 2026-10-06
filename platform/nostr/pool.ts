import { RelayPool, completeOnEose, onlyEvents } from "applesauce-relay";
import { endWith, map } from "rxjs";
import type { RelayPort } from "@/features/relays/service";

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
});
