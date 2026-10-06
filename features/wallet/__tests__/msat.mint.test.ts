// At a mint that offers msat: what Send shows is in sats, and the book pays the msat quote.
import { Mint, Wallet, type Proof } from "@cashu/cashu-ts";
import { describe, expect, it } from "vitest";
import { getKit } from "@/tests/kit";
import { WalletExecutor } from "@/features/book/executor";
import { Journal, memoryStorage } from "@/features/book/journal";
import { quoteInSats } from "@/lib/cashuLightning";
import { toSats } from "../purse";

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
});
