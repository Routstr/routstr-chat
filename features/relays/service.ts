import type { Filter, NostrEvent } from "nostr-tools";
import { getOutboxes } from "applesauce-core/helpers";
import {
  Observable,
  Subscription,
  lastValueFrom,
  timeout,
  toArray,
} from "rxjs";
import type { RelayPort } from "./ports";

export interface Fetched {
  events: NostrEvent[];
  /** The relays that answered; the others failed or stayed silent. */
  answered: string[];
}

export interface Latest {
  event: NostrEvent | null;
  /** Every relay has answered or failed, and at least one answered. */
  settled: boolean;
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

/** main's first three presets, used until the person edits the list. */
export const DEFAULT_RELAYS = [
  "wss://relay.routstr.com",
  "wss://nos.lol",
  "wss://relay.primal.net",
];
export const RELAY_LIST_KEY = "nostr:app-config";
const KIND_RELAY_LIST = 10002;
// the longest a relay may stay silent while it answers
const PAGE_MS = 10_000;
// relays judge `since` by the writer's clock, which can be behind ours
const LIVE_SLACK_S = 600;
const UPLOAD_BATCH = 10;
// a NIP-77 sync not done by then gives way to reading page by page
const RECONCILE_MS = 20_000;
const IDS_PER_REQUEST = 500;

const isRelayUrl = (url: unknown): url is string =>
  typeof url === "string" && /^wss?:\/\/[^\s]+$/i.test(url);

const unique = (urls: string[]) => [
  ...new Set(urls.map((url) => url.trim().replace(/\/+$/, ""))),
];

const newer = (a: NostrEvent, b: NostrEvent) =>
  a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);

/** The app's one way to Nostr relays, for every feature and every account. */
export class Relays {
  private owners = new Map<string, AccountRelays>();
  private listeners = new Set<() => void>();
  private readonly override: string[] | null;
  private list: string[] | undefined;

  constructor(
    readonly port: RelayPort,
    private storage: KeyValueStorage,
    search = ""
  ) {
    const param = new URLSearchParams(search).get("relays");
    const urls = param?.split(",").filter(isRelayUrl) ?? [];
    this.override = urls.length > 0 ? unique(urls) : null;
  }

  /** This device's list, as Settings shows it (the same array until it
   *  changes). `?relays=` replaces it for one page load. */
  device = (): string[] => {
    this.list ??= this.override ?? this.stored() ?? DEFAULT_RELAYS;
    return this.list;
  };

  private stored(): string[] | null {
    try {
      const urls = JSON.parse(
        this.storage.getItem(RELAY_LIST_KEY) ?? "null"
      )?.relayUrls;
      return Array.isArray(urls) ? unique(urls.filter(isRelayUrl)) : null;
    } catch {
      return null;
    }
  }

  setDevice(urls: string[]): void {
    this.storage.setItem(
      RELAY_LIST_KEY,
      JSON.stringify({ relayUrls: unique(urls.filter(isRelayUrl)) })
    );
    this.deviceChanged();
  }

  /** The stored list changed (here, or in another tab of this browser). */
  deviceChanged(): void {
    this.list = undefined;
    this.listeners.forEach((listener) => listener());
  }

  /** Follows device list changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  of(owner: string): AccountRelays {
    let relays = this.owners.get(owner);
    if (!relays) {
      relays = new AccountRelays(this, owner, this.override === null);
      this.owners.set(owner, relays);
    }
    return relays;
  }

  /** Every relay's stored events for a filter. `ours` is what this device
   *  holds for it: a relay that does NIP-77 then sends only what we lack,
   *  and each relay is sent what it lacks of ours. */
  async fetch(
    urls: string[],
    filter: Filter,
    ours: NostrEvent[] = []
  ): Promise<Fetched> {
    const results = await Promise.all(
      urls.map(async (url) => ({
        url,
        ...(await this.syncOne(url, filter, ours)),
      }))
    );
    const events = new Map<string, NostrEvent>();
    const answered: string[] = [];
    for (const result of results) {
      if (!result.events) continue;
      answered.push(result.url);
      result.events.forEach((event) => events.set(event.id, event));
    }
    await Promise.all(
      results.map(({ url, events: got, lacks }) =>
        got ? this.send(url, lacks) : null
      )
    );
    return { events: [...events.values()], answered };
  }

  // Once we hold some, a NIP-77 relay is asked only for the difference; any
  // other relay, or a NIP-77 sync that fails, is read page by page.
  private async syncOne(
    url: string,
    filter: Filter,
    held: NostrEvent[]
  ): Promise<{ events: Map<string, NostrEvent> | null; lacks: NostrEvent[] }> {
    const synced = held.length > 0 && (await this.reconcile(url, filter, held));
    if (synced) return synced;
    const events = await this.fetchOne(url, filter);
    return { events, lacks: held.filter((e) => !events?.has(e.id)) };
  }

  private async reconcile(url: string, filter: Filter, held: NostrEvent[]) {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), RECONCILE_MS);
    try {
      const diff = await this.port.reconcile(url, filter, held, stop.signal);
      if (!diff) return null;
      const events = new Map<string, NostrEvent>();
      for (let i = 0; i < diff.need.length; i += IDS_PER_REQUEST) {
        const ids = diff.need.slice(i, i + IDS_PER_REQUEST);
        const page = await collect(this.port.request(url, { ...filter, ids }));
        page.forEach((event) => events.set(event.id, event));
      }
      const lacking = new Set(diff.have);
      return { events, lacks: held.filter((e) => lacking.has(e.id)) };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // A relay may cap one answer (strfry sends 500), so older pages follow
  // until one brings nothing new. A page of only seen events from that one
  // second is a second holding more than the cap: step past it. Null when
  // the relay could not answer.
  private async fetchOne(
    url: string,
    filter: Filter
  ): Promise<Map<string, NostrEvent> | null> {
    const seen = new Map<string, NostrEvent>();
    let until: number | undefined;
    try {
      for (;;) {
        const page = await collect(
          this.port.request(
            url,
            until === undefined ? filter : { ...filter, until }
          )
        );
        const fresh = page.filter((event) => !seen.has(event.id));
        fresh.forEach((event) => seen.set(event.id, event));
        if (fresh.length > 0) {
          until = Math.min(...fresh.map((event) => event.created_at));
        } else if (
          until !== undefined &&
          page.length > 0 &&
          page.every((e) => e.created_at === until)
        ) {
          until--;
        } else {
          return seen;
        }
      }
    } catch {
      return null;
    }
  }

  private async send(url: string, events: NostrEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i += UPLOAD_BATCH) {
      await Promise.all(
        events
          .slice(i, i + UPLOAD_BATCH)
          .map((event) => this.port.publish(url, event).catch(() => false))
      );
    }
  }
}

/** One account's relays: this device's list plus the ones its NIP-65 list writes to. */
export class AccountRelays {
  private written: string[] = [];
  private listeners = new Set<() => void>();
  private readonly lookup: Promise<void>;

  constructor(
    private hub: Relays,
    readonly owner: string,
    nip65: boolean
  ) {
    hub.subscribe(() => this.notify());
    this.lookup = nip65 ? this.readRelayList() : Promise.resolve();
  }

  /** None when the person emptied this device's list: chats stay here. */
  urls(): string[] {
    const device = this.hub.device();
    return device.length === 0 ? [] : unique([...device, ...this.written]);
  }

  /** The NIP-65 lookup has answered, failed or timed out. */
  ready(): Promise<void> {
    return this.lookup;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves with the relays that accepted it; rejects when none did. */
  async publish(event: NostrEvent): Promise<string[]> {
    const urls = this.urls();
    const results = await Promise.all(
      urls.map((url) => this.hub.port.publish(url, event).catch(() => false))
    );
    const accepted = urls.filter((_, i) => results[i]);
    if (accepted.length === 0) throw new Error("No relay accepted the event");
    return accepted;
  }

  fetch(filter: Filter, ours?: NostrEvent[]): Promise<Fetched> {
    return this.hub.fetch(this.urls(), filter, ours);
  }

  /** Events published from about now on, from every relay in the list as it changes. */
  live(filter: Filter): Observable<NostrEvent> {
    return new Observable<NostrEvent>((observer) => {
      let current = new Subscription();
      const open = () => {
        current.unsubscribe();
        const since = Math.floor(Date.now() / 1000) - LIVE_SLACK_S;
        current = this.hub.port
          .subscribe(this.urls(), { ...filter, since })
          .subscribe((event) => observer.next(event));
      };
      open();
      const off = this.subscribe(open);
      return () => {
        off();
        current.unsubscribe();
      };
    });
  }

  /** The newest event at one replaceable address (kind, author, #d). */
  watchLatest(filter: Filter): Observable<Latest> {
    return new Observable<Latest>((observer) => {
      let latest: Latest = { event: null, settled: false };
      const consider = (event: NostrEvent) => {
        if (latest.event && !newer(event, latest.event)) return;
        latest = { ...latest, event };
        observer.next(latest);
      };
      const live = this.live(filter).subscribe(consider);
      void this.fetch(filter).then(({ events, answered }) => {
        events.forEach(consider);
        if (answered.length === 0) return;
        latest = { ...latest, settled: true };
        observer.next(latest);
      });
      return () => live.unsubscribe();
    });
  }

  private async readRelayList(): Promise<void> {
    const { events } = await this.hub.fetch(this.hub.device(), {
      kinds: [KIND_RELAY_LIST],
      authors: [this.owner],
    });
    const list = events.reduce<NostrEvent | null>(
      (best, event) => (!best || newer(event, best) ? event : best),
      null
    );
    this.written = list ? getOutboxes(list) : [];
    if (this.written.length > 0) this.notify();
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}

const collect = (source: Observable<NostrEvent>): Promise<NostrEvent[]> =>
  lastValueFrom(source.pipe(timeout({ each: PAGE_MS }), toArray()));
