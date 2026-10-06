import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  matchFilter,
  nip44,
  type Filter,
  type NostrEvent,
} from "nostr-tools";
import type { EventLog } from "../service";
import type { HistorySigner } from "../keyring";

/** An account's key and a signer over it, like applesauce's. */
export function person() {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const key = (peer: string) => nip44.v2.utils.getConversationKey(secret, peer);
  const signer: HistorySigner = {
    nip44: {
      encrypt: async (peer, text) => nip44.v2.encrypt(text, key(peer)),
      decrypt: async (peer, text) => nip44.v2.decrypt(text, key(peer)),
    },
    signEvent: async (template) => finalizeEvent(template, secret),
  };
  return { pubkey, signer };
}

/** This device's disk. `hold()` keeps the next writes pending until released. */
export function memoryLog(initial: NostrEvent[] = []) {
  const rows = new Map(initial.map((event) => [event.id, event]));
  let gate: Promise<void> | null = null;
  let failNext: Error | null = null;
  const log: EventLog & {
    rows: Map<string, NostrEvent>;
    hold(): () => void;
    failNextWrite(error: Error): void;
  } = {
    rows,
    query: async (filter: Filter) =>
      [...rows.values()].filter((event) => matchFilter(filter, event)),
    put: async (events) => {
      if (gate) await gate;
      if (failNext) {
        const error = failNext;
        failNext = null;
        throw error;
      }
      events.forEach((event) => rows.set(event.id, event));
    },
    remove: async (ids) => {
      ids.forEach((id) => rows.delete(id));
    },
    hold() {
      let release!: () => void;
      gate = new Promise((resolve) => (release = resolve));
      return () => {
        gate = null;
        release();
      };
    },
    failNextWrite(error) {
      failNext = error;
    },
  };
  return log;
}
