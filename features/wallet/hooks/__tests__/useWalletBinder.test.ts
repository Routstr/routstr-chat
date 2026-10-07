import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  urls: ["wss://r"],
  // how each relay's connection looks once the fetch is over
  status: {} as Record<string, string>,
  fetched: { events: [] as object[], answered: [] as string[] },
  createWallet: vi.fn(async () => undefined),
  effects: [] as (() => void)[],
  // the account active in the tab, read as the relays answer
  active: "alice",
}));

// effects run when the test says so
vi.mock("react", () => ({
  useEffect: (effect: () => void) => void state.effects.push(effect),
  useContext: () => ({
    of: () => ({
      ready: async () => {},
      urls: () => state.urls,
      fetch: async () => state.fetched,
    }),
    port: { status: (url: string) => state.status[url] ?? "ok" },
  }),
  createContext: () => ({}),
}));
vi.mock("../useCashuWallet", () => ({
  useCashuWallet: () => ({ owner: "alice", wallet: null, isLoading: false }),
}));
vi.mock("../useCreateCashuWallet", () => ({
  useCreateCashuWallet: () => ({ mutateAsync: state.createWallet }),
}));
vi.mock("../../view", () => ({
  useBalances: () => null,
  usePurseOf: () => () => null,
}));
vi.mock("../../state/cashuStore", () => ({
  useCashuStore: () => ({
    activeMintUrl: "m",
    userSelectedMintUrl: undefined,
    mints: [],
  }),
}));
vi.mock("@/features/relays/view", () => ({ RelaysContext: {} }));
vi.mock("@/features/session/owned", async (actual) => ({
  ...(await actual<object>()),
  currentOwner: () => state.active,
}));

import { useWalletBinder } from "../useWalletBinder";

/** one render of a component that mounts the binder */
function Binder() {
  useWalletBinder();
  return null;
}

async function bind() {
  state.effects = [];
  Binder();
  state.effects[0](); // the wallet-making effect
  await vi.waitFor(async () => {
    const held = await navigator.locks.query();
    expect(held.held ?? []).toEqual([]);
  });
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  state.createWallet.mockClear();
  state.urls = ["wss://r"];
  state.status = {};
  state.active = "alice";
});

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
  Binder();
  Binder();
  state.effects[0]();
  state.effects[state.effects.length / 2](); // the second mount's first effect
  await new Promise((r) => setTimeout(r, 20));
  expect(state.createWallet).toHaveBeenCalledTimes(1);
});

it("makes none while a relay that connected stays silent, on this load", async () => {
  state.urls = ["wss://a", "wss://slow"];
  state.status = { "wss://slow": "ok" }; // connected, then timed out
  state.fetched = { events: [], answered: ["wss://a"] };
  await bind();
  expect(state.createWallet).not.toHaveBeenCalled();
});

it("makes it when one relay answered none and another never connected", async () => {
  state.urls = ["wss://a", "wss://dead"];
  state.status = { "wss://dead": "bad" }; // refused
  state.fetched = { events: [], answered: ["wss://a"] };
  await bind();
  expect(state.createWallet).toHaveBeenCalledTimes(1);
});

it("makes none when the person switched account while the relays were asked", async () => {
  state.fetched = { events: [], answered: ["wss://r"] };
  state.active = "bob";
  await bind();
  expect(state.createWallet).not.toHaveBeenCalled();
});
