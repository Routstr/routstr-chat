/**
 * The wallet book against a real mint (no real sats): the shared kit's mints, or a run's own:
 *
 *   CASHU_TEST_MINT=http://127.0.0.1:13358         nutshell, MINT_BACKEND_BOLT11_SAT=FakeWallet
 *   CASHU_TEST_INVOICE_MINT=http://127.0.0.1:13359 a second FakeWallet mint, only to issue invoices
 *   CASHU_TEST_PAY_STATE=SETTLED|FAILED|PENDING     the first mint's FAKEWALLET_PAY_INVOICE_STATE
 *   (run the mints with MINT_INPUT_FEE_PPK=0 so the sums below are exact)
 *
 * A PENDING run can hand its journal to a second run (CASHU_TEST_HANDOFF=<file>); with the first
 * mint restarted on the same database with FAKEWALLET_PAYMENT_STATE=SETTLED or FAILED, the second
 * run (CASHU_TEST_RECONCILE=SETTLED|FAILED) checks that recovery settles it.
 *
 * These are main's Lightning journal tests (0732348 and its fixes), rewritten for the book, plus
 * the rules v2 adds: token send and receive journaled, owners, one pass across tabs.
 */
import fs from "fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CheckStateEnum,
  getEncodedTokenV4,
  Mint,
  Wallet,
  type Proof,
} from "@cashu/cashu-ts";
import { getKit } from "@/tests/kit";
import { WalletExecutor } from "../executor";
import { Journal, memoryStorage, storedKeys } from "../journal";
import { openWallet } from "../mint";
import { RecoveryHost } from "../recovery";
import type { BookRecord, MeltRecord } from "../records";
import { settleMelt } from "../settle";

// the shared kit's mints, unless a run names its own (the FAILED and PENDING modes)
const MINT = process.env.CASHU_TEST_MINT ?? getKit().env.mintUrl;
const INVOICE_MINT =
  process.env.CASHU_TEST_INVOICE_MINT ?? getKit().env.invoiceMintUrl;
const PAY_STATE = process.env.CASHU_TEST_PAY_STATE ?? "SETTLED";
const HANDOFF = process.env.CASHU_TEST_HANDOFF;
const RECONCILE = process.env.CASHU_TEST_RECONCILE;
const SETTLED = PAY_STATE === "SETTLED";

const sum = (ps: Proof[]) => ps.reduce((s, p) => s + p.amount, 0);

async function mintWallet(url = MINT) {
  const wallet = new Wallet(new Mint(url), { unit: "sat" });
  await wallet.loadMint();
  return wallet;
}

async function funded(amount: number): Promise<Proof[]> {
  const wallet = await mintWallet();
  const quote = await wallet.createMintQuote(amount);
  for (let i = 0; i < 40; i++) {
    if ((await wallet.checkMintQuote(quote.quote)).state === "PAID") break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return wallet.mintProofs(amount, quote.quote);
}

async function invoice(amount: number): Promise<string> {
  return (await (await mintWallet(INVOICE_MINT)).createMintQuote(amount))
    .request;
}

async function meltQuote(amount: number) {
  return (await mintWallet()).createMeltQuote(await invoice(amount));
}

async function states(ps: Proof[]) {
  return new Set(
    (await (await mintWallet()).checkProofsStates(ps)).map((s) => s.state)
  );
}

/** an account's wallet: proofs matched by secret, as the app's store does (73156d4) */
function walletStore(initial: Proof[] = []) {
  let proofs = [...initial];
  return {
    get: () => proofs,
    commit: async (add: Proof[], remove: Proof[]) => {
      const gone = new Set(remove.map((p) => p.secret));
      proofs = proofs
        .filter((p) => !gone.has(p.secret))
        .concat(add.filter((a) => !proofs.some((p) => p.secret === a.secret)));
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

let journal: Journal;
let storage: ReturnType<typeof memoryStorage>;
const held = (records: BookRecord[]) =>
  records.reduce((s, r) => {
    if (r.kind === "token") return s + r.amount;
    // a deposit being claimed holds none of our coins yet
    if (r.kind === "mint") return s;
    return (
      s + sum(r.kind === "melt" || r.kind === "swap" ? r.inputs : r.proofs)
    );
  }, 0);

function executorFor(wallet: ReturnType<typeof walletStore>, owner = "alice") {
  return new WalletExecutor({
    owner,
    journal,
    commitFor: () => wallet.commit,
    locks: navigator.locks,
  });
}

function recovery() {
  return new RecoveryHost({ journal, locks: navigator.locks });
}

beforeEach(() => {
  storage = memoryStorage();
  journal = new Journal(storage);
});

describe(`the book against a real mint (${PAY_STATE})`, () => {
  it("pays and never holds a coin in zero places", async () => {
    // one 64-sat coin: paying 10 + fee reserve needs a swap first
    const wallet = walletStore(await funded(64));
    const quote = await meltQuote(10);
    const result = await executorFor(wallet).pay(MINT, quote, wallet.get());

    if (PAY_STATE === "SETTLED") {
      expect(result.state).toBe("paid");
      expect(journal.list("alice")).toEqual([]);
      // the unused fee reserve came back as change
      expect(sum(wallet.get())).toBeGreaterThan(64 - 10 - quote.fee_reserve);
    } else if (PAY_STATE === "FAILED") {
      expect(result.state).toBe("failed");
      expect(journal.list("alice")).toEqual([]);
      expect(sum(wallet.get())).toBe(64);
    } else {
      expect(result.state).toBe("pending");
      // what the wallet holds plus what the journal holds is still everything
      expect(sum(wallet.get()) + held(journal.list("alice"))).toBe(64);
      expect(journal.list("alice").map((r) => r.kind)).toEqual(["melt"]);
    }
    expect(await states(wallet.get())).toEqual(
      new Set([CheckStateEnum.UNSPENT])
    );
    if (PAY_STATE === "PENDING" && HANDOFF) {
      fs.writeFileSync(
        HANDOFF,
        JSON.stringify({
          records: journal.list("alice"),
          wallet: wallet.get(),
        })
      );
    }
  });

  it.skipIf(!SETTLED)(
    "gets the coins back when a payment's swap answer is lost",
    async () => {
      const wallet = walletStore(await funded(64));
      const quote = await meltQuote(10);
      const restore = loseAnswer("/v1/swap");
      await expect(
        executorFor(wallet).pay(MINT, quote, wallet.get())
      ).rejects.toThrow();
      restore();
      // the mint swapped (f3e901b: coins checked first): the new coins came back from restore
      expect(journal.list("alice")).toEqual([]);
      expect(sum(wallet.get())).toBe(64);
      expect(await states(wallet.get())).toEqual(
        new Set([CheckStateEnum.UNSPENT])
      );
    }
  );

  it.skipIf(!SETTLED)(
    "gives the coins back when the quote was already paid by another payment",
    async () => {
      const quote = await meltQuote(10);
      const first = walletStore(await funded(64));
      expect(
        (await executorFor(first).pay(MINT, quote, first.get())).state
      ).toBe("paid");

      // the same quote paid again (a stale screen, a retry): the mint refuses it
      const second = walletStore(await funded(32));
      const result = await executorFor(second).pay(MINT, quote, second.get());
      expect(result.state).toBe("paid");
      expect(sum(second.get())).toBe(32);
      expect(await states(second.get())).toEqual(
        new Set([CheckStateEnum.UNSPENT])
      );
      expect(journal.list("alice")).toEqual([]);
    }
  );

  it.skipIf(!SETTLED)(
    "never stores a restored coin again once it is spent",
    async () => {
      const wallet = walletStore(await funded(64));
      // the melt record as it stood before the payment, as a pass cut short would find it again
      let melt: BookRecord | undefined;
      const executor = new WalletExecutor({
        owner: "alice",
        journal,
        commitFor: () => async (add, remove) => {
          melt ??= journal.list("alice").find((r) => r.kind === "melt");
          return wallet.commit(add, remove);
        },
        locks: navigator.locks,
      });
      const result = await executor.pay(
        MINT,
        await meltQuote(10),
        wallet.get()
      );
      expect(result.state).toBe("paid");
      expect(result.change.length).toBeGreaterThan(0);
      // the change is spent somewhere else
      await (
        await mintWallet()
      ).receive(
        getEncodedTokenV4({ mint: MINT, proofs: result.change, unit: "sat" })
      );

      const stored: Proof[] = [];
      const settled = await settleMelt(
        await openWallet(MINT),
        melt as MeltRecord,
        async (add) => void stored.push(...add),
        journal
      );
      expect(settled.state).toBe("paid");
      expect(stored).toEqual([]);
    }
  );

  it.skipIf(!SETTLED)(
    "settles a paid melt and its change when the melt's answer is lost",
    async () => {
      const wallet = walletStore(await funded(64));
      const quote = await meltQuote(10);
      const restore = loseAnswer("/v1/melt/bolt11");
      const result = await executorFor(wallet).pay(MINT, quote, wallet.get());
      restore();
      expect(result.state).toBe("paid");
      expect(journal.list("alice")).toEqual([]);
      // the unused fee reserve came back as change
      expect(sum(wallet.get())).toBeGreaterThan(64 - 10 - quote.fee_reserve);
    }
  );

  it.skipIf(!SETTLED)(
    "gives the good coins back when the mint refuses a melt for a stale one",
    async () => {
      // 9287eed: coins that pay the exact amount, so no swap; one was already spent elsewhere
      const quote = await meltQuote(10);
      const coins = await funded(quote.amount + quote.fee_reserve);
      const stale = coins.reduce((a, b) => (a.amount < b.amount ? a : b));
      await (
        await mintWallet()
      ).receive(
        getEncodedTokenV4({ mint: MINT, proofs: [stale], unit: "sat" })
      );
      const wallet = walletStore(coins);
      const result = await executorFor(wallet).pay(MINT, quote, wallet.get());
      expect(result.state).toBe("failed");
      expect(journal.list("alice")).toEqual([]);
      expect(sum(wallet.get())).toBe(sum(coins) - stale.amount);
    }
  );

  it.skipIf(!SETTLED)(
    "never adds back a coin a swap did not touch",
    async () => {
      // 4c0ff5a: each added coin is a new NIP-60 event, so a re-added coin is duplicated
      const coins = [...(await funded(64)), ...(await funded(32))];
      const wallet = walletStore(coins);
      const added: Proof[] = [];
      const executor = new WalletExecutor({
        owner: "alice",
        locks: navigator.locks,
        journal,
        commitFor: () => (add, remove) => {
          added.push(...add);
          return wallet.commit(add, remove);
        },
      });
      await executor.pay(MINT, await meltQuote(10), wallet.get());
      await executor.send(MINT, 5, wallet.get(), { track: true });
      expect(
        added.filter((a) => coins.some((c) => c.secret === a.secret))
      ).toEqual([]);
    }
  );

  it.skipIf(!SETTLED)(
    "writes every step down under the account that moves the money",
    async () => {
      const wallet = walletStore(await funded(64));
      const owners = new Set<string | undefined>();
      const kinds = new Set<string>();
      const executor = new WalletExecutor({
        owner: "alice",
        locks: navigator.locks,
        journal,
        commitFor: () => (add, remove) => {
          // every record on the device, whoever it names
          const all = storedKeys(storage).map(
            (k) => JSON.parse(storage.getItem(k)!) as BookRecord
          );
          all.forEach((r) => (owners.add(r.owner), kinds.add(r.kind)));
          return wallet.commit(add, remove);
        },
      });
      await executor.pay(MINT, await meltQuote(10), wallet.get());
      // swap and melt were each written down before their mint call
      expect([...owners]).toEqual(["alice"]);
      expect(kinds).toEqual(new Set(["swap", "landed", "melt"]));
    }
  );

  it.skipIf(!SETTLED)(
    "makes a token that is listed under its account until claimed",
    async () => {
      const wallet = walletStore(await funded(64));
      const token = await executorFor(wallet).send(MINT, 21, wallet.get(), {
        track: true,
      });

      expect(sum(wallet.get())).toBe(64 - 21);
      const [record] = journal.list("alice");
      expect(record).toMatchObject({
        kind: "token",
        token,
        amount: 21,
        unit: "sat",
      });
      expect(journal.list("bob")).toEqual([]);
      // the token is real: someone else can claim it
      const claimed = await (await mintWallet()).receive(token);
      expect(sum(claimed)).toBe(21);
    }
  );

  it.skipIf(!SETTLED)(
    "gets the coins back when a token send's swap answer is lost",
    async () => {
      const wallet = walletStore(await funded(64));
      const restore = loseAnswer("/v1/swap");
      await expect(
        executorFor(wallet).send(MINT, 21, wallet.get(), { track: true })
      ).rejects.toThrow();
      restore();
      expect(journal.list("alice")).toEqual([]);
      expect(sum(wallet.get())).toBe(64);
      expect(await states(wallet.get())).toEqual(
        new Set([CheckStateEnum.UNSPENT])
      );
    }
  );

  it.skipIf(!SETTLED)(
    "gets the coins back when a token send never reached the mint",
    async () => {
      const wallet = walletStore(await funded(64));
      const real = globalThis.fetch;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit
      ) => {
        if (String(input).endsWith("/v1/swap")) throw new TypeError("offline");
        return real(input, init);
      }) as typeof fetch;
      try {
        await expect(
          executorFor(wallet).send(MINT, 21, wallet.get(), { track: true })
        ).rejects.toThrow();
      } finally {
        globalThis.fetch = real;
      }
      // nothing was swapped, so the coins taken out for it come back as they were
      expect(sum(wallet.get())).toBe(64);
      expect(journal.list("alice")).toEqual([]);
    }
  );

  it.skipIf(!SETTLED)(
    "keeps a token listed until the SDK confirms it stored the token",
    async () => {
      // b06574f: a handoff that fails leaves the token for the person, never back in the wallet
      const wallet = walletStore(await funded(64));
      let during: BookRecord[] = [];
      await expect(
        executorFor(wallet).send(MINT, 21, wallet.get(), {
          handoff: async () => {
            during = journal.list("alice");
            throw new Error("SDK storage failed");
          },
        })
      ).rejects.toThrow("SDK storage failed");
      expect(during.map((r) => r.kind)).toEqual(["token"]);
      expect(sum(wallet.get())).toBe(64 - 21);

      // the SDK may have stored it after all, so recovery leaves it to the person
      await recovery().settle("alice", () => wallet.commit);
      expect(sum(wallet.get())).toBe(64 - 21);
      expect(journal.list("alice")).toMatchObject([
        { kind: "token", amount: 21 },
      ]);
    }
  );

  it.skipIf(!SETTLED)(
    "tells the mint only what it needs of each coin",
    async () => {
      // the app's store keeps more next to a coin: its NIP-60 event, its owner
      const tagged = (ps: Proof[]) =>
        ps.map((p) => ({ ...p, eventId: "e1", owner: "alice" }));
      const sent: { inputs: object[] }[] = [];
      const real = globalThis.fetch;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit
      ) => {
        if (/\/v1\/(swap|melt\/bolt11)$/.test(String(input))) {
          sent.push(JSON.parse(String(init?.body)));
        }
        return real(input, init);
      }) as typeof fetch;
      try {
        const wallet = walletStore(tagged(await funded(64)));
        await executorFor(wallet).send(MINT, 10, wallet.get());
        const quote = await meltQuote(8);
        await executorFor(wallet).pay(MINT, quote, tagged(wallet.get()));
      } finally {
        globalThis.fetch = real;
      }
      expect(sent.length).toBeGreaterThanOrEqual(2); // a swap and a melt
      for (const { inputs } of sent) {
        for (const input of inputs) {
          expect(Object.keys(input).sort()).toEqual([
            "C",
            "amount",
            "id",
            "secret",
          ]);
        }
      }
    }
  );

  it.skipIf(!SETTLED)("receives a token", async () => {
    const from = walletStore(await funded(32));
    const token = await executorFor(from, "bob").send(MINT, 16, from.get());
    const wallet = walletStore();
    const proofs = await executorFor(wallet).receive(token);
    expect(sum(proofs)).toBe(16);
    expect(sum(wallet.get())).toBe(16);
    expect(journal.list("alice")).toEqual([]);
    // swapped: the sender's coins are spent
    const [bobs] = journal.list("bob");
    expect(bobs).toBeUndefined();
  });

  it.skipIf(!SETTLED)(
    "gets a received token's coins when the swap answer is lost",
    async () => {
      const from = walletStore(await funded(32));
      const token = await executorFor(from, "bob").send(MINT, 16, from.get());
      const wallet = walletStore();
      const restore = loseAnswer("/v1/swap");
      // the mint swapped: the new coins come back from restore, so it went through
      const received = await executorFor(wallet).receive(token);
      restore();
      expect(sum(received)).toBe(16);
      expect(sum(wallet.get())).toBe(16);
      expect(journal.list("alice")).toEqual([]);
    }
  );

  it.skipIf(!SETTLED)(
    "keeps received coins the wallet could not store, and stores them later",
    async () => {
      const from = walletStore(await funded(32));
      const token = await executorFor(from, "bob").send(MINT, 16, from.get());
      const wallet = walletStore();
      const failing = new WalletExecutor({
        owner: "alice",
        locks: navigator.locks,
        journal,
        commitFor: () => async () => {
          throw new Error("relays down");
        },
      });
      await expect(
        failing.receive(token, { requirePersisted: true })
      ).rejects.toThrow("restored");
      // the proofs themselves are kept, so no restore from the mint is needed
      expect(journal.list("alice").map((r) => r.kind)).toEqual(["landed"]);
      expect(held(journal.list("alice"))).toBe(16);

      await recovery().settle("alice", () => wallet.commit);
      expect(sum(wallet.get())).toBe(16);
      expect(journal.list("alice")).toEqual([]);
    }
  );

  it.skipIf(!SETTLED)(
    "keeps a paid payment's change when the wallet cannot store it yet",
    async () => {
      const wallet = walletStore(await funded(64));
      const quote = await meltQuote(10);
      const executor = new WalletExecutor({
        owner: "alice",
        locks: navigator.locks,
        journal,
        commitFor: () => async (add, remove) => {
          // the change of a paid melt: its record is the only one, now holding coins
          const kinds = journal.list("alice").map((r) => r.kind);
          if (add.length && kinds.join() === "landed" && !remove.length) {
            throw new Error("relays down");
          }
          return wallet.commit(add, remove);
        },
      });
      const result = await executor.pay(MINT, quote, wallet.get());
      expect(result.state).toBe("paid");
      expect(journal.list("alice").map((r) => r.kind)).toEqual(["landed"]);

      await recovery().settle("alice", () => wallet.commit);
      expect(sum(wallet.get())).toBeGreaterThan(64 - 10 - quote.fee_reserve);
      expect(journal.list("alice")).toEqual([]);
    }
  );

  it.skipIf(!SETTLED)(
    "leaves a token alone when its swap never reached the mint",
    async () => {
      const from = walletStore(await funded(32));
      const token = await executorFor(from, "bob").send(MINT, 16, from.get());
      const wallet = walletStore();
      const real = globalThis.fetch;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit
      ) => {
        if (String(input).endsWith("/v1/swap")) throw new TypeError("offline");
        return real(input, init);
      }) as typeof fetch;
      try {
        await expect(executorFor(wallet).receive(token)).rejects.toThrow();
      } finally {
        globalThis.fetch = real;
      }
      // the sender's coins are not ours until the mint swaps them
      expect(wallet.get()).toEqual([]);
      expect(journal.list("alice")).toEqual([]);
      expect(sum(await executorFor(wallet).receive(token))).toBe(16);
    }
  );

  it.skipIf(!SETTLED)(
    "settles a record once when two passes run at once, and never another account's",
    async () => {
      // c7bc69c: a melt the mint never ran, so its coins are unspent and the quote is UNPAID
      const coins = await funded(16);
      const quote = await meltQuote(10);
      const melt = {
        v: 1 as const,
        kind: "melt" as const,
        id: "never-sent",
        owner: "alice",
        mintUrl: MINT,
        keysetId: coins[0].id,
        createdAt: 0,
        quoteId: quote.quote,
        inputs: coins,
        blanks: [],
      };
      journal.put(melt);
      const added: Proof[] = [];
      const commit = async (add: Proof[]) => void added.push(...add);

      await recovery().settle("bob", () => commit);
      expect(added).toEqual([]);

      // without Web Locks tabs cannot be kept apart, so nothing is settled
      await new RecoveryHost({ journal }).settle("alice", () => commit);
      expect(added).toEqual([]);

      // focus and visibilitychange in one tab, and a second tab
      const host = recovery();
      const [a, b, c] = await Promise.all([
        host.settle("alice", () => commit),
        host.settle("alice", () => commit),
        recovery().settle("alice", () => commit),
      ]);
      expect(sum(added)).toBe(16);
      expect([...a.values(), ...b.values(), ...c.values()]).toEqual(["failed"]);
      expect(journal.list("alice")).toEqual([]);
    }
  );
});

describe.skipIf(!MINT || !RECONCILE || !HANDOFF)(
  `recovery after a PENDING payment turns ${RECONCILE}`,
  () => {
    it("settles the payment from the mint's answers and returns every coin it can", async () => {
      const saved = JSON.parse(fs.readFileSync(HANDOFF!, "utf8"));
      saved.records.forEach((r: BookRecord) =>
        journal.put({ ...r, createdAt: 0 })
      );
      const wallet = walletStore(saved.wallet);
      const kept = held(saved.records);
      const outcomes = await recovery().settle("alice", () => wallet.commit);

      expect([...outcomes.values()]).toEqual([
        RECONCILE === "SETTLED" ? "paid" : "failed",
      ]);
      expect(journal.list("alice")).toEqual([]);
      if (RECONCILE === "FAILED")
        expect(sum(wallet.get())).toBe(sum(saved.wallet) + kept);
      else expect(sum(wallet.get())).toBeGreaterThanOrEqual(sum(saved.wallet));
      expect(await states(wallet.get())).toEqual(
        new Set([CheckStateEnum.UNSPENT])
      );
    });
  }
);
