import type { Proof } from "@cashu/cashu-ts";
import { WalletExecutor } from "@/features/book/executor";
import { Journal, memoryStorage } from "@/features/book/journal";
import type { Purse } from "@/features/payments/ports";
import type { KitClient } from "@/tests/kit";

const sum = (proofs: Proof[]) => proofs.reduce((s, p) => s + p.amount, 0);

/** One account's wallet for money tests: coins in memory, every move through
 *  the wallet book, as the wallet layer's purseFor(owner) does. */
export function bookPurse(kit: KitClient, owner: string, mintUrl: string) {
  let coins: Proof[] = [];
  const journal = new Journal(memoryStorage());
  const executor = new WalletExecutor({
    owner,
    journal,
    locks: navigator.locks,
    commitFor: () => async (add, remove) => {
      const gone = new Set(remove.map((p) => p.secret));
      coins = [...coins.filter((p) => !gone.has(p.secret)), ...add];
    },
  });
  const purse: Purse = {
    balances: async () => ({ [mintUrl]: sum(coins) }),
    activeMint: () => mintUrl,
    send: (mint, sats, handoff) =>
      executor.send(mint, sats, [...coins], { handoff }),
    // the kit's mint keeps sats, so coin amounts are sats
    receive: async (token) => sum(await executor.receive(token)),
  };
  return {
    owner,
    purse,
    journal,
    fund: async (sats: number) => {
      coins = [...coins, ...(await kit.mintProofs(sats))];
    },
    get coins() {
      return coins;
    },
    get sats() {
      return sum(coins);
    },
  };
}
