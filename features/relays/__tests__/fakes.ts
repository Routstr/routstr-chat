import { matchFilter, type Filter, type NostrEvent } from "nostr-tools";
import { Observable, Subject, filter as where } from "rxjs";
import type { RelayPort } from "../ports";

interface FakeRelay {
  events: Map<string, NostrEvent>;
  down: boolean;
  /** the most one answer holds, newest first, like strfry's 500 */
  cap?: number;
  /** a broken or hostile relay: answers with everything it holds */
  ignoresFilters?: boolean;
  /** does NIP-77; `syncFails` makes every sync fail, `syncHangs` never answer */
  nip77?: boolean;
  syncFails?: boolean;
  syncHangs?: boolean;
  received: NostrEvent[];
  /** every REQ filter it was asked */
  asked: Filter[];
}

/** Relays in memory: what they store, whether they answer, what they were sent. */
export function network() {
  const relays = new Map<string, FakeRelay>();
  const feed = new Subject<{ url: string; event: NostrEvent }>();
  const relay = (url: string): FakeRelay => {
    let found = relays.get(url);
    if (!found) {
      found = { events: new Map(), down: false, received: [], asked: [] };
      relays.set(url, found);
    }
    return found;
  };
  const port: RelayPort = {
    request: (url, filter) =>
      new Observable<NostrEvent>((observer) => {
        const r = relay(url);
        r.asked.push(filter);
        // answers after the caller subscribed, as a socket does
        queueMicrotask(() => {
          if (r.down) return observer.error(new Error(`${url} is down`));
          const matches = [...r.events.values()]
            .filter((event) => r.ignoresFilters || matchFilter(filter, event))
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, r.cap ?? Infinity);
          matches.forEach((event) => observer.next(event));
          observer.complete();
        });
      }),
    subscribe: (urls, filter) =>
      new Observable<NostrEvent>((observer) =>
        feed
          .pipe(
            where(
              ({ url, event }) =>
                urls.includes(url) &&
                !relay(url).down &&
                matchFilter(filter, event)
            )
          )
          .subscribe(({ event }) => observer.next(event))
      ),
    publish: async (url, event) => {
      const r = relay(url);
      if (r.down) return false;
      r.received.push(event);
      if (!r.events.has(event.id)) {
        r.events.set(event.id, event);
        feed.next({ url, event });
      }
      return true;
    },
    status: (url) =>
      relays.has(url) ? (relay(url).down ? "bad" : "ok") : "idle",
    reconcile: async (url, filter, local, signal) => {
      const r = relay(url);
      if (r.down) throw new Error(`${url} is down`);
      if (!r.nip77) return null;
      if (r.syncFails) throw new Error("NEG-ERR");
      if (r.syncHangs)
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("stopped")))
        );
      const ours = new Set(local.map((event) => event.id));
      return {
        have: local.filter((e) => !r.events.has(e.id)).map((e) => e.id),
        need: [...r.events.values()]
          .filter((e) => matchFilter(filter, e) && !ours.has(e.id))
          .map((e) => e.id),
      };
    },
  };
  return {
    port,
    relay,
    /** Another device publishing straight to a relay. */
    publishElsewhere(url: string, event: NostrEvent) {
      void port.publish(url, event);
    },
  };
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Waits until `check` holds, a few event-loop turns at a time. */
export async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await settle();
  }
  throw new Error("condition never held");
}

/** localStorage in memory. */
export function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
  };
}
