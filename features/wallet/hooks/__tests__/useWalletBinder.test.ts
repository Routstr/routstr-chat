import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetched: {
    events: [] as object[],
    answered: [] as string[],
    outcomes: {} as Record<string, string>,
  },
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
      fetch: async () => state.fetched,
    }),
  }),
  createContext: () => ({}),
}));
vi.mock("../useWalletEvent", () => ({
  useWalletEvent: () => ({ owner: "alice", wallet: null, isLoading: false }),
}));
vi.mock("../useCreateCashuWallet", () => ({
  useCreateCashuWallet: () => ({ mutateAsync: state.createWallet }),
}));
vi.mock("../../view", () => ({
  useBalances: () => null,
  usePurseOf: () => () => null,
}));
vi.mock("../../state/walletStore", () => ({
  useWalletStore: () => ({
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
  state.active = "alice";
});

/** each relay's outcome, and what the ones that sent all they hold had */
const fetched = (outcomes: Record<string, string>, events: object[] = []) => ({
  events,
  answered: Object.keys(outcomes).filter((url) => outcomes[url] === "eose"),
  outcomes,
});

it("makes a wallet only when a relay answered that there is none", async () => {
  state.fetched = fetched({ "wss://r": "timeout" }); // silence
  await bind();
  expect(state.createWallet).not.toHaveBeenCalled();

  state.fetched = fetched({ "wss://r": "eose" }, [{ id: "w" }]); // there is one
  await bind();
  expect(state.createWallet).not.toHaveBeenCalled();

  state.fetched = fetched({ "wss://r": "eose" }); // answered: none
  await bind();
  expect(state.createWallet).toHaveBeenCalledTimes(1);
});

it("makes it once when asked twice at the same time", async () => {
  state.fetched = fetched({ "wss://r": "eose" });
  state.effects = [];
  Binder();
  Binder();
  state.effects[0]();
  state.effects[state.effects.length / 2](); // the second mount's first effect
  await new Promise((r) => setTimeout(r, 20));
  expect(state.createWallet).toHaveBeenCalledTimes(1);
});

it.each([
  ["went silent after the request", "timeout"],
  ["dropped after the request", "error"],
])(
  "makes none while a relay that got the request %s, on this load",
  async (_, outcome) => {
    state.fetched = fetched({ "wss://a": "eose", "wss://b": outcome });
    await bind();
    expect(state.createWallet).not.toHaveBeenCalled();
  }
);

it.each([
  ["refused (auth-required)", "closed"],
  ["never opened", "unreachable"],
])(
  "makes it when one relay answered none and another %s",
  async (_, outcome) => {
    state.fetched = fetched({ "wss://a": "eose", "wss://b": outcome });
    await bind();
    expect(state.createWallet).toHaveBeenCalledTimes(1);
  }
);

it("makes none when the person switched account while the relays were asked", async () => {
  state.fetched = fetched({ "wss://r": "eose" });
  state.active = "bob";
  await bind();
  expect(state.createWallet).not.toHaveBeenCalled();
});
