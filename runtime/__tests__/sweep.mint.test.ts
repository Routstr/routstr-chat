// The one-way sweep from main's per-account blob into the IndexedDB coin store, at the kit mint:
// only unspent coins come in, once, and nothing the store ever held comes back.
import { getEncodedToken, type Proof } from "@cashu/cashu-ts";
import { expect, it } from "vitest";
import { getKit } from "@/tests/kit";
import { freshIndexedDBPerTest } from "@/tests/kit/idb";
import { MintKeysets } from "@/features/wallet/mints";
import { oldCoins, sweep } from "@/features/wallet/sweep";
import { IndexedCoins } from "@/platform/wallet/coins";

freshIndexedDBPerTest();
const kit = getKit();
const MINT = kit.env.mintUrl;
const keysets = new MintKeysets();
const unitOf = (mintUrl: string, id: string) => keysets.unitOf(mintUrl, id);

/** main's blob for an account holding these coins at the kit mint */
async function blob(proofs: Proof[]) {
  const { keysets: list } = await (await kit.walletAt(MINT)).mint.getKeySets();
  return JSON.stringify({
    state: {
      proofs: proofs.map((p) => ({ ...p, eventId: "e1" })),
      mints: [{ url: `${MINT}/`, keysets: list.map((k) => ({ _id: k.id })) }],
    },
    version: 0,
  });
}

const secrets = async (store: IndexedCoins) =>
  (await store.coins("alice", MINT)).map((c) => c.secret).sort();
const sorted = (proofs: Proof[]) => proofs.map((p) => p.secret).sort();

it("brings in the old coins the mint says are unspent, once", async () => {
  const kept = await kit.mintProofs(16, MINT);
  const spent = await kit.mintProofs(8, MINT);
  await kit.redeem(getEncodedToken({ mint: MINT, proofs: spent, unit: "sat" }));
  const into = IndexedCoins.open(unitOf);
  const old = oldCoins(await blob([...kept, ...spent]));

  expect(await sweep("alice", old, { into, locks: navigator.locks })).toBe(
    kept.length
  );
  expect(await secrets(into)).toEqual(sorted(kept));
  // a second sweep of the same blob brings nothing
  expect(await sweep("alice", old, { into, locks: navigator.locks })).toBe(0);
  expect(await secrets(into)).toEqual(sorted(kept));
});

it("never brings back a coin the store spent, though a stale blob still lists it", async () => {
  const proofs = await kit.mintProofs(24, MINT);
  const into = IndexedCoins.open(unitOf);
  const old = oldCoins(await blob(proofs));
  await sweep("alice", old, { into, locks: navigator.locks });

  // v2 spends one coin; the old blob is never written, so it still lists it
  const [gone, ...left] = await into.coins("alice", MINT);
  await into.change("alice", MINT, [], [gone]);
  // and the mint has not seen it spent yet: only the store's memory keeps it out
  expect(await kit.coinStates([gone], MINT)).toEqual(["UNSPENT"]);

  expect(await sweep("alice", old, { into, locks: navigator.locks })).toBe(0);
  expect(await secrets(into)).toEqual(left.map((c) => c.secret).sort());
});

it("keeps one account's coins out of another's sweep", async () => {
  const proofs = await kit.mintProofs(8, MINT);
  const into = IndexedCoins.open(unitOf);
  await into.change("bob", MINT, proofs, []);
  expect(
    await sweep("alice", oldCoins(await blob(proofs)), {
      into,
      locks: navigator.locks,
    })
  ).toBe(0);
  expect(await secrets(into)).toEqual([]);
});
