import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  proofs: [] as { id: string; amount: number; secret: string; C: string }[],
}));
vi.mock("@/features/wallet/state/cashuStore", () => ({
  useCashuStore: {
    of: () => ({
      getState: () => ({
        proofs: state.proofs,
        activeMintUrl: "m1",
        mints: [
          { url: "m1", keysets: [{ id: "k-sat", unit: "sat" }] },
          { url: "m2", keysets: [{ id: "k-msat", unit: "msat" }] },
        ],
      }),
    }),
  },
}));

import { legacyCoins, registerCommitter } from "../purseBridge";

const proof = (id: string, secret: string) => ({
  id,
  amount: 8,
  secret,
  C: "02",
});

it("reads an account's coins per mint with their keyset's unit", async () => {
  state.proofs = [
    proof("k-sat", "a"),
    proof("k-msat", "b"),
    proof("gone", "c"),
  ];
  expect(
    (await legacyCoins.coins("alice")).map((c) => [c.secret, c.mintUrl, c.unit])
  ).toEqual([
    ["a", "m1", "sat"],
    ["b", "m2", "msat"],
  ]);
  expect((await legacyCoins.coins("alice", "m2")).map((c) => c.secret)).toEqual(
    ["b"]
  );
  expect(legacyCoins.activeMint("alice")).toBe("m1");
});

it("stores only through the account's open wallet, and waits without it", async () => {
  await expect(
    legacyCoins.change("alice", "m1", [proof("k-sat", "a")], [])
  ).rejects.toThrow("not open");
  const commit = vi.fn(async () => undefined);
  const close = registerCommitter("alice", () => commit);
  await legacyCoins.change("alice", "m1", [proof("k-sat", "a")], []);
  expect(commit).toHaveBeenCalledWith([proof("k-sat", "a")], []);
  close();
  await expect(legacyCoins.change("alice", "m1", [], [])).rejects.toThrow(
    "not open"
  );
});
