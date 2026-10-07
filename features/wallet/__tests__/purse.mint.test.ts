// A purse moving real coins at the kit's mints: every amount in sats, every coin through the book.
import type { Proof } from "@cashu/cashu-ts";
import { beforeEach, describe, expect, it } from "vitest";
import { getKit } from "@/tests/kit";
import { Journal, memoryStorage } from "@/features/book/journal";
import { RecoveryHost } from "@/features/book/recovery";
import { tokensOf } from "@/features/book/tokens";
import { createPurse } from "../purse";
import type { Coin, CoinStore } from "../ports";

const kit = getKit();
// what the purse wrote to the account's activity
let written: { direction: string; sats: number }[] = [];
const activity = {
  record: (_: string, e: (typeof written)[number]) => void written.push(e),
};
beforeEach(() => void (written = []));

/** an account's coins in memory, matched by secret */
function memoryCoins(unitOf: (mintUrl: string) => string) {
  let coins: Coin[] = [];
  const store: CoinStore = {
    async change(owner, mintUrl, add, remove) {
      const gone = new Set(remove.map((p) => p.secret));
      const held = new Set(coins.map((c) => c.secret));
      coins = coins
        .filter((c) => !gone.has(c.secret))
        .concat(
          add
            .filter((p) => !held.has(p.secret))
            .map((p) => ({ ...p, owner, mintUrl, unit: unitOf(mintUrl) }))
        );
    },
    coins: async (owner, mintUrl) =>
      coins.filter(
        (c) => c.owner === owner && (!mintUrl || c.mintUrl === mintUrl)
      ),
    activeMint: () => kit.env.mintUrl,
    subscribe: () => () => undefined,
  };
  return { store, all: () => coins };
}

describe.each([
  ["the kit's main mint", () => kit.env.mintUrl],
  ["the kit's second mint", () => kit.env.invoiceMintUrl],
])("a purse at %s", (_, mintUrl) => {
  it("receives, shows and sends whole sats, each move in the book", async () => {
    const mint = mintUrl();
    const { store, all } = memoryCoins(() => "sat");
    const journal = new Journal(memoryStorage());
    const purse = createPurse("alice", {
      coins: store,
      activity,
      journal,
      locks: navigator.locks,
    });

    const token = await kit.mintToken(40, {
      otherMint: mint !== kit.env.mintUrl,
    });
    expect(purse.peek(token)).toEqual({ mint, sats: 40 });
    expect(await purse.receive(token)).toBe(40);
    expect(await purse.balances()).toEqual({ [mint]: 40 });

    let handed = "";
    const sent = await purse.send(mint, 15, async (t) => void (handed = t));
    expect(handed).toBe(sent);
    expect(await kit.redeem(sent)).toBe(15);
    expect(await purse.balances()).toEqual({ [mint]: 25 });
    expect(written).toEqual([
      { direction: "in", sats: 40 },
      { direction: "out", sats: 15 },
    ]);
    // the book holds nothing once the handoff resolved
    expect(journal.list("alice")).toEqual([]);
    const states = await kit.coinStates(all() as Proof[], mint);
    expect(states).toEqual(all().map(() => "UNSPENT"));
  });

  it("receives even when the activity cannot be written", async () => {
    const mint = mintUrl();
    const { store } = memoryCoins(() => "sat");
    const full = {
      record: () => {
        throw new Error("storage full");
      },
    };
    const purse = createPurse("alice", {
      coins: store,
      activity: full,
      journal: new Journal(memoryStorage()),
      locks: navigator.locks,
    });
    const token = await kit.mintToken(12, {
      otherMint: mint !== kit.env.mintUrl,
    });
    expect(await purse.receive(token)).toBe(12);
  });

  it("makes two tokens at once, the second from the coins the first left", async () => {
    const mint = mintUrl();
    const { store } = memoryCoins(() => "sat");
    const journal = new Journal(memoryStorage());
    const purse = createPurse("alice", {
      coins: store,
      activity,
      journal,
      locks: navigator.locks,
    });
    await purse.receive(
      await kit.mintToken(40, { otherMint: mint !== kit.env.mintUrl })
    );

    const [a, b] = await Promise.all([
      purse.send(mint, 10),
      purse.send(mint, 10),
    ]);
    expect(await kit.redeem(a)).toBe(10);
    expect(await kit.redeem(b)).toBe(10);
    expect(await purse.balances()).toEqual({ [mint]: 20 });
    // no handoff took them: both stay listed, so neither lives only in a string
    expect(journal.list("alice").map((r) => r.kind)).toEqual([
      "token",
      "token",
    ]);
  });

  it("receives for an account whose wallet is closed, and stores it once it opens", async () => {
    const mint = mintUrl();
    const { store } = memoryCoins(() => "sat");
    let open = false;
    const closed: CoinStore = {
      ...store,
      change: async (...args) => {
        if (!open) throw new Error("This account's wallet is not open");
        await store.change(...args);
      },
    };
    const journal = new Journal(memoryStorage());
    const locks = navigator.locks;
    const purse = createPurse("alice", {
      coins: closed,
      activity,
      journal,
      locks,
    });

    const token = await kit.mintToken(40, {
      otherMint: mint !== kit.env.mintUrl,
    });
    expect(await purse.receive(token)).toBe(40); // the mint swapped it: the sats are alice's
    expect(await purse.balances()).toEqual({});
    expect(journal.list("alice")).toHaveLength(1);

    open = true;
    await new RecoveryHost({ journal, locks }).settle(
      "alice",
      (url) => (add, remove) => closed.change("alice", url, add, remove)
    );
    expect(await purse.balances()).toEqual({ [mint]: 40 });
    expect(journal.list("alice")).toEqual([]);
  });
});

it("pays an invoice while a token is being made, from the coins the token left", async () => {
  const mint = kit.env.mintUrl;
  const { store, all } = memoryCoins(() => "sat");
  const journal = new Journal(memoryStorage());
  const purse = createPurse("alice", {
    coins: store,
    activity,
    journal,
    locks: navigator.locks,
  });
  await purse.receive(await kit.mintToken(64));
  const quote = await (
    await kit.walletAt(mint)
  ).createMeltQuote(await kit.invoice(8));

  // the token takes the lock first; the payment reads coins only after it
  const [token, state] = await Promise.all([
    purse.send(mint, 16, async () => undefined),
    purse.pay(mint, quote),
  ]);
  expect(state).toBe("paid");
  expect(await kit.redeem(token)).toBe(16);
  const left = (await purse.balances())[mint];
  expect(left).toBeLessThanOrEqual(64 - 16 - 8);
  expect(left).toBeGreaterThanOrEqual(64 - 16 - 8 - quote.fee_reserve);
  expect(journal.list("alice")).toEqual([]);
  expect(await kit.coinStates(all() as Proof[], mint)).toEqual(
    all().map(() => "UNSPENT")
  );
});

it("keeps the provider a token went to on its listing when the handoff fails, for Reclaim to ask", async () => {
  const mint = kit.env.mintUrl;
  const { store } = memoryCoins(() => "sat");
  const journal = new Journal(memoryStorage());
  const purse = createPurse("alice", {
    coins: store,
    activity,
    journal,
    locks: navigator.locks,
  });
  await purse.receive(await kit.mintToken(32));
  await expect(
    purse.send(
      mint,
      16,
      async () => {
        throw new Error("neither store kept the key");
      },
      "https://provider.example/"
    )
  ).rejects.toThrow("neither store kept the key");
  expect(tokensOf(journal.list("alice"))).toMatchObject([
    { amount: 16, baseUrl: "https://provider.example/" },
  ]);
});
