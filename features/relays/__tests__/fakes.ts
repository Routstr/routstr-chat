import { matchFilter, type NostrEvent } from "nostr-tools";
import { Observable, Subject, filter as where } from "rxjs";
import type { RelayPort } from "../service";

interface FakeRelay {
  events: Map<string, NostrEvent>;
  down: boolean;
  /** the most one answer holds, newest first, like strfry's 500 */
  cap?: number;
  /** a broken or hostile relay: answers with everything it holds */
  ignoresFilters?: boolean;
  received: NostrEvent[];
}

/** Relays in memory: what they store, whether they answer, what they were sent. */
export function network() {
  const relays = new Map<string, FakeRelay>();
  const feed = new Subject<{ url: string; event: NostrEvent }>();
  const relay = (url: string): FakeRelay => {
    let found = relays.get(url);
    if (!found) {
      found = { events: new Map(), down: false, received: [] };
      relays.set(url, found);
    }
    return found;
  };
  const port: RelayPort = {
    request: (url, filter) =>
      new Observable<NostrEvent>((observer) => {
        const r = relay(url);
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
export async function until(check: () => boolean, turns = 200): Promise<void> {
  for (let i = 0; i < turns; i++) {
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
