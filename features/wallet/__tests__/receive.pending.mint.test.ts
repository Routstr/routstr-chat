// A token received while its mint cannot be reached is the wallet's: written to the book before
// the mint is asked, landed once the mint answers, and never counted twice.
import { beforeEach, expect, it, vi } from "vitest";
import { getKit } from "@/tests/kit";
import { walletLock } from "@/features/book/executor";
import { Journal, memoryStorage } from "@/features/book/journal";
import { RecoveryHost } from "@/features/book/recovery";
import { createPurse, type Purse } from "../purse";
import type { Coin, CoinStore } from "../ports";

const kit = getKit();
const MINT = kit.env.mintUrl;

/** every request to `url` fails as a dropped network would, until undone */
function cutOff(url: string) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = input instanceof Request ? input.url : String(input);
    if (target.startsWith(url)) {
      throw new TypeError("fetch failed (mint unreachable on purpose)");
    }
    return real(input, init);
  }) as typeof fetch;
  return () => void (globalThis.fetch = real);
}

/** lets the first swap reach the mint, loses its answer, then cuts the mint off */
function dropAfterSwap(url: string) {
  const real = globalThis.fetch;
  let swapped = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = input instanceof Request ? input.url : String(input);
    if (!target.startsWith(url)) return real(input, init);
    if (swapped)
      throw new TypeError("fetch failed (mint unreachable on purpose)");
    const res = await real(input, init);
    if (target.endsWith("/v1/swap")) {
      swapped = true;
      throw new TypeError("network error (answer lost on purpose)");
    }
    return res;
  }) as typeof fetch;
  return () => void (globalThis.fetch = real);
}

let held: Coin[];
let journal: Journal;
let written: { direction: string; sats: number }[];
let purse: Purse;
let coins: CoinStore;

beforeEach(() => {
  held = [];
  written = [];
  journal = new Journal(memoryStorage());
  coins = {
    async change(owner, mintUrl, add, remove) {
      const gone = new Set(remove.map((p) => p.secret));
      held = held
        .filter((c) => !gone.has(c.secret))
        .concat(add.map((p) => ({ ...p, owner, mintUrl, unit: "sat" })));
    },
    coins: async () => held,
    activeMint: () => MINT,
    subscribe: () => () => undefined,
  };
  purse = createPurse("alice", {
    coins,
    activity: { record: (_, e) => void written.push(e) },
    journal,
    locks: navigator.locks,
  });
});

const kinds = () => journal.list("alice").map((r) => r.kind);

it("keeps a token the mint cannot be reached for, lands it when it can, and a replay adds nothing", async () => {
  const token = await kit.mintToken(40);

  const restore = cutOff(MINT);
  try {
    expect(await purse.take(token)).toEqual({ sats: 40, pending: true });
    // the same token again while it waits is still one
    expect(await purse.take(token)).toEqual({ sats: 40, pending: true });
  } finally {
    restore();
  }
  expect(kinds()).toEqual(["receive"]);
  expect(await purse.balances()).toEqual({});

  // the mint is back
  expect(await purse.retryPending()).toBe(40);
  expect(await purse.balances()).toEqual({ [MINT]: 40 });
  expect(kinds()).toEqual([]);

  // core replays the same token: the mint says spent, nothing is added or kept
  await expect(purse.take(token)).rejects.toThrow();
  expect(await purse.balances()).toEqual({ [MINT]: 40 });
  expect(kinds()).toEqual([]);
  expect(written).toEqual([{ direction: "in", sats: 40 }]);
  expect(await kit.coinStates(held, MINT)).toEqual(held.map(() => "UNSPENT"));
});

it("drops a waiting token the mint says was spent elsewhere, and tries it no more", async () => {
  const token = await kit.mintToken(16);
  const restore = cutOff(MINT);
  try {
    expect((await purse.take(token)).pending).toBe(true);
  } finally {
    restore();
  }
  // its sender spent it before the mint came back
  expect(await kit.redeem(token)).toBe(16);

  expect(await purse.retryPending()).toBe(0);
  expect(kinds()).toEqual([]);
  expect(await purse.balances()).toEqual({});
});

it("throws and keeps nothing when the mint refuses the token", async () => {
  const token = await kit.mintToken(8);
  await kit.redeem(token); // spent before it ever reaches this wallet
  await expect(purse.take(token)).rejects.toThrow();
  expect(kinds()).toEqual([]);
});

it("claims nothing for a token another tab settled while this one waited for the lock", async () => {
  const token = await kit.mintToken(24);
  let release!: () => void;
  const busy = new Promise<void>((r) => (release = r));
  // another tab holds the account's lock
  const other = navigator.locks.request(walletLock("alice"), () => busy);
  const took = purse.take(token);
  await vi.waitFor(async () => {
    const { pending = [] } = await navigator.locks.query();
    expect(pending).toHaveLength(1);
  });
  // ...and takes the token in: its retry swapped it and dropped the record
  expect(await kit.redeem(token)).toBe(24);
  journal.list("alice").forEach((r) => journal.remove(r.id));
  release();
  await other;

  // taken in or found spent there: this one cannot tell, so it says neither
  await expect(took).rejects.toThrow("settled elsewhere");
  expect(written).toEqual([]);
});

it("stops waiting for a token whose lost swap answer recovery restores", async () => {
  const token = await kit.mintToken(32);
  const restore = dropAfterSwap(MINT);
  try {
    expect(await purse.take(token)).toEqual({ sats: 32, pending: true });
  } finally {
    restore();
  }
  expect(kinds().sort()).toEqual(["receive", "swap"]);

  await new RecoveryHost({ journal, locks: navigator.locks }).settle(
    "alice",
    (mintUrl) => (add, remove) => coins.change("alice", mintUrl, add, remove)
  );
  expect(await purse.balances()).toEqual({ [MINT]: 32 });
  expect(kinds()).toEqual([]);
});
