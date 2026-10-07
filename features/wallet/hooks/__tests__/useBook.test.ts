import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  active: null as string | null,
  rendered: undefined as string | undefined,
  updateProofs: vi.fn(async () => undefined),
  ref: { current: undefined as unknown },
  held: [] as { secret: string }[],
  memory: [] as { secret: string }[],
}));

vi.mock("react", () => ({
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => void) => effect(),
  useRef: () => state.ref,
}));
vi.mock("@/features/session/owned", async (actual) => ({
  ...(await actual<object>()),
  currentOwner: () => state.active,
}));
// what is saved for the account, and a memory copy that may run ahead of it
vi.mock("@/features/wallet/state/cashuStore", () => ({
  useCashuStore: {
    getState: () => ({ proofs: state.memory }),
    of: () => ({
      persist: { getOptions: () => ({ name: "cashu:alice" }) },
    }),
  },
}));
vi.mock("@/features/wallet/hooks/useCashuWallet", () => ({
  useCashuWallet: () => ({
    owner: state.rendered,
    updateProofs: state.updateProofs,
  }),
}));

vi.stubGlobal("localStorage", {
  getItem: () => JSON.stringify({ state: { proofs: state.held } }),
});

import { useBook } from "../useBook";

const proof = { id: "00ad268c4d1f5826", amount: 8, secret: "s1", C: "02" };
// a screen that holds the book, rendered as `owner`
const Screen = () => useBook();
const render = (owner: string | undefined) => {
  state.rendered = owner;
  return Screen();
};

beforeEach(() => {
  state.updateProofs.mockClear();
  state.active = null;
  state.held = [];
  state.memory = [];
});

it("stores coins only as the account the latest render stores as", async () => {
  state.active = "alice";
  const book = render("alice");
  await book.commitFor("alice")("m")([proof], []);
  expect(state.updateProofs).toHaveBeenCalledTimes(1);

  // switched to bob, not rendered yet: neither account can store
  state.active = "bob";
  await expect(book.commitFor("alice")("m")([proof], [])).rejects.toThrow(
    "Another account"
  );
  await expect(book.commitFor("bob")("m")([proof], [])).rejects.toThrow(
    "Another account"
  );
  expect(state.updateProofs).toHaveBeenCalledTimes(1);
});

it("pays into a key made a moment ago, from a render that predates it", async () => {
  const book = render(undefined);
  expect(book.activeExecutor()).toBeNull();

  state.active = "carol"; // the first money in makes a key
  expect(book.activeExecutor()).not.toBeNull();
  await expect(book.commitFor("carol")("m")([proof], [])).rejects.toThrow();

  render("carol");
  await book.commitFor("carol")("m")([proof], []);
  expect(state.updateProofs).toHaveBeenCalledTimes(1);
});

it("never stores a coin the wallet already holds a second time", async () => {
  state.active = "alice";
  state.held = [{ secret: "s1" }];
  const book = render("alice");
  const other = { ...proof, secret: "s2" };

  await book.commitFor("alice")("m")([proof, other], []);
  expect(state.updateProofs).toHaveBeenCalledWith({
    mintUrl: "m",
    proofsToAdd: [other],
    proofsToRemove: [],
  });
  // nothing new and nothing to remove: no store call at all
  await book.commitFor("alice")("m")([proof], []);
  expect(state.updateProofs).toHaveBeenCalledTimes(1);
});

it("stores a coin that is in memory but was never saved (storage full)", async () => {
  state.active = "alice";
  state.memory = [{ secret: "s1" }];
  await render("alice").commitFor("alice")("m")([proof], []);
  expect(state.updateProofs).toHaveBeenCalledTimes(1);
});

it("builds the executor for the account its render shows, even after a sign out", () => {
  state.active = "alice";
  const book = render("alice");
  // alice signs out mid-flow: bob is active while alice's flow still runs with her coins
  state.active = "bob";
  const executor = book.activeExecutor() as unknown as {
    deps: { owner: string };
  };
  expect(executor.deps.owner).toBe("alice");
});
