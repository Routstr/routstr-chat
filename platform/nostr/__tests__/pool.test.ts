import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { Relays } from "@/features/relays/service";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { memoryStorage } from "@/features/relays/__tests__/fakes";
import { newRelayPool, poolPort } from "../pool";

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
    const relays = new Relays(
      poolPort(newRelayPool()),
      memoryStorage(),
      `?relays=${[answering, silent, drops, closed].join(",")}`
    );

    const got = await relays
      .of(owner)
      .fetch({ kinds: [1081], authors: [owner] });

    expect(got).toEqual({ events: [], answered: [answering] });
  }, 30_000);
});
