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

// the account's mints, in the wallet's own store
vi.mock("@/features/wallet/state/walletStore", () => ({
  useWalletStore: {
    of: () => ({
      getState: () => ({
        ...state.store,
        activeMintUrl: "m1",
        mints: [
          { url: "m1", keysets: [{ id: "k-sat", unit: "sat" }] },
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

import { useWalletStore } from "@/features/wallet/state/walletStore";
import {
  legacyActivity,
  listMint,
  localActivity,
  registerRecorder,
} from "../purseBridge";

const proof = (id: string, secret: string) => ({
  id,
  amount: 8,
  secret,
  C: "02",
});

it("lists a mint or keyset it does not know before coins are stored there", async () => {
  const store = useWalletStore.of("alice").getState();
  await listMint(store, "m1", [proof("k-sat", "a")]);
  expect(state.activateMint).not.toHaveBeenCalled();

  // a new mint, and a keyset the listed mint rotated to
  await listMint(store, "m3", [proof("k-new", "b")]);
  expect(state.store.addMint).toHaveBeenCalledWith("m3");
  expect(state.store.setKeysets).toHaveBeenCalledWith("m3", [
    { id: "k-new", unit: "sat" },
  ]);
  await listMint(store, "m1", [proof("k-new", "c")]);
  expect(state.store.addMint).toHaveBeenCalledTimes(1);
  expect(state.store.setKeysets).toHaveBeenCalledTimes(2);

  // a mint that does not answer: listed by the wallet's next refresh
  state.activateMint.mockRejectedValueOnce(new Error("offline"));
  await expect(
    listMint(store, "m4", [proof("k-x", "d")])
  ).resolves.toBeUndefined();
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
  await listMint(useWalletStore.of("alice").getState(), "m9");
  expect(state.activateMint).toHaveBeenCalledWith("m9");
  expect(state.store.addMint).toHaveBeenCalledWith("m9");
  // a listed mint with its keysets is left alone
  await listMint(useWalletStore.of("alice").getState(), "m1");
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
