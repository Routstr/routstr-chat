import { RELAY_LIST_KEY, Relays } from "@/features/relays/service";
import { newRelayPool, poolPort } from "@/platform/nostr/pool";

/* Nostr for this tab: one relay pool for every feature and account. */

const browser = typeof window !== "undefined";
// the static build renders once without a browser: nothing is stored then
const storage: Pick<Storage, "getItem" | "setItem"> = browser
  ? window.localStorage
  : { getItem: () => null, setItem: () => {} };

/** The app's only relay pool. */
export const pool = newRelayPool();

export const relays = new Relays(
  poolPort(pool),
  storage,
  browser ? window.location.search : ""
);

if (browser) {
  // another tab changed the relay list: this one follows it
  window.addEventListener("storage", (event) => {
    if (event.key === RELAY_LIST_KEY) relays.deviceChanged();
  });
}
