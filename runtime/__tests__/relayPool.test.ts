import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { Relays } from "@/features/relays/service";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { memoryStorage } from "@/features/relays/__tests__/fakes";
import { newRelayPool, poolPort } from "@/platform/nostr/pool";
import { startRelay } from "@/tests/kit/services/relay";

const servers: (WebSocketServer | Server)[] = [];
afterEach(() => servers.splice(0).forEach((server) => server.close()));

type Behaviour = "answers" | "silent" | "drops";

/** A relay that answers a REQ with EOSE, never says a word, or closes the socket. */
function relay(behaviour: Behaviour): Promise<string> {
  return new Promise((resolve) => {
    const server: WebSocketServer = new WebSocketServer(
      { host: "127.0.0.1", port: 0 },
      () =>
        resolve(`ws://127.0.0.1:${(server.address() as { port: number }).port}`)
    );
    servers.push(server);
    server.on("connection", (socket: WebSocket) =>
      socket.on("message", (raw: Buffer) => {
        const [type, id] = JSON.parse(String(raw));
        if (type !== "REQ") return;
        if (behaviour === "answers") socket.send(JSON.stringify(["EOSE", id]));
        if (behaviour === "drops") socket.close();
      })
    );
  });
}

/** A port nothing listens on: the connection is refused. */
function refused(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(`ws://127.0.0.1:${port}`));
    });
  });
}

describe("the app's relay pool", () => {
  it("counts only a relay's own EOSE as an answer: silent, dropped and refused relays fail", async () => {
    const [answering, silent, drops, closed] = await Promise.all([
      relay("answers"),
      relay("silent"),
      relay("drops"),
      refused(),
    ]);
    const owner = getPublicKey(generateSecretKey());
    const port = poolPort(newRelayPool());
    const relays = new Relays(
      port,
      memoryStorage(),
      `?relays=${[answering, silent, drops, closed].join(",")}`
    );

    const got = await relays
      .of(owner)
      .fetch({ kinds: [1081], authors: [owner] });

    expect(got).toEqual({ events: [], answered: [answering] });
    // what Settings shows for each, read without opening anything
    expect(port.status(answering)).toBe("ok");
    expect(port.status(closed)).toBe("bad");
    expect(port.status("ws://127.0.0.1:1/never-used")).toBe("idle");
  }, 30_000);

  it("syncs by NIP-77 with a relay whose NIP-11 lists it: only the difference moves", async () => {
    const kit = await startRelay();
    try {
      const secret = generateSecretKey();
      const owner = getPublicKey(secret);
      const [theirs, both, ours] = [1, 2, 3].map((t) =>
        finalizeEvent({ kind: 1080, created_at: 1_700_000_000 + t, tags: [], content: "" }, secret)
      );
      const pool = newRelayPool();
      await Promise.all([theirs, both].map((event) => pool.relay(kit.url).publish(event)));
      const filter = { kinds: [1080], authors: [owner] };
      const ids = (events: { id: string }[]) => events.map((e) => e.id).sort();

      const got = await new Relays(poolPort(pool), memoryStorage(), `?relays=${kit.url}`)
        .of(owner)
        .fetch(filter, [both, ours]);

      // read page by page, the relay would have sent `both` as well
      expect(ids(got.events)).toEqual([theirs.id]);
      expect(got.answered).toEqual([kit.url]);
      const after = await new Relays(poolPort(newRelayPool()), memoryStorage(), `?relays=${kit.url}`)
        .of(owner)
        .fetch(filter);
      expect(ids(after.events)).toEqual(ids([theirs, both, ours]));
    } finally {
      await kit.close();
    }
  }, 30_000);

  it("finishes a NIP-77 sync that takes more than one round", async () => {
    const kit = await startRelay();
    try {
      const secret = generateSecretKey();
      const owner = getPublicKey(secret);
      const events = Array.from({ length: 600 }, (_, i) =>
        finalizeEvent({ kind: 1080, created_at: 1_700_000_000 + i, tags: [], content: `${i}` }, secret)
      );
      const pool = newRelayPool();
      await Promise.all(events.map((event) => pool.relay(kit.url).publish(event)));
      const theirs = events.slice(0, 10);
      const extra = finalizeEvent({ kind: 1080, created_at: 1_700_001_000, tags: [], content: "ours" }, secret);
      const ids = (list: { id: string }[]) => list.map((e) => e.id).sort();

      const started = Date.now();
      const got = await new Relays(poolPort(pool), memoryStorage(), `?relays=${kit.url}`)
        .of(owner)
        .fetch({ kinds: [1080], authors: [owner] }, [...events.slice(10), extra]);

      // read page by page (the fallback after a stalled sync), all 600 would come back
      expect(ids(got.events)).toEqual(ids(theirs));
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      await kit.close();
    }
  }, 60_000);

  it("keeps a live feed through an outage longer than a few retries", async () => {
    const kit = await startRelay();
    const control = (on: boolean) =>
      fetch(`${kit.url.replace(/^ws/, "http")}/_kit/down?store=default&on=${on ? 1 : 0}`, { method: "POST" });
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      const secret = generateSecretKey();
      const owner = getPublicKey(secret);
      const got: string[] = [];
      const live = new Relays(poolPort(newRelayPool()), memoryStorage(), `?relays=${kit.url}`)
        .of(owner)
        .live({ kinds: [1080], authors: [owner] })
        .subscribe((event) => got.push(event.content));
      await wait(500);
      // a laptop asleep: longer than applesauce's default three retries a second apart
      await control(true);
      await wait(6000);
      await control(false);
      const back = finalizeEvent({ kind: 1080, created_at: Math.floor(Date.now() / 1000), tags: [], content: "after the outage" }, secret);
      await newRelayPool().relay(kit.url).publish(back);

      for (let i = 0; i < 100 && !got.includes("after the outage"); i++) await wait(250);
      live.unsubscribe();
      expect(got).toContain("after the outage");
    } finally {
      await kit.close();
    }
  }, 60_000);
});
