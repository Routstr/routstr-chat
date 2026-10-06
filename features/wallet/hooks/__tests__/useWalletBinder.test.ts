import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetched: { events: [] as object[], answered: [] as string[] },
  createWallet: vi.fn(async () => undefined),
  effects: [] as (() => void)[],
}));

// effects run when the test says so
vi.mock("react", () => ({
  useEffect: (effect: () => void) => void state.effects.push(effect),
  useContext: () => ({
    of: () => ({ ready: async () => {}, fetch: async () => state.fetched }),
  }),
  createContext: () => ({}),
}));
vi.mock("../useCashuWallet", () => ({
  useCashuWallet: () => ({ owner: "alice", wallet: null, isLoading: false }),
}));
vi.mock("../useCreateCashuWallet", () => ({
  useCreateCashuWallet: () => ({ mutateAsync: state.createWallet }),
}));
vi.mock("../useCashuToken", () => ({
  useCashuToken: () => ({ cleanSpentProofs: vi.fn() }),
}));
vi.mock("../../view", () => ({ useBalances: () => null }));
vi.mock("../../state/cashuStore", () => ({
  useCashuStore: () => ({
    activeMintUrl: "m",
    userSelectedMintUrl: undefined,
    mints: [],
  }),
}));
vi.mock("@/features/relays/view", () => ({ RelaysContext: {} }));

import { useWalletBinder } from "../useWalletBinder";

async function bind() {
  state.effects = [];
  useWalletBinder();
  state.effects[0](); // the wallet-making effect
  await vi.waitFor(async () => {
    const held = await navigator.locks.query();
    expect(held.held ?? []).toEqual([]);
  });
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => state.createWallet.mockClear());

it("makes a wallet only when a relay answered that there is none", async () => {
  state.fetched = { events: [], answered: [] }; // silence or a timeout
  await bind();
  expect(state.createWallet).not.toHaveBeenCalled();

  state.fetched = { events: [{ id: "w" }], answered: ["wss://r"] }; // there is one
  await bind();
  expect(state.createWallet).not.toHaveBeenCalled();

  state.fetched = { events: [], answered: ["wss://r"] }; // answered: none
  await bind();
  expect(state.createWallet).toHaveBeenCalledTimes(1);
});

it("makes it once when asked twice at the same time", async () => {
  state.fetched = { events: [], answered: ["wss://r"] };
  state.effects = [];
  useWalletBinder();
  useWalletBinder();
  state.effects[0]();
  state.effects[state.effects.length / 2](); // the second mount's first effect
  await new Promise((r) => setTimeout(r, 20));
  expect(state.createWallet).toHaveBeenCalledTimes(1);
});
