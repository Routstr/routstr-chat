// The spent-coin check against the kit's mint: its own NUT-07 answer decides.
import { getEncodedToken, type Proof } from "@cashu/cashu-ts";
import { expect, it } from "vitest";
import { getKit } from "@/tests/kit";
import type { Coin, CoinStore } from "../ports";
import { dropSpent } from "../spent";

const kit = getKit();

it("takes out the coins the mint saw spent and keeps the rest", async () => {
  const mint = kit.env.mintUrl;
  const kept = await kit.mintProofs(16, mint);
  const used = await kit.mintProofs(8, mint);
  // spent somewhere else: another device, or a send whose answer was lost
  expect(await kit.redeem(getEncodedToken({ mint, proofs: used, unit: "sat" }))).toBe(8);

  let coins: Coin[] = [...kept, ...used].map((p) => ({
    ...p,
    owner: "alice",
    mintUrl: mint,
    unit: "sat",
  }));
  const store: CoinStore = {
    async change(_, __, ___, remove) {
      const gone = new Set(remove.map((p) => p.secret));
      coins = coins.filter((c) => !gone.has(c.secret));
    },
    coins: async () => coins,
    activeMint: () => mint,
    subscribe: () => () => undefined,
  };

  const gone = await dropSpent("alice", mint, { coins: store, locks: navigator.locks });
  const secrets = (ps: Pick<Proof, "secret">[]) => ps.map((p) => p.secret).sort();
  expect(secrets(gone)).toEqual(secrets(used));
  expect(secrets(coins)).toEqual(secrets(kept));
  expect(await kit.coinStates(coins, mint)).toEqual(coins.map(() => "UNSPENT"));
});
