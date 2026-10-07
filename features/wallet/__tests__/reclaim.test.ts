import { expect, it, vi } from "vitest";
import { reclaim } from "../reclaim";

const spent = async () => {
  throw new Error("proofs already spent");
};

it("takes a token back, or leaves it waiting for its mint", async () => {
  const entry = { token: "t" };
  expect(
    await reclaim(entry, { take: async () => ({ sats: 8, pending: false }) })
  ).toEqual({ kind: "back", sats: 8 });
  expect(
    await reclaim(entry, { take: async () => ({ sats: 8, pending: true }) })
  ).toEqual({ kind: "waiting", sats: 8, keep: false });
  // handed to a provider: it stays listed, so a later Reclaim can ask it
  expect(
    await reclaim(
      { token: "t", baseUrl: "https://p/" },
      { take: async () => ({ sats: 8, pending: true }) }
    )
  ).toMatchObject({ kind: "waiting", keep: true });
});

it("asks the provider a spent token went to, and calls it gone only when that says so", async () => {
  const entry = { token: "t", baseUrl: "https://p/" };
  const adopt = vi.fn(async () => 40);
  expect(await reclaim(entry, { take: spent, adopt })).toEqual({
    kind: "key",
    sats: 40,
  });
  expect(adopt).toHaveBeenCalledWith("t", "https://p/");
  expect(await reclaim(entry, { take: spent, adopt: async () => 0 })).toEqual({
    kind: "spent",
  });
  // the provider did not answer: nothing is settled, the token stays listed
  await expect(
    reclaim(entry, {
      take: spent,
      adopt: async () => Promise.reject(new Error("503")),
    })
  ).rejects.toThrow("503");
});

it("calls a spent token gone when it went to no provider, and keeps any other failure", async () => {
  expect(
    await reclaim({ token: "t" }, { take: spent, adopt: vi.fn() })
  ).toEqual({ kind: "spent" });
  await expect(
    reclaim(
      { token: "t", baseUrl: "https://p/" },
      {
        take: async () => Promise.reject(new Error("mint down")),
        adopt: vi.fn(),
      }
    )
  ).rejects.toThrow("mint down");
});
