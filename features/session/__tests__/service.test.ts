import { describe, expect, it } from "vitest";
import { PrivateKeyAccount } from "applesauce-accounts/accounts";
import { SessionService, type AccountMetadata } from "../service";
import type { Saved } from "../saved";

const memory = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

const key = () => PrivateKeyAccount.generateNew<AccountMetadata>();

// the IndexedDB copy, which a localStorage wipe does not reach
const savedCopy = () => {
  const data = new Map<string, string>();
  const saved: Saved = {
    get: async (k) => data.get(k),
    put: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
  return { data, saved };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

// what a main tab from before the update does at sign out: clear all of
// localStorage but its shelf (main's lib/coinShelf.ts clearAllButShelf)
const SHELF = ["cashu_op", "pending_send_proofs", "pending_receive_proofs"];
const mainSignOut = (storage: ReturnType<typeof memory>) =>
  [...storage.data.keys()]
    .filter((k) => !SHELF.some((f) => k.startsWith(`${f}:`)))
    .forEach((k) => storage.data.delete(k));

describe("SessionService", () => {
  it("restores the saved accounts and the active one at boot", () => {
    const first = new SessionService();
    const storage = memory();
    first.boot(storage, savedCopy().saved);
    const alice = key();
    const bob = key();
    first.add(alice, "Alice");
    first.add(bob);
    first.switchTo(alice.id);

    const next = new SessionService();
    next.boot(memory(Object.fromEntries(storage.data)), savedCopy().saved);
    expect(next.accounts.accounts$.value.map((a) => a.pubkey)).toEqual([
      alice.pubkey,
      bob.pubkey,
    ]);
    expect(next.accounts.accounts$.value[0].metadata).toEqual({
      name: "Alice",
    });
    expect(next.getSnapshot()).toMatchObject({
      accountId: alice.id,
      pubkey: alice.pubkey,
      generation: 0,
    });
  });

  it("keeps the lifetime when a first account is adopted, and bumps it on every change after", () => {
    const session = new SessionService();
    session.boot(memory(), savedCopy().saved);
    const alice = key();
    const bob = key();

    session.add(alice);
    expect(session.getSnapshot().generation).toBe(0);
    session.add(bob);
    expect(session.getSnapshot().generation).toBe(1);

    // same person, another signer: still a new account instance
    const aliceAgain = PrivateKeyAccount.fromKey<AccountMetadata>(
      alice.signer.key
    );
    session.add(aliceAgain);
    expect(session.getSnapshot()).toMatchObject({
      accountId: aliceAgain.id,
      pubkey: alice.pubkey,
      generation: 2,
    });

    session.remove(aliceAgain.id);
    expect(session.getSnapshot()).toMatchObject({
      accountId: alice.id,
      generation: 3,
    });
    session.remove(alice.id);
    session.remove(bob.id);
    expect(session.getSnapshot()).toMatchObject({
      pubkey: null,
      generation: 5,
    });
  });

  it("tells its listeners before anything else that watches the active account", () => {
    const session = new SessionService();
    session.boot(memory(), savedCopy().saved);
    const order: string[] = [];
    session.subscribe(() =>
      order.push(`session ${session.getSnapshot().pubkey}`)
    );
    session.accounts.active$.subscribe((a) =>
      order.push(`app ${a?.pubkey ?? null}`)
    );
    order.length = 0;

    const alice = key();
    session.add(alice);
    expect(order).toEqual([`session ${alice.pubkey}`, `app ${alice.pubkey}`]);
  });

  it("gets every account back after a main tab wiped localStorage, with the app closed or open", async () => {
    const storage = memory();
    const { saved } = savedCopy();
    const first = new SessionService();
    first.boot(storage, saved);
    await settle();
    const alice = key();
    const bob = key();
    first.add(alice, "Alice");
    first.add(bob);
    first.switchTo(alice.id);
    await settle();

    // open: the tab writes its mirror again
    mainSignOut(storage);
    first.repair();
    expect(storage.getItem("activeAccount")).toBe(alice.id);

    // closed: the next start reads the saved copy
    mainSignOut(storage);
    const next = new SessionService();
    next.boot(storage, saved);
    expect(next.getSnapshot().pubkey).toBeNull();
    await settle();
    expect(next.accounts.accounts$.value.map((a) => a.pubkey)).toEqual([
      alice.pubkey,
      bob.pubkey,
    ]);
    expect(next.getSnapshot().pubkey).toBe(alice.pubkey);
    expect(JSON.parse(storage.getItem("accounts")!)).toHaveLength(2);
  });

  it("keeps a removed account removed, and saves accounts a main tab added", async () => {
    const storage = memory();
    const { saved, data } = savedCopy();
    const first = new SessionService();
    first.boot(storage, saved);
    await settle();
    const alice = key();
    first.add(alice);
    first.remove(alice.id);
    await settle();

    const carol = key();
    storage.setItem("accounts", JSON.stringify([carol.toJSON()]));
    const next = new SessionService();
    next.boot(storage, saved);
    await settle();
    expect(next.accounts.accounts$.value.map((a) => a.pubkey)).toEqual([
      carol.pubkey,
    ]);
    expect(JSON.parse(data.get("accounts")!)).toHaveLength(1);
  });

  it("when the saved copy is read late, keeps what happened meanwhile", async () => {
    const storage = memory();
    const { saved, data } = savedCopy();
    const alice = key();
    const bob = key();
    data.set("accounts", JSON.stringify([alice.toJSON(), bob.toJSON()]));
    data.set("activeAccount", alice.id);
    let read: () => void = () => {};
    const gate = new Promise<void>((r) => (read = r));
    const late: Saved = {
      ...saved,
      get: async (k) => (await gate, data.get(k)),
    };

    const session = new SessionService();
    storage.setItem("accounts", JSON.stringify([alice.toJSON(), bob.toJSON()]));
    storage.setItem("activeAccount", alice.id);
    session.boot(storage, late);
    // signed out of alice before the saved copy came in
    session.remove(alice.id);
    // and another tab added carol to the mirror
    const carol = key();
    const mirror = JSON.parse(storage.getItem("accounts")!);
    storage.setItem("accounts", JSON.stringify([...mirror, carol.toJSON()]));
    read();
    await settle();
    await settle();

    expect(session.accounts.accounts$.value.map((a) => a.pubkey)).toEqual([
      bob.pubkey,
      carol.pubkey,
    ]);
    expect(JSON.parse(data.get("accounts")!)).toHaveLength(2);
  });
});
