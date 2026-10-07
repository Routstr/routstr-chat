// Every deposit quote the wallet makes is in the book before it is paid, and recovery claims it
// once the mint says paid, whoever made it and whether they gave up (kit mints, FakeWallet pays).
import { beforeEach, expect, it, vi } from "vitest";
import { getKit } from "@/tests/kit";
import { Journal, memoryStorage } from "@/features/book/journal";
import { RecoveryHost } from "@/features/book/recovery";
import { payWithNWC } from "@/lib/nwcPayment";
import { createPurse, type Purse } from "../purse";
import type { Coin, CoinStore } from "../ports";

// a connected NWC wallet whose answer to the payment never arrives
vi.mock("@getalby/bitcoin-connect-react", () => ({
  getConnectorConfig: () => ({ connectorType: "nwc.generic" }),
  requestProvider: async () => ({
    sendPayment: async () => {
      throw new Error("connection lost after paying");
    },
  }),
}));

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
let coins: CoinStore;
let purse: Purse;

beforeEach(() => {
  held = [];
  claimed = [];
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
    activity: { record: () => undefined },
    journal,
    locks: navigator.locks,
  });
});

let claimed: number[] = [];
const recover = () =>
  new RecoveryHost({
    journal,
    locks: navigator.locks,
    claimed: (_, proofs) =>
      void claimed.push(proofs.reduce((s, p) => s + p.amount, 0)),
  }).settle(
    "alice",
    (mintUrl) => (add, remove) => coins.change("alice", mintUrl, add, remove)
  );
const kinds = () => journal.list("alice").map((r) => r.kind);
const paid = async (quoteId: string) => {
  await vi.waitFor(
    async () => {
      const { state } = await (
        await kit.walletAt(MINT)
      ).checkMintQuote(quoteId);
      expect(state).toBe("PAID");
    },
    { timeout: 10_000 }
  );
};

it("claims an NWC refill whose wallet paid but never answered", async () => {
  const result = await payWithNWC(20, MINT, purse);
  expect(result.success).toBe(false);
  const [quote] = journal.list("alice");
  expect(quote?.kind).toBe("quote");
  await paid((quote as { quoteId: string }).quoteId);

  await recover();
  expect(await purse.balances()).toEqual({ [MINT]: 20 });
  expect(kinds()).toEqual([]);
  // and its activity is written by recovery, the one that claimed it
  expect(claimed).toEqual([20]);
});

it("claims a deposit whose own claim failed, on the next recovery pass", async () => {
  const { quoteId } = await purse.deposit(MINT, 12);
  expect(kinds()).toEqual(["quote"]);
  await paid(quoteId);

  const restore = cutOff(MINT);
  try {
    await expect(purse.claim(MINT, quoteId)).rejects.toThrow();
  } finally {
    restore();
  }
  expect(kinds()).toEqual(["quote"]);

  await recover();
  expect(await purse.balances()).toEqual({ [MINT]: 12 });
  expect(kinds()).toEqual([]);
  // the screen's own claim, later, finds it claimed
  expect(await purse.claim(MINT, quoteId)).toBe(0);
});
