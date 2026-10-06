import { RELAY_LIST_KEY, Relays } from "@/features/relays/service";
import { HistoryService } from "@/features/history/service";
import type { Account } from "@/features/session/service";
import { openEventLog } from "@/platform/nostr/eventLog";
import { newRelayPool, poolPort } from "@/platform/nostr/pool";

/* Nostr for this tab: one relay pool, one event log, and the active
   account's history. */

const browser = typeof window !== "undefined";
// the static build renders once without a browser: nothing is stored then
const storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = browser
  ? window.localStorage
  : { getItem: () => null, setItem: () => {}, removeItem: () => {} };

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

// opens nothing until history first reads it, which only a browser does
const log = openEventLog(storage);

let current: { accountId: string; history: HistoryService } | null = null;
const listeners = new Set<() => void>();

/** Called by the composition root when the active account changes: the old
 *  account's history stops, and the new one's starts from this device's copy. */
export function bindHistory(account: Account | undefined): void {
  if (current?.accountId === account?.id) return;
  current?.history.dispose();
  current = account
    ? {
        accountId: account.id,
        history: new HistoryService({
          owner: account.pubkey,
          signer: account,
          log,
          relays: relays.of(account.pubkey),
          storage,
        }),
      }
    : null;
  current?.history.start();
  listeners.forEach((listener) => listener());
}

export const activeHistory = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: (): HistoryService | null => current?.history ?? null,
};
