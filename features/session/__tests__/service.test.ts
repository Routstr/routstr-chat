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
    first.refresh();
    expect(storage.getItem("activeAccount")).toBe(alice.id);
    await settle();
    expect(JSON.parse(storage.getItem("accounts")!)).toHaveLength(2);

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

  it("keeps a key another tab made, when this tab adds one before it heard", async () => {
    // two tabs share localStorage and IndexedDB
    const storage = memory();
    const { saved, data } = savedCopy();
    const guest = new SessionService();
    guest.boot(storage, saved);
    const other = new SessionService();
    other.boot(storage, saved);
    await settle();

    // a ?cashu= link opens in the other tab, which makes a key for its coins
    const k1 = key();
    other.add(k1);
    await settle();
    // the guest tab's top-up makes a second key
    const k2 = key();
    guest.add(k2);
    await settle();

    const ids = (json: string | null | undefined) =>
      JSON.parse(json ?? "[]").map((a: { id: string }) => a.id);
    expect(ids(data.get("accounts"))).toEqual([k1.id, k2.id]);
    expect(ids(storage.getItem("accounts"))).toEqual([k1.id, k2.id]);
  });

  it("follows the other tabs: takes in what they added, lets go of what they removed", async () => {
    const storage = memory();
    const { saved, data } = savedCopy();
    const one = new SessionService();
    one.boot(storage, saved);
    const two = new SessionService();
    two.boot(storage, saved);
    await settle();
    const alice = key();
    const bob = key();
    two.add(alice);
    two.add(bob);
    await settle();

    // the storage event from tab two's write
    one.refresh();
    await settle();
    expect(one.accounts.accounts$.value.map((a) => a.id)).toEqual([
      alice.id,
      bob.id,
    ]);
    expect(one.getSnapshot().pubkey).toBe(bob.pubkey);

    // tab two removes bob; tab one adds carol before it heard
    two.remove(bob.id);
    const carol = key();
    one.add(carol);
    await settle();
    one.refresh();
    await settle();
    const ids = [alice.id, carol.id];
    expect(
      JSON.parse(data.get("accounts")!).map((a: { id: string }) => a.id)
    ).toEqual(ids);
    expect(one.accounts.accounts$.value.map((a) => a.id)).toEqual(ids);
  });

  it("never signs back in to the last key signed out of, even from a main tab's stale list", async () => {
    const storage = memory();
    const { saved } = savedCopy();
    const first = new SessionService();
    first.boot(storage, saved);
    await settle();
    const alice = key();
    first.add(alice);
    await settle();
    first.remove(alice.id);
    await settle();

    // a main tab that still had alice writes its list
    storage.setItem("accounts", JSON.stringify([alice.toJSON()]));
    const next = new SessionService();
    next.boot(storage, saved);
    await settle();
    expect(next.getSnapshot().pubkey).toBeNull();
  });

  it("keeps a new key when a main tab wipes localStorage before it was written", async () => {
    const storage = memory();
    const { saved, data } = savedCopy();
    const session = new SessionService();
    session.boot(storage, saved);
    await settle();

    const alice = key();
    session.add(alice);
    mainSignOut(storage);
    await settle();

    expect(session.getSnapshot().pubkey).toBe(alice.pubkey);
    expect(
      JSON.parse(data.get("accounts")!).map((a: { id: string }) => a.id)
    ).toEqual([alice.id]);
  });

  it("never writes an older list over a newer one, however slow IndexedDB is", async () => {
    const storage = memory();
    const { saved, data } = savedCopy();
    const one = new SessionService();
    one.boot(storage, saved);
    const two = new SessionService();
    two.boot(storage, saved);
    await settle();

    // the next write to IndexedDB hangs until let go
    let letGo: () => void = () => {};
    const hang = new Promise<void>((r) => (letGo = r));
    const put = saved.put;
    saved.put = async (k, v) => {
      if (k === "accounts") {
        saved.put = put;
        await hang;
      }
      return put(k, v);
    };
    const alice = key();
    one.add(alice);
    await settle();
    const bob = key();
    two.add(bob);
    await settle();
    letGo();
    await settle();
    await settle();

    expect(
      JSON.parse(data.get("accounts")!).map((a: { id: string }) => a.id)
    ).toEqual([alice.id, bob.id]);
  });

  it("keeps a new key in IndexedDB when localStorage is full", async () => {
    const storage = memory();
    const { saved, data } = savedCopy();
    const session = new SessionService();
    session.boot(storage, saved);
    await settle();
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };

    const alice = key();
    session.add(alice);
    await settle();

    expect(session.getSnapshot().pubkey).toBe(alice.pubkey);
    expect(
      JSON.parse(data.get("accounts")!).map((a: { id: string }) => a.id)
    ).toEqual([alice.id]);
  });
});
