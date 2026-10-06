// An in-memory Nostr relay for tests: NIP-01 (signed events only), NIP-09 deletions,
// replaceable and addressable kinds. Each URL path is its own relay, so
// ws://host/nos.lol and ws://host/relay.primal.net keep separate stores, the way the
// sealed browser maps public relays (see ../net.ts).
import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  verifyEvent,
  type Event as NostrEvent,
  type Filter,
} from "nostr-tools";

type Sub = { id: string; filters: Filter[]; ws: WebSocket };

interface Store {
  events: Map<string, NostrEvent>;
  subs: Set<Sub>;
  down: boolean; // refuses connections and drops open ones
  eoseDelayMs: number;
}

const tagValues = (e: NostrEvent, name: string) =>
  e.tags.filter((t) => t[0] === name).map((t) => t[1]);

export function matches(e: NostrEvent, f: Filter): boolean {
  if (f.ids && !f.ids.includes(e.id)) return false;
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.since !== undefined && e.created_at < f.since) return false;
  if (f.until !== undefined && e.created_at > f.until) return false;
  for (const [key, wanted] of Object.entries(f)) {
    if (!key.startsWith("#") || !Array.isArray(wanted)) continue;
    if (
      !tagValues(e, key.slice(1)).some((v) => (wanted as string[]).includes(v))
    )
      return false;
  }
  return true;
}

const isReplaceable = (k: number) =>
  k === 0 || k === 3 || (k >= 10000 && k < 20000);
const isEphemeral = (k: number) => k >= 20000 && k < 30000;
const isAddressable = (k: number) => k >= 30000 && k < 40000;
const address = (e: NostrEvent) =>
  isAddressable(e.kind)
    ? `${e.kind}:${e.pubkey}:${tagValues(e, "d")[0] ?? ""}`
    : `${e.kind}:${e.pubkey}`;

/** Stores one event the way a relay would; returns [accepted, message]. */
export function storeEvent(
  store: Pick<Store, "events">,
  e: NostrEvent
): [boolean, string] {
  if (store.events.has(e.id))
    return [true, "duplicate: already have this event"];
  if (e.kind === 5) {
    const ids = new Set(tagValues(e, "e"));
    const addrs = new Set(tagValues(e, "a"));
    for (const [id, old] of store.events) {
      if (old.pubkey !== e.pubkey || old.created_at > e.created_at) continue;
      if (ids.has(id) || addrs.has(address(old))) store.events.delete(id);
    }
  }
  if (isReplaceable(e.kind) || isAddressable(e.kind)) {
    for (const [id, old] of store.events) {
      if (old.kind !== e.kind || address(old) !== address(e)) continue;
      // keep the newer one; on a tie the lower id wins (NIP-01)
      if (
        old.created_at > e.created_at ||
        (old.created_at === e.created_at && old.id < e.id)
      )
        return [false, "duplicate: have a newer version"];
      store.events.delete(id);
    }
  }
  if (!isEphemeral(e.kind)) store.events.set(e.id, e);
  return [true, ""];
}

export interface Relay {
  url: string; // ws://127.0.0.1:<port>
  urlFor(name: string): string; // a separate relay on its own path
  events(name?: string): NostrEvent[];
  seed(events: NostrEvent[], name?: string): void;
  setDown(down: boolean, name?: string): void;
  setEoseDelay(ms: number, name?: string): void;
  close(): Promise<void>;
}

function setDown(store: Store, down: boolean) {
  store.down = down;
  if (down) for (const s of store.subs) s.ws.terminate();
}

export async function startRelay(port = 0): Promise<Relay> {
  const stores = new Map<string, Store>();
  const storeOf = (name: string) => {
    let s = stores.get(name);
    if (!s)
      stores.set(
        name,
        (s = {
          events: new Map(),
          subs: new Set(),
          down: false,
          eoseDelayMs: 0,
        })
      );
    return s;
  };
  const nameOf = (path: string | undefined) =>
    decodeURIComponent((path || "/").split("?")[0].replace(/^\/+|\/+$/g, "")) ||
    "default";

  // Control routes for tests in other processes (see ../client.ts). Anything else gets a
  // 404, like a relay without NIP-11 info, so clients do not hang on it.
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://relay");
    const store = storeOf(url.searchParams.get("store") || "default");
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const done = (value: unknown = { ok: true }) =>
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(value));
      if (url.pathname === "/_kit/events")
        return done([...store.events.values()]);
      if (req.method !== "POST") return res.writeHead(404).end();
      if (url.pathname === "/_kit/seed")
        return done(
          (JSON.parse(body) as NostrEvent[]).map((e) => storeEvent(store, e))
        );
      if (url.pathname === "/_kit/reset") return (store.events.clear(), done());
      if (url.pathname === "/_kit/down")
        return (setDown(store, url.searchParams.get("on") !== "0"), done());
      if (url.pathname === "/_kit/eose-delay")
        return (
          (store.eoseDelayMs = Number(url.searchParams.get("ms") || 0)),
          done()
        );
      res.writeHead(404).end();
    });
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    const store = storeOf(nameOf(req.url));
    if (store.down) return ws.terminate();
    const mine = new Map<string, Sub>();
    const send = (msg: unknown[]) =>
      ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return send(["NOTICE", "error: invalid JSON"]);
      }
      if (!Array.isArray(msg)) return send(["NOTICE", "error: not an array"]);
      const [type, ...rest] = msg;
      if (type === "EVENT") {
        const e = rest[0] as NostrEvent;
        if (!e || typeof e.id !== "string" || !verifyEvent(e))
          return send([
            "OK",
            e?.id ?? "",
            false,
            "invalid: bad id or signature",
          ]);
        const [ok, reason] = storeEvent(store, e);
        send(["OK", e.id, ok, reason]);
        if (ok && !reason)
          for (const s of store.subs)
            if (s.filters.some((f) => matches(e, f)))
              s.ws.send(JSON.stringify(["EVENT", s.id, e]));
      } else if (type === "REQ") {
        const [id, ...filters] = rest as [string, ...Filter[]];
        const sub: Sub = { id, filters, ws };
        const replaced = mine.get(id);
        if (replaced) store.subs.delete(replaced);
        mine.set(id, sub);
        store.subs.add(sub);
        const seen = new Set<string>();
        for (const f of filters) {
          let out = [...store.events.values()]
            .filter((e) => matches(e, f))
            .sort((a, b) => b.created_at - a.created_at);
          if (f.limit !== undefined) out = out.slice(0, f.limit);
          for (const e of out) {
            if (seen.has(e.id)) continue;
            seen.add(e.id);
            send(["EVENT", id, e]);
          }
        }
        if (store.eoseDelayMs)
          setTimeout(() => send(["EOSE", id]), store.eoseDelayMs);
        else send(["EOSE", id]);
      } else if (type === "CLOSE") {
        const sub = mine.get(rest[0] as string);
        if (sub) {
          store.subs.delete(sub);
          mine.delete(sub.id);
        }
      } else if (type === "AUTH" || type === "COUNT") {
        send(["NOTICE", `unsupported: ${type}`]);
      }
    });
    ws.on("close", () => mine.forEach((s) => store.subs.delete(s)));
  });

  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve)
  );
  const { port: bound } = server.address() as { port: number };
  const url = `ws://127.0.0.1:${bound}`;
  return {
    url,
    urlFor: (name) => `${url}/${encodeURIComponent(name)}`,
    events: (name = "default") => [...storeOf(name).events.values()],
    seed: (events, name = "default") =>
      events.forEach((e) => storeEvent(storeOf(name), e)),
    setDown: (down, name = "default") => setDown(storeOf(name), down),
    setEoseDelay: (ms, name = "default") =>
      void (storeOf(name).eoseDelayMs = ms),
    close: () =>
      new Promise<void>((resolve) => {
        wss.clients.forEach((c) => c.terminate());
        wss.close(() => server.close(() => resolve()));
      }),
  };
}
