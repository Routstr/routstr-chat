import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { getEncodedToken } from "@cashu/cashu-ts";
import { Journal, memoryStorage } from "@/features/book/journal";
import { balancesOf, createPurse } from "../purse";
import type { Coin } from "../ports";

const coin = (
  mintUrl: string,
  unit: string,
  amount: number,
  n: number
): Coin => ({
  id: "00ad268c4d1f5826",
  amount,
  secret: `s${n}`,
  C: "02",
  owner: "alice",
  mintUrl,
  unit,
});

// what one of each unit is worth in msat: usd and the like are not bitcoin
const MSAT_PER: Record<string, number> = { sat: 1000, msat: 1 };

describe("balancesOf", () => {
  it("never shows a sat the coins do not hold, and never a whole sat less", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            mint: fc.constantFrom("m1", "m2"),
            unit: fc.constantFrom("sat", "msat", "usd"),
            amount: fc.integer({ min: 1, max: 2 ** 21 }),
          })
        ),
        (specs) => {
          const coins = specs.map((s, n) => coin(s.mint, s.unit, s.amount, n));
          const shown = balancesOf(coins);
          for (const mint of new Set(specs.map((s) => s.mint))) {
            // in whole msat, so no float sum lands a hair under the truth
            const msat = specs
              .filter((s) => s.mint === mint)
              .reduce((v, s) => v + s.amount * (MSAT_PER[s.unit] ?? 0), 0);
            expect(shown[mint] * 1000).toBeLessThanOrEqual(msat);
            expect(msat - shown[mint] * 1000).toBeLessThan(1000);
          }
        }
      )
    );
  });
});

describe("createPurse", () => {
  it("reads a token's mint and sats without its mint", () => {
    const purse = createPurse("alice", {
      coins: {
        change: async () => {},
        coins: async () => [],
        activeMint: () => "m1",
      },
      journal: new Journal(memoryStorage()),
    });
    const proofs = [
      { id: "0151dabec3bf9bc0", amount: 2048, secret: "a", C: "02" },
    ];
    const token = getEncodedToken({
      mint: "https://mint.example",
      proofs,
      unit: "msat",
    });
    expect(purse.peek(token)).toEqual({
      mint: "https://mint.example",
      sats: 2,
    });
    expect(purse.activeMint()).toBe("m1");
  });
});
