// At a mint that offers msat: what Send shows is in sats, and the book pays the msat quote.
import { getEncodedTokenV4, Mint, Wallet, type Proof } from "@cashu/cashu-ts";
import { describe, expect, it } from "vitest";
import { getKit } from "@/tests/kit";
import { WalletExecutor } from "@/features/book/executor";
import { Journal, memoryStorage } from "@/features/book/journal";
import { quoteInSats } from "@/lib/cashuLightning";
import { createPurse, toSats } from "../purse";
import type { Coin, CoinStore } from "../ports";

const kit = getKit();
const MSAT_MINT = kit.env.msatMintUrl;
const sum = (ps: Proof[]) => ps.reduce((s, p) => s + p.amount, 0);

describe("a mint that offers msat", () => {
  it("quotes an invoice in sats, and the book pays it from msat coins", async () => {
    const wallet = new Wallet(new Mint(MSAT_MINT), { unit: "msat" });
    await wallet.loadMint();
    const deposit = await wallet.createMintQuote(50_000);
    for (let i = 0; i < 40; i++) {
      if ((await wallet.checkMintQuote(deposit.quote)).state === "PAID") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    let coins = await wallet.mintProofs(50_000, deposit.quote);
    expect(toSats(sum(coins), "msat")).toBe(50);

    const quote = await wallet.createMeltQuote(await kit.invoice(8));
    expect(quote.unit).toBe("msat");
    expect(quote.amount).toBe(8000);
    const shown = quoteInSats(quote);
    expect(shown.amount).toBe(8);
    expect(shown.feeReserve).toBe(Math.ceil(quote.fee_reserve / 1000));

    const journal = new Journal(memoryStorage());
    const executor = new WalletExecutor({
      owner: "alice",
      journal,
      locks: navigator.locks,
      commitFor: () => async (add, remove) => {
        const gone = new Set(remove.map((p) => p.secret));
        coins = coins.filter((p) => !gone.has(p.secret)).concat(add);
      },
    });
    const paid = await executor.pay(MSAT_MINT, quote, coins);
    expect(paid.state).toBe("paid");
    // 8 sats left the wallet, plus no more than the fee reserve
    const spent = 50_000 - sum(coins);
    expect(spent).toBeGreaterThanOrEqual(8000);
    expect(spent).toBeLessThanOrEqual(8000 + quote.fee_reserve);
    expect(journal.list("alice")).toEqual([]);
  });

  it("asks an invoice for the sats Add shows, and the purse claims those sats", async () => {
    let held: Coin[] = [];
    const coins: CoinStore = {
      async change(owner, mintUrl, add) {
        held = held.concat(
          add.map((p) => ({ ...p, owner, mintUrl, unit: "msat" }))
        );
      },
      coins: async () => held,
      activeMint: () => MSAT_MINT,
      subscribe: () => () => undefined,
    };
    const written: { direction: string; sats: number }[] = [];
    const purse = createPurse("alice", {
      coins,
      activity: { record: (_, e) => void written.push(e) },
      journal: new Journal(memoryStorage()),
      locks: navigator.locks,
    });
    const invoice = await purse.deposit(MSAT_MINT, 50);
    const mint = new Mint(MSAT_MINT);
    let quote = await mint.checkMintQuoteBolt11(invoice.quoteId);
    expect(quote.unit).toBe("msat");
    expect(quote.amount).toBe(50_000);
    for (let i = 0; i < 40 && quote.state !== "PAID"; i++) {
      await new Promise((r) => setTimeout(r, 250));
      quote = await mint.checkMintQuoteBolt11(invoice.quoteId);
    }

    expect(await purse.claim(MSAT_MINT, invoice.quoteId)).toBe(50);
    expect(await purse.balances()).toEqual({ [MSAT_MINT]: 50 });
    expect(written).toEqual([{ direction: "in", sats: 50 }]);
  });

  it("takes in a sat token there, in sats, as most wallets send", async () => {
    const wallet = new Wallet(new Mint(MSAT_MINT), { unit: "sat" });
    await wallet.loadMint();
    const deposit = await wallet.createMintQuote(8);
    for (let i = 0; i < 40; i++) {
      if ((await wallet.checkMintQuote(deposit.quote)).state === "PAID") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const proofs = await wallet.mintProofs(8, deposit.quote);
    const token = getEncodedTokenV4({ mint: MSAT_MINT, unit: "sat", proofs });

    const journal = new Journal(memoryStorage());
    const executor = new WalletExecutor({
      owner: "alice",
      journal,
      locks: navigator.locks,
      commitFor: () => async () => undefined,
    });
    const taken = await executor.take(token);
    expect(taken.pending).toBe(false);
    expect(taken.unit).toBe("sat");
    expect(sum(taken.proofs)).toBe(8);
    expect(journal.list("alice")).toEqual([]);
  });
});
