import { describe, expect, it, vi } from "vitest";
import { freshIndexedDBPerTest } from "@/tests/kit/idb";
import { IndexedCoins } from "../coins";

freshIndexedDBPerTest();
const coin = (secret: string, id = "00ad268c4d1f5826") => ({
  id,
  amount: 8,
  secret,
  C: "02",
});
const units = async (_: string, keysetId: string) =>
  keysetId === "msat-keyset" ? "msat" : "sat";
const secrets = async (store: IndexedCoins, owner: string, mintUrl?: string) =>
  (await store.coins(owner, mintUrl)).map((c) => c.secret).sort();

describe("IndexedCoins", () => {
  it("keeps each owner's coins per mint, matched by secret, so a change can be repeated", async () => {
    const store = IndexedCoins.open(units);
    await store.change("alice", "m1", [coin("a"), coin("b")], []);
    await store.change("alice", "m1", [coin("a"), coin("b")], []);
    await store.change("alice", "m2", [coin("c", "msat-keyset")], []);
    await store.change("bob", "m1", [coin("d")], []);

    expect(await secrets(store, "alice")).toEqual(["a", "b", "c"]);
    expect(await secrets(store, "alice", "m1")).toEqual(["a", "b"]);
    expect(await secrets(store, "bob")).toEqual(["d"]);
    expect((await store.coins("alice", "m2"))[0]).toMatchObject({
      owner: "alice",
      mintUrl: "m2",
      unit: "msat",
    });

    await store.change("alice", "m1", [coin("e")], [coin("a"), coin("a")]);
    expect(await secrets(store, "alice", "m1")).toEqual(["b", "e"]);
  });

  it("puts back a coin its owner took out, never one another account holds or held", async () => {
    const store = IndexedCoins.open(units);
    await store.change("alice", "m1", [coin("a")], []);
    await store.change("alice", "m1", [], [coin("a")]); // a swap's inputs leave first
    await store.change("alice", "m1", [coin("a")], []); // the mint says unspent: back
    expect(await secrets(store, "alice")).toEqual(["a"]);

    await expect(
      store.change("bob", "m1", [coin("x"), coin("a")], [])
    ).rejects.toThrow("another account");
    expect(await secrets(store, "bob")).toEqual([]);
    expect(await store.known(["a", "x", "z"])).toEqual(new Set(["a"]));
    // a spent coin stays known, so an old store's copy never brings it back
    await store.change("alice", "m1", [], [coin("a")]);
    expect(await store.known(["a"])).toEqual(new Set(["a"]));
  });

  it("stores nothing of a change with a coin that has no secret", async () => {
    const store = IndexedCoins.open(units);
    await store.change("alice", "m1", [coin("a")], []);
    const broken = { id: "00ad268c4d1f5826", amount: 8, C: "02" } as never;
    await expect(
      store.change("alice", "m1", [coin("b"), broken], [coin("a")])
    ).rejects.toThrow();
    expect(await secrets(store, "alice")).toEqual(["a"]);
  });

  it("stores nothing when a coin's unit cannot be told yet", async () => {
    const store = IndexedCoins.open(async () =>
      Promise.reject(new Error("offline"))
    );
    await expect(store.change("alice", "m1", [coin("a")], [])).rejects.toThrow(
      "offline"
    );
    expect(await secrets(store, "alice")).toEqual([]);
  });

  it("tells every tab about a change, so none reads a stale copy", async () => {
    const here = IndexedCoins.open(units);
    const there = IndexedCoins.open(units);
    const heard = vi.fn();
    there.subscribe(heard);
    await here.change("alice", "m1", [coin("a")], []);
    await vi.waitFor(() => expect(heard).toHaveBeenCalled());
    expect(await secrets(there, "alice")).toEqual(["a"]);
  });
});
