import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { firstValueFrom, filter, toArray, take } from "rxjs";
import { DEFAULT_RELAYS, Relays } from "../service";
import { memoryStorage, network, settle } from "./fakes";

const [R1, R2, R3] = DEFAULT_RELAYS;
const secret = generateSecretKey();
const OWNER = getPublicKey(secret);
const sign = (
  kind: number,
  created_at: number,
  tags: string[][] = [],
  content = ""
) => finalizeEvent({ kind, created_at, tags, content }, secret);

describe("Relays: the device list", () => {
  it("starts from main's first three presets", () => {
    expect(new Relays(network().port, memoryStorage()).device()).toEqual(
      DEFAULT_RELAYS
    );
  });

  it("reads and writes main's app config", () => {
    const storage = memoryStorage({
      "nostr:app-config": JSON.stringify({ relayUrls: ["wss://a.example/"] }),
    });
    const relays = new Relays(network().port, storage);
    expect(relays.device()).toEqual(["wss://a.example"]);

    relays.setDevice([
      "wss://b.example",
      "https://not-a-relay",
      "wss://b.example/",
    ]);

    expect(JSON.parse(storage.getItem("nostr:app-config")!)).toEqual({
      relayUrls: ["wss://b.example"],
    });
  });

  it("uses ?relays= for this page load only, without the account's own list", async () => {
    const net = network();
    const storage = memoryStorage();
    const relays = new Relays(net.port, storage, "?relays=ws://localhost:7777");
    const list = sign(10002, 1, [["r", "wss://mine.example.com"]]);
    net.relay("ws://localhost:7777").events.set(list.id, list);

    await relays.of(OWNER).ready();

    expect(relays.of(OWNER).urls()).toEqual(["ws://localhost:7777"]);
    expect(storage.getItem("nostr:app-config")).toBeNull();
  });
});

describe("AccountRelays", () => {
  it("adds the relays the account's NIP-65 list writes to, not its read-only ones", async () => {
    const net = network();
    const older = sign(10002, 1, [["r", "wss://old.example"]]);
    const newest = sign(10002, 2, [
      ["r", "wss://both.example.com"],
      ["r", "wss://write.example.com", "write"],
      ["r", "wss://read.example.com", "read"],
      ["r", "javascript:alert(1)"],
    ]);
    net.relay(R1).events.set(older.id, older);
    net.relay(R2).events.set(newest.id, newest);
    const account = new Relays(net.port, memoryStorage()).of(OWNER);

    await account.ready();

    expect(account.urls()).toEqual([
      ...DEFAULT_RELAYS,
      "wss://both.example.com",
      "wss://write.example.com",
    ]);
  });

  it("uses no relay at all when the person emptied this device's list", async () => {
    const net = network();
    const list = sign(10002, 1, [["r", "wss://mine.example.com"]]);
    net.relay(R1).events.set(list.id, list);
    const relays = new Relays(net.port, memoryStorage());
    const account = relays.of(OWNER);
    await account.ready();
    expect(account.urls()).toContain("wss://mine.example.com");

    relays.setDevice([]);

    expect(account.urls()).toEqual([]);
  });

  it("publishes to every relay and says which took it; fails when none did", async () => {
    const net = network();
    net.relay(R2).down = true;
    const account = new Relays(net.port, memoryStorage()).of(OWNER);
    const event = sign(1, 1);

    expect(await account.publish(event)).toEqual([R1, R3]);

    DEFAULT_RELAYS.forEach((url) => (net.relay(url).down = true));
    await expect(account.publish(sign(1, 2))).rejects.toThrow(/No relay/);
  });

  it("fetches from every relay, says which answered, and pages past a capped answer", async () => {
    const net = network();
    net.relay(R3).down = true;
    for (let i = 0; i < 7; i++) {
      const event = sign(1080, 100 + i);
      net.relay(R1).events.set(event.id, event);
    }
    net.relay(R1).cap = 3;
    const account = new Relays(net.port, memoryStorage()).of(OWNER);

    const { events, answered } = await account.fetch({
      kinds: [1080],
      authors: [OWNER],
    });

    expect(events).toHaveLength(7);
    expect(answered).toEqual([R1, R2]);
  });

  it("keeps paging past a second that holds more events than a relay's cap", async () => {
    const net = network();
    const burst = Array.from({ length: 5 }, (_, i) =>
      sign(1080, 200, [], `burst ${i}`)
    );
    const older = [sign(1080, 100), sign(1080, 101)];
    [...burst, ...older].forEach((event) =>
      net.relay(R1).events.set(event.id, event)
    );
    net.relay(R1).cap = 3;
    const account = new Relays(net.port, memoryStorage(), `?relays=${R1}`).of(
      OWNER
    );

    const { events } = await account.fetch({ kinds: [1080], authors: [OWNER] });

    expect(
      events
        .filter((e) => e.created_at < 200)
        .map((e) => e.id)
        .sort()
    ).toEqual(older.map((e) => e.id).sort());
  });

  it("sends each answering relay what it did not return", async () => {
    const net = network();
    const mine = [sign(1080, 1), sign(1080, 2)];
    net.relay(R1).events.set(mine[0].id, mine[0]);
    const account = new Relays(net.port, memoryStorage()).of(OWNER);

    await account.fetch({ kinds: [1080], authors: [OWNER] }, async () => mine);

    expect(net.relay(R1).received.map((e) => e.id)).toEqual([mine[1].id]);
    expect(
      net
        .relay(R2)
        .received.map((e) => e.id)
        .sort()
    ).toEqual(mine.map((e) => e.id).sort());
  });

  it("follows the device list as it changes", async () => {
    const net = network();
    const relays = new Relays(net.port, memoryStorage());
    const account = relays.of(OWNER);
    const got = firstValueFrom(
      account.live({ kinds: [1] }).pipe(take(1), toArray())
    );

    relays.setDevice(["wss://new.example"]);
    await settle();
    net.publishElsewhere(
      "wss://new.example",
      sign(1, Math.floor(Date.now() / 1000))
    );

    expect(await got).toHaveLength(1);
  });

  it("watches the newest copy of a replaceable event and says when every relay answered", async () => {
    const net = network();
    const d = [["d", "routstr-chat-sdk-api-keys-v1"]];
    const old = sign(30078, 10, d, "old");
    const newest = sign(30078, 20, d, "new");
    net.relay(R1).events.set(old.id, old);
    net.relay(R2).events.set(newest.id, newest);
    const account = new Relays(net.port, memoryStorage()).of(OWNER);

    const settled = await firstValueFrom(
      account
        .watchLatest({
          kinds: [30078],
          authors: [OWNER],
          "#d": ["routstr-chat-sdk-api-keys-v1"],
        })
        .pipe(filter((latest) => latest.settled))
    );

    expect(settled.event?.content).toBe("new");
  });

  it("never says settled while no relay answered", async () => {
    const net = network();
    DEFAULT_RELAYS.forEach((url) => (net.relay(url).down = true));
    const account = new Relays(net.port, memoryStorage()).of(OWNER);
    const seen: boolean[] = [];
    const sub = account
      .watchLatest({ kinds: [30078], authors: [OWNER] })
      .subscribe((l) => seen.push(l.settled));

    for (let i = 0; i < 5; i++) await settle();
    sub.unsubscribe();

    expect(seen).not.toContain(true);
  });
});
