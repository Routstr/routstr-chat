import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { KIND_PNS, createPnsDeletionEvent } from "@/lib/pns";
import { DEFAULT_RELAYS, Relays } from "@/features/relays/service";
import { ROOT_ID, decodeMessage, encodeMessage } from "../codec";
import { KIND_KEYRING, createKeyring, type HistorySigner } from "../keyring";
import { FORGET_KEY, HistoryService, SYNC_KEY } from "../service";
import { memoryLog, person } from "./fakes";
import {
  memoryStorage,
  network,
  settle,
  until,
} from "@/features/relays/__tests__/fakes";

const [R1, R2] = DEFAULT_RELAYS;
const NOW = 1_790_000_000;

function device(
  opts: {
    net?: ReturnType<typeof network>;
    who?: ReturnType<typeof person>;
    log?: ReturnType<typeof memoryLog>;
    storage?: ReturnType<typeof memoryStorage>;
    signer?: HistorySigner;
  } = {}
) {
  const net = opts.net ?? network();
  const who = opts.who ?? person();
  const log = opts.log ?? memoryLog();
  const storage = opts.storage ?? memoryStorage();
  const relays = new Relays(net.port, storage).of(who.pubkey);
  const history = new HistoryService({
    owner: who.pubkey,
    signer: opts.signer ?? who.signer,
    log,
    relays,
    storage,
  });
  return { net, who, log, storage, history };
}

// one clock for history and the relay layer, as in the app
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

const ready = (history: HistoryService) =>
  until(() => history.getStatus() === "ready");

const ask = (text: string, parent = ROOT_ID) => ({
  role: "user",
  content: text,
  _prevId: parent,
});

/** A keyring already on a relay, as another device of the account left it. */
async function keyringOn(
  net: ReturnType<typeof network>,
  who: ReturnType<typeof person>,
  url = R1,
  at = NOW - 1000
) {
  const made = await createKeyring(who.pubkey, who.signer, at);
  net.relay(url).events.set(made.event.id, made.event);
  return made;
}

describe("HistoryService: saving", () => {
  it("resolves a save only once the write is on disk", async () => {
    const { history, log } = device();
    history.start();
    await ready(history);

    const release = log.hold();
    let done = false;
    const saving = history.save("c1", ask("hello")).then(() => (done = true));
    await settle();
    expect(done).toBe(false);
    expect(history.branch("c1")).toEqual([]);

    release();
    await saving;
    expect(history.branch("c1").map((m) => m.content)).toEqual(["hello"]);
    expect(log.rows.size).toBeGreaterThan(1);
  });

  it("rejects when the disk refuses, and keeps nothing in memory", async () => {
    const { history, log } = device();
    history.start();
    await ready(history);

    log.failNextWrite(new Error("QuotaExceededError"));
    await expect(history.save("c1", ask("hello"))).rejects.toThrow(
      "QuotaExceededError"
    );
    expect(history.getConversations()).toEqual([]);
  });

  it("writes what it shows: the saved message comes back from disk the same", async () => {
    const { history, log, who } = device();
    history.start();
    await ready(history);

    const saved = await history.save("c1", {
      ...ask("hi"),
      _createdAt: 5,
      satsSpent: 3,
    });
    const keys = history.writingKeys()!;
    const onDisk = decodeMessage(log.rows.get(saved._eventId)!, keys);

    expect(onDisk?.message).toEqual({ ...saved, _prevId: ROOT_ID });
    expect(saved._createdAt).toBe(NOW);
    expect(saved).not.toHaveProperty("satsSpent");
    expect(log.rows.get(saved._eventId)!.pubkey).not.toBe(who.pubkey);
  });

  it("makes a new answer the shown version, even where an older one was picked", async () => {
    const { history } = device();
    history.start();
    await ready(history);
    const q = await history.save("c1", ask("q"));
    const a1 = await history.save("c1", {
      role: "assistant",
      content: "a1",
      _prevId: q._eventId,
    });
    await history.save("c1", {
      role: "assistant",
      content: "a2",
      _prevId: q._eventId,
    });
    history.selectVersion("c1", 1, a1._eventId);
    expect(history.branch("c1").map((m) => m.content)).toEqual(["q", "a1"]);

    await history.save("c1", {
      role: "assistant",
      content: "a3",
      _prevId: q._eventId,
    });

    expect(history.branch("c1").map((m) => m.content)).toEqual(["q", "a3"]);
  });

  it("sends a saved message to the relays", async () => {
    const { history, net } = device();
    history.start();
    await ready(history);

    const saved = await history.save("c1", ask("hello"));

    await until(() => net.relay(R1).events.has(saved._eventId));
  });
});

describe("HistoryService: the keyring", () => {
  it("makes a first keyring only after a relay said there is none, then saves with it", async () => {
    const { history, net, who } = device();
    history.start();
    await ready(history);

    const keyrings = [...net.relay(R1).events.values()].filter(
      (e) => e.kind === KIND_KEYRING
    );
    expect(keyrings).toHaveLength(1);
    expect(keyrings[0].pubkey).toBe(who.pubkey);
  });

  it("makes none while no relay answers, says offline, and refuses to save", async () => {
    const net = network();
    DEFAULT_RELAYS.forEach((url) => (net.relay(url).down = true));
    const { history, log } = device({ net });
    history.start();

    await until(() => history.getStatus() === "offline");
    await expect(history.save("c1", ask("hello"))).rejects.toThrow(/relay/);
    expect(log.rows.size).toBe(0);
  });

  it("uses the keyring a relay already has instead of making a second one", async () => {
    const net = network();
    const who = person();
    const existing = await keyringOn(net, who, R2);
    const { history } = device({ net, who });
    history.start();
    await ready(history);

    const all = [
      ...net.relay(R1).events.values(),
      ...net.relay(R2).events.values(),
    ];
    expect(all.filter((e) => e.kind === KIND_KEYRING).map((e) => e.id)).toEqual(
      [existing.event.id]
    );
    expect(history.writingKeys()?.pnsKeypair.pubKey).toBe(
      existing.keys.pnsKeypair.pubKey
    );
  });

  it("writes with the oldest keyring, so every device writes with the same one", async () => {
    const net = network();
    const who = person();
    const newer = await keyringOn(net, who, R1, NOW - 10);
    const older = await keyringOn(net, who, R2, NOW - 20);
    const { history } = device({ net, who });
    history.start();
    await until(() => history.getStatus() === "ready");
    await history.sync();

    expect(history.writingKeys()?.pnsKeypair.pubKey).toBe(
      older.keys.pnsKeypair.pubKey
    );
    expect(newer.keys.pnsKeypair.pubKey).not.toBe(older.keys.pnsKeypair.pubKey);
    // a file another device encrypted may use either: reading tries the writing one first
    expect(history.readingKeys().map((k) => k.pnsKeypair.pubKey)).toEqual([
      older.keys.pnsKeypair.pubKey,
      newer.keys.pnsKeypair.pubKey,
    ]);
  });

  it("reads the history of every keyring the account has", async () => {
    const net = network();
    const who = person();
    const k1 = await keyringOn(net, who, R1, NOW - 20);
    const k2 = await keyringOn(net, who, R2, NOW - 10);
    for (const [k, text, conversation] of [
      [k1, "one", "c1"],
      [k2, "two", "c2"],
    ] as const) {
      const event = encodeMessage(
        conversation,
        ask(text),
        who.pubkey,
        NOW - 5,
        k.keys
      );
      net.relay(R1).events.set(event.id, event);
    }
    const { history } = device({ net, who });
    history.start();

    await until(() => history.getConversations().length === 2);
    expect(
      history
        .getConversations()
        .map((c) => c.title)
        .sort()
    ).toEqual(["one", "two"]);
  });

  it("is locked while the signer will not open the keyring, and opens on a later sync", async () => {
    const net = network();
    const who = person();
    await keyringOn(net, who);
    let refuse = true;
    const signer: HistorySigner = {
      ...who.signer,
      nip44: {
        encrypt: who.signer.nip44!.encrypt,
        decrypt: async (peer, text) => {
          if (refuse) throw new Error("User rejected");
          return who.signer.nip44!.decrypt(peer, text);
        },
      },
    };
    const { history } = device({ net, who, signer });
    history.start();

    await until(() => history.getStatus() === "locked");
    await expect(history.save("c1", ask("x"))).rejects.toThrow(/locked/);
    expect(
      [...net.relay(R1).events.values()].filter((e) => e.kind === KIND_KEYRING)
    ).toHaveLength(1);

    // a sync that could open no key synced nothing, and says so
    await expect(history.sync()).resolves.toBe("failed");

    refuse = false;
    await expect(history.sync()).resolves.toBe("ok");
    expect(history.getStatus()).toBe("ready");
  });

  it("is locked when the signer cannot encrypt a first keyring", async () => {
    const who = person();
    const { history, net } = device({
      who,
      signer: { signEvent: who.signer.signEvent },
    });
    history.start();

    await until(() => history.getStatus() === "locked");
    expect([...net.relay(R1).events.values()]).toHaveLength(0);
  });

  it("asks the signer once per keyring, even when Sync now runs during its decrypt", async () => {
    const net = network();
    const who = person();
    await keyringOn(net, who, R2, NOW);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const signer: HistorySigner = {
      ...who.signer,
      nip44: {
        encrypt: who.signer.nip44!.encrypt,
        decrypt: async (peer, text) => {
          calls++;
          await gate;
          return who.signer.nip44!.decrypt(peer, text);
        },
      },
    };
    const { history } = device({ net, who, signer });
    history.start();
    await until(() => calls === 1);

    const syncing = history.sync();
    for (let i = 0; i < 5; i++) await settle();
    release();
    await syncing;
    await ready(history);
    await history.sync();

    expect(calls).toBe(1);
  });

  it("never reads one account's chats with another's keys on a shared device", async () => {
    const net = network();
    const log = memoryLog();
    const storage = memoryStorage();
    const alice = device({ net, log, storage });
    alice.history.start();
    await ready(alice.history);
    await alice.history.save("a", ask("alice's secret"));
    alice.history.dispose();

    const bob = device({ net, log, storage });
    const warn = vi.spyOn(console, "warn");
    bob.history.start();
    await ready(bob.history);

    expect(bob.history.getConversations()).toEqual([]);
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/invalid MAC/);
    warn.mockRestore();
  });
});

describe("HistoryService: deleting", () => {
  it("writes the deletion before dropping the chat, and sends it", async () => {
    const { history, log, net } = device();
    history.start();
    await ready(history);
    const q = await history.save("c1", ask("bye"));

    await history.remove("c1");

    expect(history.getConversations()).toEqual([]);
    expect(log.rows.has(q._eventId)).toBe(false);
    const deletion = [...log.rows.values()].find((e) => e.kind === 5)!;
    expect(deletion.tags).toEqual([
      ["e", q._eventId],
      ["k", "1080"],
    ]);
    expect(deletion.content).toBe("Conversation deleted");
    await until(() => net.relay(R1).events.has(deletion.id));
  });

  it("drops a chat another device deleted, and never brings it back from a relay that kept it", async () => {
    const net = network();
    const who = person();
    const k = await keyringOn(net, who);
    const message = encodeMessage(
      "c1",
      ask("gone soon"),
      who.pubkey,
      NOW - 5,
      k.keys
    );
    net.relay(R1).events.set(message.id, message);
    net.relay(R2).events.set(message.id, message);
    const { history } = device({ net, who });
    history.start();
    await until(() => history.getConversations().length === 1);

    const deletion = createPnsDeletionEvent(
      [message.id],
      k.keys,
      "Conversation deleted"
    );
    net.publishElsewhere(R1, deletion);
    await until(() => history.getConversations().length === 0);

    await history.sync();
    expect(history.getConversations()).toEqual([]);
  });

  it("ignores a forged deletion", async () => {
    const net = network();
    const who = person();
    const k = await keyringOn(net, who);
    const message = encodeMessage(
      "c1",
      ask("keep me"),
      who.pubkey,
      NOW - 5,
      k.keys
    );
    net.relay(R1).events.set(message.id, message);
    const { history } = device({ net, who });
    history.start();
    await until(() => history.getConversations().length === 1);

    const forged = finalizeEvent(
      {
        kind: 5,
        created_at: NOW,
        tags: [
          ["e", message.id],
          ["k", "1080"],
        ],
        content: "",
      },
      generateSecretKey()
    );
    // as it comes off the wire: a plain object, signed by someone else
    net.publishElsewhere(
      R1,
      JSON.parse(
        JSON.stringify({ ...forged, pubkey: k.keys.pnsKeypair.pubKey })
      )
    );
    await settle();

    expect(history.getConversations()).toHaveLength(1);
  });

  it("ignores a deletion signed by another key, even from a relay that ignores filters", async () => {
    const net = network();
    const who = person();
    const k = await keyringOn(net, who);
    const message = encodeMessage(
      "c1",
      ask("keep me too"),
      who.pubkey,
      NOW - 5,
      k.keys
    );
    net.relay(R1).events.set(message.id, message);
    const stranger = finalizeEvent(
      {
        kind: 5,
        created_at: NOW,
        tags: [
          ["e", message.id],
          ["k", "1080"],
        ],
        content: "",
      },
      generateSecretKey()
    );
    net.relay(R2).events.set(stranger.id, stranger);
    net.relay(R2).ignoresFilters = true;
    const { history } = device({ net, who });
    history.start();
    await until(() => history.getConversations().length === 1);

    await history.sync();

    expect(history.getConversations()).toHaveLength(1);
  });
});

describe("HistoryService: Delete all chats", () => {
  it("forgets this device's copy only, and the next sync brings it back", async () => {
    const { history, log, net } = device();
    history.start();
    await ready(history);
    const saved = await history.save("c1", ask("kept on the relays"));
    await until(() => net.relay(R1).events.has(saved._eventId));

    await history.forgetHere();

    expect(history.getConversations()).toEqual([]);
    expect(log.rows.has(saved._eventId)).toBe(false);
    expect(net.relay(R1).events.has(saved._eventId)).toBe(true);
    expect([...net.relay(R1).events.values()].some((e) => e.kind === 5)).toBe(
      false
    );

    await history.sync();
    expect(history.branch("c1").map((m) => m.content)).toEqual([
      "kept on the relays",
    ]);
  });
});

describe("HistoryService: sync", () => {
  it("sends a relay the history it is missing", async () => {
    const { history, net } = device();
    history.start();
    await ready(history);
    net.relay(R2).down = true;
    const saved = await history.save("c1", ask("while R2 was down"));
    await until(() => net.relay(R1).events.has(saved._eventId));
    expect(net.relay(R2).events.has(saved._eventId)).toBe(false);

    net.relay(R2).down = false;
    expect(await history.sync()).toBe("ok");

    expect(net.relay(R2).events.has(saved._eventId)).toBe(true);
  });

  it("reads every page from a relay that caps its answers", async () => {
    const net = network();
    const who = person();
    const k = await keyringOn(net, who);
    // written over twelve seconds, as a real device would
    const clock = vi.spyOn(Date, "now");
    for (let i = 0; i < 12; i++) {
      clock.mockReturnValue((NOW - 100 + i) * 1000);
      const event = encodeMessage(
        `c${i}`,
        ask(`chat ${i}`),
        who.pubkey,
        NOW - 100 + i,
        k.keys
      );
      net.relay(R1).events.set(event.id, event);
    }
    clock.mockRestore();
    net.relay(R1).cap = 5;
    const { history } = device({ net, who });
    history.start();

    await until(() => history.getConversations().length === 12);
  });

  it("answers each manual sync with its own run's result", async () => {
    const { history, net } = device();
    history.start();
    await ready(history);

    DEFAULT_RELAYS.forEach((url) => (net.relay(url).down = true));
    const offline = history.sync();
    const results = [offline];
    // the second is asked while the first runs, after the relays came back
    await settle();
    DEFAULT_RELAYS.forEach((url) => (net.relay(url).down = false));
    results.push(history.sync());

    expect(await Promise.all(results)).toEqual(["offline", "ok"]);
  });

  it("with sync off, keeps chats here and sends none", async () => {
    const storage = memoryStorage({ [SYNC_KEY]: "false" });
    const { history, net } = device({ storage });
    history.start();
    await ready(history);

    const saved = await history.save("c1", ask("only here"));
    await history.sync();

    expect(history.branch("c1")).toHaveLength(1);
    expect(
      DEFAULT_RELAYS.some((url) => net.relay(url).events.has(saved._eventId))
    ).toBe(false);
  });

  it("shows a message another device saves while this one is open", async () => {
    const net = network();
    const who = person();
    const k = await keyringOn(net, who);
    const { history } = device({ net, who });
    history.start();
    await ready(history);

    const event = encodeMessage(
      "c9",
      ask("from my phone"),
      who.pubkey,
      NOW,
      k.keys
    );
    net.publishElsewhere(R2, event);

    await until(() =>
      history.getConversations().some((c) => c.title === "from my phone")
    );
  });

  it("takes a burst from another device in one disk write and one redraw", async () => {
    const net = network();
    const who = person();
    const k = await keyringOn(net, who);
    const { history, log } = device({ net, who });
    history.start();
    await ready(history);
    const writes = vi.spyOn(log, "put");
    let redraws = 0;
    history.subscribe(() => redraws++);

    for (let i = 0; i < 50; i++) {
      net.publishElsewhere(R2, encodeMessage(`b${i}`, ask(`burst ${i}`), who.pubkey, NOW, k.keys));
    }

    await until(() => history.getConversations().length === 50);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(redraws).toBe(1);
  });
});

describe("HistoryService: lifetime", () => {
  it("refuses saves once disposed, including one waiting for the keyring", async () => {
    const net = network();
    const who = person();
    await keyringOn(net, who);
    const signer: HistorySigner = {
      ...who.signer,
      nip44: {
        encrypt: who.signer.nip44!.encrypt,
        decrypt: () => new Promise(() => {}),
      },
    };
    const { history } = device({ net, who, signer });
    history.start();

    const waiting = history.save("c1", ask("too late"));
    await settle();
    history.dispose();

    await expect(waiting).rejects.toThrow(/no longer active/);
    await expect(history.save("c1", ask("x"))).rejects.toThrow(
      /no longer active/
    );
  });
});

describe("HistoryService: main's data", () => {
  it("takes main's plain-text chats from before sync once, in order, and removes the copy", async () => {
    const storage = memoryStorage({
      saved_conversations: JSON.stringify([
        {
          id: "1700000000000",
          title: "old",
          messages: [
            { role: "user", content: "first" },
            { role: "assistant", content: "answer" },
            { role: "user", content: "second" },
            { role: "system", content: "Uncaught Error" },
          ],
        },
        {
          id: "1700000500000",
          title: "synced",
          messages: [{ role: "user", content: "x", _eventId: "e".repeat(64) }],
        },
      ]),
      saved_conversations_updated_at: "1700000000000",
    });
    const { history, net } = device({ storage });
    history.start();

    await until(() => history.getConversations().length === 1);
    expect(history.branch("1700000000000").map((m) => m.content)).toEqual([
      "first",
      "answer",
      "second",
    ]);
    expect(storage.map.has("saved_conversations")).toBe(false);
    expect(storage.map.has("saved_conversations_updated_at")).toBe(false);
    await until(
      () =>
        [...net.relay(R1).events.values()].filter((e) => e.kind === KIND_PNS)
          .length === 3
    );
  });

  it("leaves main's old chats for the next account when a switch comes during the first sync", async () => {
    const storage = memoryStorage({
      saved_conversations: JSON.stringify([
        {
          id: "1700000000000",
          title: "old",
          messages: [{ role: "user", content: "first" }],
        },
      ]),
    });
    const net = network();
    const who = person();
    const keyring = await createKeyring(who.pubkey, who.signer, NOW - 100);
    const log = memoryLog([keyring.event]);
    const first = device({ net, who, log, storage });
    // the switch lands while the first account's relays are being asked
    const request = net.port.request;
    net.port.request = (url, filter) => {
      if (filter.kinds?.includes(KIND_KEYRING)) first.history.dispose();
      return request(url, filter);
    };
    first.history.start();
    for (let i = 0; i < 20; i++) await settle();
    net.port.request = request;
    expect(storage.map.has("saved_conversations")).toBe(true);

    const next = device({ net, log, storage });
    next.history.start();
    await until(() => next.history.getConversations().length === 1);
    expect(storage.map.has("saved_conversations")).toBe(false);
  });

  it("never brings back a chat deleted here when a relay still holds it, after a restart", async () => {
    const net = network();
    const who = person();
    const k = await keyringOn(net, who);
    const message = encodeMessage(
      "c1",
      ask("deleted here"),
      who.pubkey,
      NOW - 5,
      k.keys
    );
    net.relay(R2).events.set(message.id, message);
    // this device deleted it: its disk keeps the keyring and the deletion only
    const deletion = createPnsDeletionEvent(
      [message.id],
      k.keys,
      "Conversation deleted"
    );
    const log = memoryLog([k.event, deletion]);
    const { history } = device({ net, who, log });
    history.start();
    await ready(history);

    await history.sync();

    expect(history.getConversations()).toEqual([]);
    expect(log.rows.has(message.id)).toBe(false);
  });

  it("forgets chats older than 7 days when the setting is on", async () => {
    const net = network();
    const who = person();
    const k = await keyringOn(net, who);
    const old = encodeMessage(
      "old",
      ask("old"),
      who.pubkey,
      NOW - 8 * 86400,
      k.keys
    );
    const fresh = encodeMessage(
      "new",
      ask("new"),
      who.pubkey,
      NOW - 86400,
      k.keys
    );
    [old, fresh].forEach((event) => net.relay(R1).events.set(event.id, event));
    const { history } = device({
      net,
      who,
      storage: memoryStorage({ [FORGET_KEY]: "true" }),
    });
    history.start();

    await until(
      () =>
        history
          .getConversations()
          .map((c) => c.id)
          .join() === "new"
    );
    await until(() =>
      [...net.relay(R1).events.values()].some((e) => e.kind === 5)
    );
  });

  it("reads history main wrote and left on this device", async () => {
    const who = person();
    const keyringEvent = await createKeyring(who.pubkey, who.signer, NOW - 100);
    const event = encodeMessage(
      "m1",
      ask("written by main"),
      who.pubkey,
      NOW - 50,
      keyringEvent.keys
    );
    const log = memoryLog([keyringEvent.event, event]);
    const net = network();
    DEFAULT_RELAYS.forEach((url) => (net.relay(url).down = true));
    const { history } = device({ net, who, log });
    // what the screens see at the moment it says ready: the chats are in
    const atReady: string[][] = [];
    history.subscribe(() => {
      if (history.getStatus() === "ready" && atReady.length === 0) {
        atReady.push(history.getConversations().map((c) => c.title));
      }
    });
    history.start();

    await ready(history);
    expect(atReady).toEqual([["written by main"]]);
  });
});

describe("HistoryService: the first keyring and a broken disk", () => {
  it("asks the signer for one first keyring even when Sync now is pressed during its prompt", async () => {
    const who = person();
    let prompts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const signer: HistorySigner = {
      ...who.signer,
      signEvent: async (template) => {
        prompts++;
        await gate;
        return who.signer.signEvent(template);
      },
    };
    const { history, net } = device({ who, signer });
    history.start();
    await until(() => prompts === 1);

    const pressed = history.sync();
    await settle();
    release();
    await pressed;
    await ready(history);

    expect(prompts).toBe(1);
    expect(
      [...net.relay(R1).events.values()].filter((e) => e.kind === KIND_KEYRING)
    ).toHaveLength(1);
  });

  it("keeps the other device's keyring when it arrives during this one's first prompt", async () => {
    const net = network();
    const who = person();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let prompts = 0;
    const signer: HistorySigner = {
      ...who.signer,
      signEvent: async (template) => {
        prompts++;
        await gate;
        return who.signer.signEvent(template);
      },
    };
    const { history } = device({ net, who, signer });
    history.start();
    await until(() => prompts === 1);

    const theirs = await createKeyring(who.pubkey, who.signer, NOW);
    net.publishElsewhere(R1, theirs.event);
    for (let i = 0; i < 5; i++) await settle();
    release();
    await ready(history);
    await history.sync();

    const onRelays = DEFAULT_RELAYS.flatMap((url) =>
      [...net.relay(url).events.values()].filter((e) => e.kind === KIND_KEYRING)
    );
    expect(new Set(onRelays.map((e) => e.id))).toEqual(
      new Set([theirs.event.id])
    );
    expect(history.writingKeys()?.pnsKeypair.pubKey).toBe(
      theirs.keys.pnsKeypair.pubKey
    );
  });

  it("makes its own first keyring when a relay serves a forged one", async () => {
    const net = network();
    const who = person();
    const forged = finalizeEvent(
      {
        kind: KIND_KEYRING,
        created_at: NOW - 10,
        tags: [],
        content: "not a keyring",
      },
      generateSecretKey()
    );
    const wire = JSON.parse(JSON.stringify({ ...forged, pubkey: who.pubkey }));
    net.relay(R1).events.set(wire.id, wire);
    const { history } = device({ net, who });
    history.start();

    await ready(history);
  });

  it("takes only keyring events as keyrings, whatever else a relay serves", async () => {
    const net = network();
    const who = person();
    // a relay that ignores filters sends the person's own note with the keyrings
    const note = await who.signer.signEvent({ kind: 1, created_at: NOW - 10, tags: [], content: "hello" });
    net.relay(R1).ignoresFilters = true;
    net.relay(R1).events.set(note.id, note);
    const { history } = device({ net, who });
    history.start();

    await ready(history);
    await expect(history.save("c1", ask("x"))).resolves.toBeTruthy();
  });

  it("never asks a switched-away account's signer to open a keyring", async () => {
    const net = network();
    const who = person();
    await keyringOn(net, who);
    let decrypts = 0;
    const signer: HistorySigner = {
      ...who.signer,
      nip44: {
        encrypt: who.signer.nip44!.encrypt,
        decrypt: async (peer, text) => {
          decrypts++;
          return who.signer.nip44!.decrypt(peer, text);
        },
      },
    };
    const { history } = device({ net, who, signer });
    // the switch lands while the relays are being asked for a keyring
    const request = net.port.request;
    net.port.request = (url, filter) => {
      if (filter.kinds?.includes(KIND_KEYRING)) history.dispose();
      return request(url, filter);
    };
    history.start();
    for (let i = 0; i < 20; i++) await settle();

    expect(decrypts).toBe(0);
  });

  it("never asks a switched-away account's signer for a first keyring", async () => {
    const who = person();
    let prompts = 0;
    const signer: HistorySigner = {
      ...who.signer,
      signEvent: async (template) => {
        prompts++;
        return who.signer.signEvent(template);
      },
    };
    const { history, net } = device({ who, signer });
    // the switch lands while the relays are being asked for a keyring
    const request = net.port.request;
    net.port.request = (url, filter) => {
      if (filter.kinds?.includes(KIND_KEYRING)) history.dispose();
      return request(url, filter);
    };
    history.start();
    for (let i = 0; i < 20; i++) await settle();

    expect(prompts).toBe(0);
  });

  it("refuses saves at once when this device's storage will not open", async () => {
    const log = memoryLog();
    log.query = async () => {
      throw new Error("UnknownError: backing store");
    };
    const { history } = device({ log });
    history.start();

    await until(() => history.getStatus() === "failed");
    await expect(history.save("c1", ask("x"))).rejects.toThrow(/storage/);
  });
});
