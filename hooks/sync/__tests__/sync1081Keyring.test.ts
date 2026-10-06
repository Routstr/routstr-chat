import { describe, expect, it, vi } from "vitest";
import { filter, firstValueFrom, timeout } from "rxjs";

type FakeEvent = { id: string; kind: number; pubkey: string; content: string };

const fake = vi.hoisted(() => ({
  events: [] as FakeEvent[],
  gates: new Map<string, { promise: Promise<void>; release: () => void }>(),
  rejectOnce: new Set<string>(),
  attempts: [] as { signer: string; content: string }[],
}));

const gateFor = (content: string) => {
  let release!: () => void;
  fake.gates.set(content, {
    promise: new Promise<void>((r) => (release = r)),
    release,
  });
};

vi.mock("@/lib/pns", () => ({
  SALT_PNS: "routstr-chat-sync-v1",
  derivePnsKeys: (deviceKey: Uint8Array, salt?: string) => ({
    salt: salt ?? "routstr-chat-sync-v1",
    pnsKeypair: { pubKey: `pns-of-${String.fromCharCode(...deviceKey)}` },
  }),
}));

vi.mock("@/lib/nostr", () => ({
  decodePrivateKey: (nsec: string) =>
    new Uint8Array([...nsec.replace("nsec-", "")].map((c) => c.charCodeAt(0))),
}));

vi.mock("@/lib/applesauce-core", () => ({
  eventStore: {
    add: vi.fn(),
    getByFilters: (f: { kinds?: number[]; authors?: string[] }) =>
      fake.events.filter(
        (e) =>
          (!f.kinds || f.kinds.includes(e.kind)) &&
          (!f.authors || f.authors.includes(e.pubkey))
      ),
  },
  relayPool: { publish: vi.fn(), subscription: vi.fn() },
}));

vi.mock("@/lib/eventDatabase", () => ({
  eventDatabaseReady: Promise.resolve(),
  useEventDatabase: { getState: () => ({ getByFilters: () => fake.events }) },
}));

// userSignerDefined$ filters on all three of these being present.
const signerFor = (pubkey: string) => ({
  pubkey,
  signer: {
    nip44: {
      encrypt: async (_p: string, plaintext: string) => plaintext,
      decrypt: async (_p: string, content: string) => {
        fake.attempts.push({ signer: pubkey, content });
        const gate = fake.gates.get(content);
        if (gate) await gate.promise;
        if (fake.rejectOnce.has(content)) {
          fake.rejectOnce.delete(content);
          throw new Error("signer refused");
        }
        return JSON.stringify({
          nsec: `nsec-${content}`,
          salt: "routstr-chat-sync-v1",
        });
      },
    },
    signEvent: async (e: unknown) => e as never,
  },
});

const event = (id: string, pubkey: string, content: string): FakeEvent => ({
  id,
  kind: 1081,
  pubkey,
  content,
});

async function load() {
  vi.resetModules();
  fake.events = [];
  fake.gates.clear();
  fake.rejectOnce.clear();
  fake.attempts = [];
  const inputs = await import("@/hooks/sync/chatSyncInputs");
  const keyring = await import("@/hooks/sync/sync1081Keyring");
  return { ...inputs, ...keyring };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const contentsAttempted = () => fake.attempts.map((a) => a.content);

describe("kind-1081 keyring", () => {
  it("keeps an in-flight decrypt alive when a relay echo arrives", async () => {
    const m = await load();
    m.userPubkey$.next("alice");
    m.userSigner$.next(signerFor("alice") as never);
    fake.events = [event("e1", "alice", "a")];
    gateFor("a");

    const sub = m.processStored1081Events$.subscribe();
    m.triggerProcessStored1081Events();
    await settle();
    expect(contentsAttempted()).toEqual(["a"]);

    fake.events = [event("e1", "alice", "a"), event("e2", "alice", "b")];
    m.triggerProcessStored1081Events();
    await settle();

    fake.gates.get("a")!.release();
    await settle();

    // Cancelling the first run would leave only the echo's key.
    const keys = await firstValueFrom(
      m.derivedPnsKeys$.pipe(
        filter((k) => k.size === 2),
        timeout(1000)
      )
    );
    expect([...keys.keys()].sort()).toEqual(["pns-of-a", "pns-of-b"]);
    sub.unsubscribe();
  });

  it("never reads an event with a signer from another account", async () => {
    const m = await load();
    m.userSigner$.next(signerFor("alice") as never);
    m.userPubkey$.next("bob");
    fake.events = [event("e2", "bob", "b")];

    const sub = m.processStored1081Events$.subscribe();
    m.triggerProcessStored1081Events();
    await settle();
    expect(fake.attempts).toEqual([]);

    m.userSigner$.next(signerFor("bob") as never);
    await settle();
    expect(fake.attempts).toEqual([{ signer: "bob", content: "b" }]);
    sub.unsubscribe();
  });

  it("releases a stale decrypt so it retries after switching back", async () => {
    const m = await load();
    m.userPubkey$.next("alice");
    m.userSigner$.next(signerFor("alice") as never);
    fake.events = [event("e1", "alice", "a")];
    gateFor("a");

    const sub = m.processStored1081Events$.subscribe();
    m.triggerProcessStored1081Events();
    await settle();

    m.userPubkey$.next("bob");
    m.userSigner$.next(signerFor("bob") as never);
    fake.gates.get("a")!.release();
    await settle();
    expect(m.derivedPnsKeys$.value.has("pns-of-a")).toBe(false);

    // Holding the id would lock alice out for the whole session.
    m.userPubkey$.next("alice");
    m.userSigner$.next(signerFor("alice") as never);
    m.triggerProcessStored1081Events();
    await settle();
    expect(contentsAttempted()).toEqual(["a", "a"]);
    const keys = await firstValueFrom(
      m.derivedPnsKeys$.pipe(
        filter((k) => k.has("pns-of-a")),
        timeout(1000)
      )
    );
    expect(keys.has("pns-of-a")).toBe(true);
    sub.unsubscribe();
  });

  it("retries an event after the signer rejects it once", async () => {
    const m = await load();
    m.userPubkey$.next("alice");
    m.userSigner$.next(signerFor("alice") as never);
    fake.events = [event("e1", "alice", "a")];
    fake.rejectOnce.add("a");

    const sub = m.processStored1081Events$.subscribe();
    m.triggerProcessStored1081Events();
    await settle();
    expect(m.derivedPnsKeys$.value.size).toBe(0);

    m.triggerProcessStored1081Events();
    await settle();
    expect(contentsAttempted()).toEqual(["a", "a"]);
    const keys = await firstValueFrom(
      m.derivedPnsKeys$.pipe(
        filter((k) => k.size === 1),
        timeout(1000)
      )
    );
    expect([...keys.keys()]).toEqual(["pns-of-a"]);
    sub.unsubscribe();
  });
});

describe("activeAccountPnsKeys$", () => {
  it("follows the signed-in account across a switch", async () => {
    const m = await load();
    const sub = m.processStored1081Events$.subscribe();
    const active = () =>
      firstValueFrom(m.activeAccountPnsKeys$.pipe(timeout(1000)));

    m.userPubkey$.next("alice");
    m.userSigner$.next(signerFor("alice") as never);
    fake.events = [event("e1", "alice", "a")];
    m.triggerProcessStored1081Events();
    await settle();
    expect((await active())?.pnsKeypair.pubKey).toBe("pns-of-a");

    m.userPubkey$.next("bob");
    m.userSigner$.next(signerFor("bob") as never);
    await settle();
    expect(await active()).toBeNull();

    fake.events = [event("e2", "bob", "b")];
    m.triggerProcessStored1081Events();
    await settle();
    expect((await active())?.pnsKeypair.pubKey).toBe("pns-of-b");

    m.userPubkey$.next("alice");
    m.userSigner$.next(signerFor("alice") as never);
    await settle();
    expect((await active())?.pnsKeypair.pubKey).toBe("pns-of-a");
    sub.unsubscribe();
  });

  it("keeps the flat all-accounts view for the kind-1080 author filter", async () => {
    const m = await load();
    const sub = m.processStored1081Events$.subscribe();

    m.userPubkey$.next("alice");
    m.userSigner$.next(signerFor("alice") as never);
    fake.events = [event("e1", "alice", "a")];
    m.triggerProcessStored1081Events();
    await settle();

    m.userPubkey$.next("bob");
    m.userSigner$.next(signerFor("bob") as never);
    fake.events = [event("e2", "bob", "b")];
    m.triggerProcessStored1081Events();
    await settle();

    const pubkeys = await firstValueFrom(
      m.derivedPnsPubkeys$.pipe(
        filter((k) => k.length === 2),
        timeout(1000)
      )
    );
    expect([...pubkeys].sort()).toEqual(["pns-of-a", "pns-of-b"]);
    sub.unsubscribe();
  });
});
