import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  proofs: [] as { id: string; amount: number; secret: string; C: string }[],
  store: {
    addMint: vi.fn(),
    setMintInfo: vi.fn(),
    setKeysets: vi.fn(),
    setKeys: vi.fn(),
  },
  local: [] as object[],
  activateMint: vi.fn(async () => ({
    mintInfo: {},
    keysets: [{ id: "k-new", unit: "sat" }],
    keys: [],
  })),
}));
vi.mock("@/features/wallet/state/cashuStore", () => ({
  useCashuStore: {
    of: () => ({
      persist: { rehydrate: async () => {} },
      getState: () => ({
        ...state.store,
        proofs: state.proofs,
        activeMintUrl: "m1",
        mints: [
          { url: "m1", keysets: [{ id: "k-sat", unit: "sat" }] },
          // as a tab loads them from storage
          { url: "m2", keysets: [{ _id: "k-msat", _unit: "msat" }] },
        ],
      }),
    }),
  },
}));
vi.mock("@/features/wallet/state/transactionHistoryStore", () => ({
  useTransactionHistoryStore: {
    of: (owner: string) => ({
      getState: () => ({
        addHistoryEntry: (entry: object) =>
          state.local.push({ owner, ...entry }),
      }),
    }),
  },
}));
vi.mock("@/features/wallet/core/services/MintService", () => ({
  MintService: class {
    activateMint = state.activateMint;
  },
}));

import { useCashuStore } from "@/features/wallet/state/cashuStore";
import {
  legacyActivity,
  legacyCoins,
  listMint,
  localActivity,
  registerCommitter,
  registerRecorder,
} from "../purseBridge";

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

it("lists a mint or keyset it does not know before storing coins there", async () => {
  const commit = vi.fn(async () => undefined);
  const close = registerCommitter("alice", () => commit);
  await legacyCoins.change("alice", "m1", [proof("k-sat", "a")], []);
  expect(state.activateMint).not.toHaveBeenCalled();

  // a new mint, and a keyset the listed mint rotated to
  await legacyCoins.change("alice", "m3", [proof("k-new", "b")], []);
  expect(state.store.addMint).toHaveBeenCalledWith("m3");
  expect(state.store.setKeysets).toHaveBeenCalledWith("m3", [
    { id: "k-new", unit: "sat" },
  ]);
  await legacyCoins.change("alice", "m1", [proof("k-new", "c")], []);
  expect(state.store.addMint).toHaveBeenCalledTimes(1);
  expect(state.store.setKeysets).toHaveBeenCalledTimes(2);

  // a mint that does not answer: the coins are stored anyway
  state.activateMint.mockRejectedValueOnce(new Error("offline"));
  await legacyCoins.change("alice", "m4", [proof("k-x", "d")], []);
  expect(commit).toHaveBeenCalledTimes(4);
  close();
});

it("writes activity through the open wallet, and on this device for any other account", () => {
  const record = vi.fn();
  const close = registerRecorder("alice", record);
  legacyActivity.record("alice", { direction: "out", sats: 15 });
  expect(record).toHaveBeenCalledWith({ direction: "out", amount: "15" });

  legacyActivity.record("bob", { direction: "in", sats: 40 });
  expect(state.local).toMatchObject([
    { owner: "bob", direction: "in", amount: "40" },
  ]);
  close();
});

it("lists a mint about to be paid into, before any coin is there", async () => {
  state.store.addMint.mockClear();
  state.activateMint.mockClear();
  await listMint(useCashuStore.of("alice").getState(), "m9");
  expect(state.activateMint).toHaveBeenCalledWith("m9");
  expect(state.store.addMint).toHaveBeenCalledWith("m9");
  // a listed mint with its keysets is left alone
  await listMint(useCashuStore.of("alice").getState(), "m1");
  expect(state.activateMint).toHaveBeenCalledTimes(1);
});

it("keeps a reply's activity on this device, even for the open account", () => {
  const record = vi.fn();
  const close = registerRecorder("carol", record);
  localActivity.record("carol", { direction: "out", sats: 21 });
  expect(record).not.toHaveBeenCalled();
  expect(state.local).toContainEqual(
    expect.objectContaining({ owner: "carol", direction: "out", amount: "21" })
  );
  close();
});
