// A token another record still holds (an API key, an X-Cashu record) is redeemed mint first:
// it lands, or nothing of it is kept and the reason is said, so that record stays the token's.
import { getEncodedToken } from "@cashu/cashu-ts";
import { beforeEach, expect, it } from "vitest";
import { getKit } from "@/tests/kit";
import { RedeemError } from "@/features/book/executor";
import { Journal, memoryStorage } from "@/features/book/journal";
import { createPurse, type Purse } from "../purse";
import type { Coin } from "../ports";

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

let held: Coin[];
let journal: Journal;
let written: { direction: string; sats: number }[];
let purse: Purse;

beforeEach(() => {
  held = [];
  written = [];
  journal = new Journal(memoryStorage());
  purse = createPurse("alice", {
    coins: {
      async change(owner, mintUrl, add, remove) {
        const gone = new Set(remove.map((p) => p.secret));
        held = held
          .filter((c) => !gone.has(c.secret))
          .concat(add.map((p) => ({ ...p, owner, mintUrl, unit: "sat" })));
      },
      coins: async () => held,
      activeMint: () => MINT,
      subscribe: () => () => undefined,
    },
    activity: { record: (_, e) => void written.push(e) },
    journal,
    locks: navigator.locks,
  });
});

const reason = (promise: Promise<unknown>) =>
  promise.then(
    () => "landed",
    (error) => (error instanceof RedeemError ? error.reason : String(error))
  );

it("lands the token's sats, and the same token again gives them again without a second swap", async () => {
  const token = await kit.mintToken(16);
  expect(await purse.redeem(token)).toBe(16);
  expect(await purse.balances()).toEqual({ [MINT]: 16 });
  expect(journal.list("alice")).toEqual([]);

  expect(await purse.redeem(token)).toBe(16);
  expect(await purse.balances()).toEqual({ [MINT]: 16 });
  expect(written).toEqual([{ direction: "in", sats: 16 }]);
});

it("keeps nothing when the mint cannot be reached, and the token redeems once it can", async () => {
  const token = await kit.mintToken(12);
  const restore = cutOff(MINT);
  try {
    expect(await reason(purse.redeem(token))).toBe("unreachable");
  } finally {
    restore();
  }
  // no receive record waits to take it later: the record holding it keeps it
  expect(journal.list("alice")).toEqual([]);
  expect(await purse.balances()).toEqual({});

  expect(await purse.redeem(token)).toBe(12);
});

it("says spent for a token the mint already took, and keeps nothing", async () => {
  const token = await kit.mintToken(8);
  await kit.redeem(token);
  expect(await reason(purse.redeem(token))).toBe("spent");
  expect(journal.list("alice")).toEqual([]);
  expect(written).toEqual([]);
});

it("says refused for a token the mint will not take otherwise, and keeps nothing", async () => {
  const [a] = await kit.mintProofs(8);
  const [b] = await kit.mintProofs(8);
  // a's secret with b's signature: the mint cannot verify it
  const token = getEncodedToken({
    mint: MINT,
    unit: "sat",
    proofs: [{ ...a, C: b.C }],
  });
  expect(await reason(purse.redeem(token))).toBe("refused");
  expect(journal.list("alice")).toEqual([]);
  expect(written).toEqual([]);
});
