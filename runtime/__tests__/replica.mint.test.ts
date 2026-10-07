// The wallet's NIP-60 copy on the kit relay, between devices that each keep their own IndexedDB:
// they converge through relays, a fresh device restores, and a publish made offline goes out
// from the outbox once the relay is back.
import { IDBFactory } from "fake-indexeddb";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
} from "nostr-tools";
import { beforeEach, expect, it, vi } from "vitest";
import { getKit } from "@/tests/kit";
import "@/tests/kit/idb";
import { Journal, memoryStorage } from "@/features/book/journal";
import { memoryStorage as relayStorage } from "@/features/relays/__tests__/fakes";
import { Relays } from "@/features/relays/service";
import { MintKeysets } from "@/features/wallet/mints";
import type { CoinStore, WalletSigner } from "@/features/wallet/ports";
import { createPurse } from "@/features/wallet/purse";
import { walletLock } from "@/features/book/executor";
import { Replica, statesAt } from "@/features/wallet/replica";
import { newRelayPool, poolPort } from "@/platform/nostr/pool";
import { IndexedCoins } from "@/platform/wallet/coins";

const kit = getKit();
const MINT = kit.env.mintUrl;
const keysets = new MintKeysets();
const relays = new Relays(
  poolPort(newRelayPool()),
  relayStorage(),
  `?relays=${kit.env.relayUrl}`
);

function signerOf(secret: Uint8Array): WalletSigner {
  const key = nip44.getConversationKey(secret, getPublicKey(secret));
  return {
    encrypt: async (text) => nip44.encrypt(text, key),
    decrypt: async (text) => nip44.decrypt(text, key),
    sign: async (template) => finalizeEvent(template, secret),
  };
}

let secret: Uint8Array;
let owner: string;
beforeEach(() => {
  secret = generateSecretKey();
  owner = getPublicKey(secret);
});

/** a device: its own IndexedDB, book and relay copy, for the same account */
function device(states?: ConstructorParameters<typeof Replica>[1]["states"]) {
  globalThis.indexedDB = new IDBFactory();
  const store = IndexedCoins.open((m, id) => keysets.unitOf(m, id));
  const coins: CoinStore = {
    change: (o, m, add, remove) => store.change(o, m, add, remove),
    coins: (o, m) => store.coins(o, m),
    activeMint: () => MINT,
    subscribe: (_, listener) => store.subscribe(listener),
  };
  const purse = createPurse(owner, {
    coins,
    activity: { record: () => undefined },
    journal: new Journal(memoryStorage()),
    locks: navigator.locks,
  });
  const replica = new Replica(owner, {
    store,
    signer: signerOf(secret),
    relays: relays.of(owner),
    locks: navigator.locks,
    states,
  });
  return {
    store,
    purse,
    replica,
    sats: async () => (await purse.balances())[MINT] ?? 0,
  };
}

it("keeps two devices in step: a coin spent on one goes on the other, one received on the other comes here", async () => {
  const a = device();
  const b = device();
  await a.purse.receive(await kit.mintToken(40));
  await a.replica.push();
  await b.replica.pull();
  expect(await b.sats()).toBe(40);

  expect(await kit.redeem(await a.purse.send(MINT, 10))).toBe(10);
  await a.replica.push();
  await b.replica.pull();
  expect(await b.sats()).toBe(30);

  await b.purse.receive(await kit.mintToken(8));
  await b.replica.push();
  await a.replica.pull();
  expect(await a.sats()).toBe(38);
  expect(await b.sats()).toBe(38);

  // a fresh device takes it all from relays
  const c = device();
  await c.replica.pull();
  expect(await c.sats()).toBe(38);
}, 60_000);

it("publishes from the outbox once the relay is back, after a publish that failed offline", async () => {
  const a = device();
  await kit.relay.down(true);
  try {
    await a.purse.receive(await kit.mintToken(16));
    await a.replica.push(); // nothing takes it: the outbox keeps the mint
    // and an event no relay took is not kept to be deleted later
    expect(await a.store.events(owner, MINT)).toEqual([]);
  } finally {
    await kit.relay.down(false);
  }
  const b = device();
  await b.replica.pull();
  expect(await b.sats()).toBe(0);

  await a.replica.push();
  await b.replica.pull();
  expect(await b.sats()).toBe(16);
}, 60_000);

it("keeps a coin the mint calls pending, though the event that listed it is gone", async () => {
  let pending = false;
  const a = device();
  const b = device(async (mintUrl, coins) =>
    pending ? { unspent: [], spent: [] } : statesAt(mintUrl, coins)
  );
  await a.purse.receive(await kit.mintToken(32));
  await a.replica.push();
  await b.replica.pull();
  expect(await b.sats()).toBe(32);

  // a spends them all; b's mint, asked about them, says pending
  expect(await kit.redeem(await a.purse.send(MINT, 32))).toBe(32);
  await a.replica.push();
  pending = true;
  await b.replica.pull();
  expect(await b.sats()).toBe(32); // a melt may yet fail and give them back
  // once the mint says spent, they go
  pending = false;
  await b.replica.pull();
  expect(await b.sats()).toBe(0);
}, 60_000);

it("lists again what an older event of another device still lists after this one spent it", async () => {
  const a = device();
  const b = device();
  await a.purse.receive(await kit.mintToken(32));
  await a.replica.push();
  await b.replica.pull();
  expect(await b.sats()).toBe(32);

  // a takes in more and publishes; b spends before it has read that
  await a.purse.receive(await kit.mintToken(8));
  await a.replica.push();
  expect(await kit.redeem(await b.purse.send(MINT, 16))).toBe(16);
  await b.replica.push();

  // b reads a's event, which still lists coins b spent: b publishes again
  await b.replica.pull();
  await b.replica.push();
  await a.replica.pull();
  expect(await b.sats()).toBe(24);
  expect(await a.sats()).toBe(24);
}, 60_000);

it("splits a mint's coins over several events, so none grows past what relays take", async () => {
  const a = device();
  const { keysets: list } = await (await kit.walletAt(MINT)).mint.getKeySets();
  const id = list.find((k) => k.active && k.unit === "sat")!.id;
  const coins = Array.from({ length: 250 }, (_, i) => ({
    id,
    amount: 1,
    secret: `${owner}-${i}`,
    C: "02" + "11".repeat(32),
  }));
  await a.store.change(owner, MINT, coins, []);
  await a.replica.push();
  const events = (await kit.relay.events()).filter(
    (e) => e.kind === 7375 && e.pubkey === owner
  );
  expect(events).toHaveLength(3);
}, 60_000);

it("forgets the events relays say are deleted, so its own next one carries no long list", async () => {
  const a = device();
  const b = device();
  await a.purse.receive(await kit.mintToken(8));
  await a.replica.push();
  await b.replica.pull();
  // a changes the mint three more times while b sits idle
  for (const sats of [4, 2, 1]) {
    await a.purse.receive(await kit.mintToken(sats));
    await a.replica.push();
  }
  await b.replica.pull();
  // only a's live event is left to b; the three a deleted are not
  expect(await b.store.events(owner, MINT)).toEqual(
    await a.store.events(owner, MINT)
  );
  expect(await b.sats()).toBe(15);
}, 60_000);

it("writes nothing on a pull that finds only what it has, and knows its own events as its own", async () => {
  const a = device();
  await a.purse.receive(await kit.mintToken(8));
  await a.replica.push();
  const ours = (await kit.relay.events()).filter((e) => e.pubkey === owner);
  expect(ours.length).toBeGreaterThan(0);
  expect(ours.every((e) => a.replica.knows(e.id))).toBe(true);

  const adopt = vi.spyOn(a.store, "adopt");
  await a.replica.pull();
  expect(adopt).not.toHaveBeenCalled();

  // another device's events are still taken in
  const b = device();
  const taken = vi.spyOn(b.store, "adopt");
  await b.replica.pull();
  expect(taken).toHaveBeenCalled();
  expect(await b.sats()).toBe(8);
}, 60_000);

it("asks the mint with the wallet lock free, and later pulls ask relays only for newer deletions", async () => {
  const a = device();
  await a.purse.receive(await kit.mintToken(8));
  await a.replica.push();
  await a.purse.receive(await kit.mintToken(4));
  await a.replica.push(); // deletes the first event

  const lockFree: boolean[] = [];
  const b = device(async (mintUrl, coins) => {
    const { held = [] } = await navigator.locks.query();
    lockFree.push(!held.some((l) => l.name === walletLock(owner)));
    return statesAt(mintUrl, coins);
  });
  const fetch = vi.spyOn(relays.of(owner), "fetch");
  await b.replica.pull();
  expect(await b.sats()).toBe(12);
  expect(lockFree).toEqual([true]);
  const deletions = () =>
    fetch.mock.calls.map(([f]) => f).filter((f) => f.kinds?.includes(5));
  expect(deletions()[0].since).toBeUndefined();

  await b.replica.pull();
  expect(deletions()[1].since).toBeGreaterThan(0);
  fetch.mockRestore();
}, 60_000);
