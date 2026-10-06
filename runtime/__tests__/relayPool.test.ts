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
});
