import type { Proof } from "@cashu/cashu-ts";
import { Journal, memoryStorage } from "@/features/book/journal";
import type { Coin, CoinStore } from "@/features/wallet/ports";
import { createPurse } from "@/features/wallet/purse";
import type { KitClient } from "@/tests/kit";

/** One account's wallet for money tests: the wallet layer's own purse, as
 *  purseFor(owner) builds it, over coins kept in memory instead of the old
 *  cashu store. The kit's mints keep sats. */
export function kitPurse(kit: KitClient, owner: string, mintUrl: string) {
  let coins: Coin[] = [];
  const store: CoinStore = {
    async change(who, mint, add, remove) {
      const gone = new Set(remove.map((p) => p.secret));
      const held = new Set(coins.map((c) => c.secret));
      coins = coins
        .filter((c) => !gone.has(c.secret))
        .concat(
          add
            .filter((p) => !held.has(p.secret))
            .map((p) => ({ ...p, owner: who, mintUrl: mint, unit: "sat" }))
        );
    },
    coins: async (who, mint) =>
      coins.filter((c) => c.owner === who && (!mint || c.mintUrl === mint)),
    activeMint: () => mintUrl,
    // one tab, nothing else changes these coins
    subscribe: () => () => {},
  };
  const journal = new Journal(memoryStorage());
  const purse = createPurse(owner, {
    coins: store,
    // the tests count coins, not the activity list
    activity: { record() {} },
    journal,
    locks: navigator.locks,
  });
  /** Stands in for the wallet's mint-first redeem until it lands: the mint
   *  swaps the token now, or nothing is kept. */
  const redeem = async (token: string) => {
    let sats: number;
    try {
      sats = await kit.redeem(token);
    } catch (error) {
      const code = (error as { code?: number }).code;
      throw Object.assign(new Error(String(error)), {
        reason:
          code === 11001
            ? "spent"
            : error instanceof TypeError
              ? "unreachable"
              : "refused",
      });
    }
    await store.change(owner, mintUrl, await kit.mintProofs(sats), []);
    return sats;
  };
  return {
    owner,
    purse: { ...purse, redeem },
    journal,
    fund: async (sats: number) =>
      store.change(owner, mintUrl, await kit.mintProofs(sats), []),
    get coins(): Proof[] {
      return coins;
    },
    get sats() {
      return coins.reduce((sum, c) => sum + c.amount, 0);
    },
  };
}
