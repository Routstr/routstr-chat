/**
 * Lightning payments against a real mint (no real sats). Skipped unless a test mint is given:
 *
 *   CASHU_TEST_MINT=http://127.0.0.1:13338        nutshell, MINT_BACKEND_BOLT11_SAT=FakeWallet
 *   CASHU_TEST_INVOICE_MINT=http://127.0.0.1:13339 a second FakeWallet mint, only to issue invoices
 *   CASHU_TEST_PAY_STATE=SETTLED|FAILED|PENDING    the first mint's FAKEWALLET_PAY_INVOICE_STATE
 *   (run the mints with MINT_INPUT_FEE_PPK=0 so the sums below are exact)
 *
 * Paying an invoice from another mint makes the first mint pay it through its fake Lightning
 * backend, so the pay state decides the outcome.
 *
 * A PENDING run can hand its journal to a second run (CASHU_TEST_HANDOFF=<file>); with the first
 * mint restarted on the same database with FAKEWALLET_PAYMENT_STATE=SETTLED or FAILED, the second
 * run (CASHU_TEST_RECONCILE=SETTLED|FAILED) checks that the reconciler settles it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import { CheckStateEnum, Mint, Wallet, getEncodedTokenV4, type Proof } from "@cashu/cashu-ts";

const MINT = process.env.CASHU_TEST_MINT;
const INVOICE_MINT = process.env.CASHU_TEST_INVOICE_MINT;
const PAY_STATE = process.env.CASHU_TEST_PAY_STATE ?? "SETTLED";
const HANDOFF = process.env.CASHU_TEST_HANDOFF;
const RECONCILE = process.env.CASHU_TEST_RECONCILE;

// the wallet store and the journal both live in localStorage
const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size;
    },
    clear: () => memory.clear(),
  },
});

type Lightning = typeof import("@/lib/cashuLightning");
type Journal = typeof import("@/lib/meltJournal");
let lightning: Lightning;
let journal: Journal;

const sum = (ps: Proof[]) => ps.reduce((s, p) => s + p.amount, 0);

async function funded(amount: number): Promise<Proof[]> {
  const wallet = new Wallet(new Mint(MINT!), { unit: "sat" });
  await wallet.loadMint();
  const quote = await wallet.createMintQuote(amount);
  for (let i = 0; i < 40; i++) {
    if ((await wallet.checkMintQuote(quote.quote)).state === "PAID") break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return wallet.mintProofs(amount, quote.quote);
}

async function invoice(amount: number): Promise<string> {
  const wallet = new Wallet(new Mint(INVOICE_MINT!), { unit: "sat" });
  await wallet.loadMint();
  return (await wallet.createMintQuote(amount)).request;
}

async function states(ps: Proof[]) {
  const wallet = new Wallet(new Mint(MINT!), { unit: "sat" });
  await wallet.loadMint();
  return (await wallet.checkProofsStates(ps)).map((s) => s.state);
}

/** a wallet store the payment commits into, as the app's updateProofs does */
function store(initial: Proof[]) {
  let proofs = [...initial];
  return {
    get: () => proofs,
    commit: async (add: Proof[], remove: Proof[]) => {
      const gone = new Set(remove.map((p) => p.secret));
      proofs = proofs.filter((p) => !gone.has(p.secret)).concat(add.filter((a) => !proofs.some((p) => p.secret === a.secret)));
    },
  };
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

describe.skipIf(!MINT || !INVOICE_MINT)(`payMeltQuote against a real mint (${PAY_STATE})`, () => {
  beforeAll(async () => {
    lightning = await import("@/lib/cashuLightning");
    journal = await import("@/lib/meltJournal");
    // melt quotes are kept per mint in the wallet store
    (await import("@/features/wallet/state/cashuStore")).useCashuStore.getState().addMint(MINT!);
  });

  it("settles the payment and never holds a coin in zero places", async () => {
    // one 64-sat coin: paying 10 + fee reserve needs a swap first
    const wallet = store(await funded(64));
    const quote = await lightning.createMeltQuote(MINT!, await invoice(10));
    const result = await lightning.payMeltQuote(MINT!, quote.quote, wallet.get(), wallet.commit);
    const held = sum(journal.listEntries().flatMap((e) => (e.kind === "melt" ? e.inputs : [])));

    if (PAY_STATE === "SETTLED") {
      expect(result.state).toBe("paid");
      expect(journal.listEntries()).toHaveLength(0);
      expect(sum(wallet.get())).toBeGreaterThanOrEqual(64 - 10 - quote.fee_reserve);
    } else if (PAY_STATE === "FAILED") {
      expect(result.state).toBe("failed");
      expect(journal.listEntries()).toHaveLength(0);
      expect(sum(wallet.get())).toBe(64);
    } else {
      expect(result.state).toBe("pending");
      expect(held).toBe(10 + quote.fee_reserve);
      // what is in the wallet plus what the journal holds is still everything
      expect(sum(wallet.get()) + held).toBe(64);
    }
    expect(new Set(await states(wallet.get()))).toEqual(new Set([CheckStateEnum.UNSPENT]));
    if (PAY_STATE === "PENDING" && HANDOFF) fs.writeFileSync(HANDOFF, JSON.stringify({ entries: journal.listEntries(), wallet: wallet.get() }));
    for (const e of journal.listEntries()) journal.removeEntry(e.id);
  });

  it.skipIf(PAY_STATE !== "SETTLED")("gets the coins back when the swap's answer is lost", async () => {
    const wallet = store(await funded(64));
    const quote = await lightning.createMeltQuote(MINT!, await invoice(10));
    const restore = loseAnswer("/v1/swap");
    await expect(lightning.payMeltQuote(MINT!, quote.quote, wallet.get(), wallet.commit)).rejects.toThrow();
    restore();
    // the mint swapped: the new coins came back from restore, worth what went in
    expect(journal.listEntries()).toHaveLength(0);
    expect(sum(wallet.get())).toBe(64);
    expect(new Set(await states(wallet.get()))).toEqual(new Set([CheckStateEnum.UNSPENT]));
  });

  it.skipIf(PAY_STATE !== "SETTLED")("settles a paid melt and its change when the melt's answer is lost", async () => {
    const wallet = store(await funded(64));
    const quote = await lightning.createMeltQuote(MINT!, await invoice(10));
    const restore = loseAnswer("/v1/melt/bolt11");
    const result = await lightning.payMeltQuote(MINT!, quote.quote, wallet.get(), wallet.commit);
    restore();
    expect(result.state).toBe("paid");
    expect(journal.listEntries()).toHaveLength(0);
    // the fee reserve the payment did not use came back as change
    expect(sum(wallet.get())).toBeGreaterThanOrEqual(64 - 10 - quote.fee_reserve);
    expect(new Set(await states(wallet.get()))).toEqual(new Set([CheckStateEnum.UNSPENT]));
  });

  it.skipIf(PAY_STATE !== "SETTLED")("gives the good coins back when the mint refuses a melt for a stale one", async () => {
    const quote = await lightning.createMeltQuote(MINT!, await invoice(10));
    // coins that pay the exact amount, so no swap; one of them was already spent elsewhere
    const coins = await funded(quote.amount + quote.fee_reserve);
    const stale = coins.reduce((a, b) => (a.amount < b.amount ? a : b));
    const other = new Wallet(new Mint(MINT!), { unit: "sat" });
    await other.loadMint();
    await other.receive(getEncodedTokenV4({ mint: MINT!, proofs: [stale], unit: "sat" }));
    const wallet = store(coins);
    const result = await lightning.payMeltQuote(MINT!, quote.quote, wallet.get(), wallet.commit);
    expect(result.state).toBe("failed");
    expect(journal.listEntries()).toHaveLength(0);
    expect(sum(wallet.get())).toBe(sum(coins) - stale.amount);
    expect(new Set(await states(wallet.get()))).toEqual(new Set([CheckStateEnum.UNSPENT]));
  });

  it.skipIf(PAY_STATE !== "SETTLED")("never adds back a coin the swap did not touch", async () => {
    // the app's store publishes every added coin in a new NIP-60 event, so a re-added coin is duplicated
    const coins = [...(await funded(64)), ...(await funded(32))];
    const wallet = store(coins);
    const added: Proof[] = [];
    const quote = await lightning.createMeltQuote(MINT!, await invoice(10));
    await lightning.payMeltQuote(MINT!, quote.quote, wallet.get(), (add, remove) => {
      added.push(...add);
      return wallet.commit(add, remove);
    });
    expect(added.filter((a) => coins.some((c) => c.secret === a.secret))).toEqual([]);
  });
});

describe.skipIf(!MINT || !RECONCILE || !HANDOFF)(`reconcileJournal after a PENDING payment turns ${RECONCILE}`, () => {
  it("settles the payment from the mint's answers and returns every coin it can", async () => {
    lightning = await import("@/lib/cashuLightning");
    journal = await import("@/lib/meltJournal");
    const saved = JSON.parse(fs.readFileSync(HANDOFF!, "utf8"));
    for (const e of saved.entries) journal.putEntry({ ...e, createdAt: 0 });
    const wallet = store(saved.wallet);
    const held = sum(saved.entries.flatMap((e: { inputs: Proof[] }) => e.inputs));
    const outcomes = await lightning.reconcileJournal(() => wallet.commit);

    expect([...outcomes.values()]).toEqual([RECONCILE === "SETTLED" ? "paid" : "failed"]);
    expect(journal.listEntries()).toHaveLength(0);
    if (RECONCILE === "FAILED") expect(sum(wallet.get())).toBe(sum(saved.wallet) + held);
    else expect(sum(wallet.get())).toBeGreaterThanOrEqual(sum(saved.wallet));
    expect(new Set(await states(wallet.get()))).toEqual(new Set([CheckStateEnum.UNSPENT]));
  });
});
