// A token received while its mint cannot be reached is the wallet's: written to the book before
// the mint is asked, landed once the mint answers, and never counted twice.
import { getEncodedTokenV4, Mint, Wallet } from "@cashu/cashu-ts";
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

/** the mint answers every swap as nutshell answers a passing failure: 400, code 0 */
function failSwaps(url: string) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = input instanceof Request ? input.url : String(input);
    if (target.startsWith(url) && target.endsWith("/v1/swap")) {
      return new Response(
        JSON.stringify({ detail: "database is locked", code: 0 }),
        { status: 400 }
      );
    }
    return real(input, init);
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

it("says a pasted token whose mint cannot be reached is kept, not received", async () => {
  const token = await kit.mintToken(24);
  const restore = cutOff(MINT);
  try {
    expect(await purse.receive(token)).toEqual({ sats: 24, pending: true });
  } finally {
    restore();
  }
  expect(await purse.balances()).toEqual({});
  expect(written).toEqual([]);
  expect(await purse.retryPending()).toBe(24);
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

it("keeps a waiting token through a passing mint failure, and lands it after", async () => {
  const token = await kit.mintToken(16);
  const restore = cutOff(MINT);
  try {
    expect((await purse.take(token)).pending).toBe(true);
  } finally {
    restore();
  }
  // the mint is back but fails for now: that says nothing of the token
  const unfail = failSwaps(MINT);
  try {
    expect(await purse.retryPending()).toBe(0);
  } finally {
    unfail();
  }
  expect(kinds()).toEqual(["receive"]);

  expect(await purse.retryPending()).toBe(16);
  expect(kinds()).toEqual([]);
  expect(await purse.balances()).toEqual({ [MINT]: 16 });
});

it("keeps the new proofs of a token that shares some with a waiting one, and lands both", async () => {
  // a sender wallet took back an unclaimed send and put its proofs in a bigger one
  const wallet = new Wallet(new Mint(MINT));
  await wallet.loadMint();
  const first = await kit.mintToken(8);
  const more = await kit.mintToken(16);
  const bigger = getEncodedTokenV4({
    mint: MINT,
    unit: "sat",
    proofs: [
      ...wallet.decodeToken(first).proofs,
      ...wallet.decodeToken(more).proofs,
    ],
  });

  const restore = cutOff(MINT);
  try {
    expect(await purse.take(first)).toEqual({ sats: 8, pending: true });
    expect(await purse.take(bigger)).toEqual({ sats: 24, pending: true });
    // the same tokens again add nothing
    await purse.take(bigger);
    await purse.take(first);
  } finally {
    restore();
  }
  expect(kinds()).toEqual(["receive", "receive"]);

  expect(await purse.retryPending()).toBe(24);
  expect(kinds()).toEqual([]);
  expect(await purse.balances()).toEqual({ [MINT]: 24 });
});

it("lands a waiting token once when two rounds try it at once, and calls neither a refusal", async () => {
  const token = await kit.mintToken(12);
  const restore = cutOff(MINT);
  try {
    expect((await purse.take(token)).pending).toBe(true);
  } finally {
    restore();
  }
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const rounds = await Promise.all([
      purse.retryPending(),
      purse.retryPending(),
    ]);
    expect(rounds.sort()).toEqual([0, 12]);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
  expect(await purse.balances()).toEqual({ [MINT]: 12 });
});

it("throws and keeps nothing when the mint refuses the token", async () => {
  const token = await kit.mintToken(8);
  await kit.redeem(token); // spent before it ever reaches this wallet
  await expect(purse.take(token)).rejects.toThrow();
  expect(kinds()).toEqual([]);
});

it("throws and keeps nothing for a token whose proofs the mint cannot verify", async () => {
  const wallet = new Wallet(new Mint(MINT));
  await wallet.loadMint();
  const real = wallet.decodeToken(await kit.mintToken(8)).proofs;
  // a proof whose signature is someone else's: never receivable
  const other = wallet.decodeToken(await kit.mintToken(8)).proofs;
  const forged = getEncodedTokenV4({
    mint: MINT,
    unit: "sat",
    proofs: [{ ...real[0], C: other[0].C }],
  });
  await expect(purse.take(forged)).rejects.toThrow();
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
