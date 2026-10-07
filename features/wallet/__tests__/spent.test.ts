import type { Proof } from "@cashu/cashu-ts";
import { expect, it } from "vitest";
import { walletLock } from "@/features/book/executor";
import type { Coin, CoinStore } from "../ports";
import { dropSpent } from "../spent";

const coin = (secret: string): Coin => ({
  id: "00ad268c4d1f5826",
  amount: 8,
  secret,
  C: "02",
  owner: "alice",
  mintUrl: "m",
  unit: "sat",
});

function memoryCoins(held: Coin[]) {
  let coins = held;
  const store: CoinStore = {
    async change(_, __, add, remove) {
      const gone = new Set(remove.map((p) => p.secret));
      coins = coins.filter((c) => !gone.has(c.secret)).concat(add.map((p) => ({ ...coin(p.secret), ...p })));
    },
    coins: async () => coins,
    activeMint: () => "m",
    subscribe: () => () => undefined,
  };
  return { store, secrets: () => coins.map((c) => c.secret).sort() };
}

const never = () => new Promise<Proof[]>(() => undefined);

it("never holds the wallet lock while the mint is asked", async () => {
  const { store, secrets } = memoryCoins([coin("a"), coin("b")]);
  const cleanup = dropSpent("alice", "m", {
    coins: store,
    check: never,
    locks: navigator.locks,
    wait: 200,
  });
  // a send takes the account's lock while the mint hangs
  const started = Date.now();
  await navigator.locks.request(walletLock("alice"), async () => undefined);
  expect(Date.now() - started).toBeLessThan(50);

  // the hanging mint gives up for this load and takes nothing out
  await expect(cleanup).rejects.toThrow("did not answer in time");
  expect(secrets()).toEqual(["a", "b"]);
});

it("takes out only spent coins still in the wallet", async () => {
  const { store, secrets } = memoryCoins([coin("a"), coin("b"), coin("c")]);
  let answer!: (spent: Proof[]) => void;
  const cleanup = dropSpent("alice", "m", {
    coins: store,
    check: () => new Promise((resolve) => (answer = resolve)),
    locks: navigator.locks,
  });
  await new Promise((r) => setTimeout(r, 0));
  // a send spent b from the wallet while the mint was being asked
  await store.change("alice", "m", [], [coin("b")]);
  answer([coin("a"), coin("b")]);
  expect((await cleanup).map((p) => p.secret)).toEqual(["a"]);
  expect(secrets()).toEqual(["c"]);
});
