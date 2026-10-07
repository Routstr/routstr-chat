// Deposits claimed through the book at the kit's mints (no real sats): written down before the
// mint is asked, restored when its answer is lost, settled by recovery when the tab closed.
import { beforeEach, expect, it } from "vitest";
import { Mint, Wallet, type Proof } from "@cashu/cashu-ts";
import { getKit } from "@/tests/kit";
import { WalletExecutor } from "../executor";
import { Journal, memoryStorage } from "../journal";
import { RecoveryHost } from "../recovery";
import { saveOutputs, type MintRecord } from "../records";

const kit = getKit();
const MINT = kit.env.mintUrl;
const sum = (ps: Proof[]) => ps.reduce((s, p) => s + p.amount, 0);

async function paidQuote(amount: number, url = MINT, unit = "sat") {
  const wallet = new Wallet(new Mint(url), { unit });
  await wallet.loadMint();
  const quote = await wallet.createMintQuote(amount);
  for (let i = 0; i < 40; i++) {
    if ((await wallet.checkMintQuote(quote.quote)).state === "PAID") break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return { wallet, quote };
}

/** lets one request through to the mint, then loses its answer */
function loseAnswer(path: string) {
  const real = globalThis.fetch;
  let armed = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await real(input, init);
    if (armed && String(input).endsWith(path)) {
      armed = false;
      throw new TypeError("network error (answer lost on purpose)");
    }
    return res;
  }) as typeof fetch;
  return () => void (globalThis.fetch = real);
}

let journal: Journal;
let coins: Proof[];
const commit = async (add: Proof[], remove: Proof[]) => {
  const gone = new Set(remove.map((p) => p.secret));
  coins = coins
    .filter((p) => !gone.has(p.secret))
    .concat(add.filter((a) => !coins.some((p) => p.secret === a.secret)));
};
const executor = () =>
  new WalletExecutor({
    owner: "alice",
    journal,
    commitFor: () => commit,
    locks: navigator.locks,
  });

beforeEach(() => {
  journal = new Journal(memoryStorage());
  coins = [];
});

it("claims a paid deposit once, and a second claim finds it issued", async () => {
  const { quote } = await paidQuote(40);
  const got = await executor().claim(MINT, quote.quote);
  expect(got.unit).toBe("sat");
  expect(sum(got.proofs)).toBe(40);
  expect(sum(coins)).toBe(40);
  expect(journal.list("alice")).toEqual([]);

  expect((await executor().claim(MINT, quote.quote)).proofs).toEqual([]);
  expect(sum(coins)).toBe(40);
});

it("restores the coins when the mint's answer is lost", async () => {
  const { quote } = await paidQuote(24);
  const restore = loseAnswer("/v1/mint/bolt11");
  try {
    const got = await executor().claim(MINT, quote.quote);
    expect(sum(got.proofs)).toBe(24);
  } finally {
    restore();
  }
  expect(sum(coins)).toBe(24);
  expect(journal.list("alice")).toEqual([]);
  expect(await kit.coinStates(coins, MINT)).toEqual(coins.map(() => "UNSPENT"));
});

it.each([
  ["before the mint was asked", false],
  ["after the mint signed but before the answer was read", true],
])("recovery settles a claim the tab closed %s", async (_, asked) => {
  const { wallet, quote } = await paidQuote(16);
  const preview = await wallet.prepareMint("bolt11", 16, quote.quote, {
    keysetId: wallet.keysetId,
  });
  const record: MintRecord = {
    v: 1,
    kind: "mint",
    id: "closed",
    owner: "alice",
    mintUrl: MINT,
    unit: "sat",
    createdAt: Date.now(),
    keysetId: preview.keysetId,
    quoteId: quote.quote,
    amount: 16,
    outputs: saveOutputs(preview.outputData),
  };
  journal.put(record);
  if (asked) await wallet.completeMint(preview); // its coins never reached the wallet

  await new RecoveryHost({ journal, locks: navigator.locks }).settle(
    "alice",
    () => commit
  );
  expect(sum(coins)).toBe(16);
  expect(journal.list("alice")).toEqual([]);
});

it("claims an msat deposit in msat: a 50 sat invoice gives 50 sats", async () => {
  const { quote } = await paidQuote(50_000, kit.env.msatMintUrl, "msat");
  const got = await executor().claim(kit.env.msatMintUrl, quote.quote);
  expect(got.unit).toBe("msat");
  expect(sum(got.proofs)).toBe(50_000);
});
