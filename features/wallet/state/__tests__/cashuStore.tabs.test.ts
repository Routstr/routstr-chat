// The app's coin store in two tabs of one device: each tab its own copy of the modules.
import { beforeEach, expect, it, vi } from "vitest";
import type { Proof } from "@cashu/cashu-ts";
import { memoryStorage } from "@/features/book/journal";

const coin = (secret: string, amount: number): Proof => ({
  id: "00ad268c4d1f5826",
  amount,
  secret,
  C: "02",
});
const sum = (ps: Proof[]) => ps.reduce((s, p) => s + p.amount, 0);

let storage: ReturnType<typeof memoryStorage>;
const saved = (name = "cashu:alice") =>
  JSON.parse(storage.getItem(name) ?? "null").state.proofs as Proof[];

/** a tab: a fresh copy of the store's module over the device's storage */
async function tab() {
  vi.resetModules();
  return (await import("../cashuStore")).useCashuStore;
}

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage, addEventListener: vi.fn() });
  storage.setItem(
    "cashu:alice",
    JSON.stringify({
      state: { proofs: [coin("a", 32), coin("b", 16), coin("c", 2)] },
      version: 0,
    })
  );
});

it("keeps another tab's coins while a stale tab adds several in a row", async () => {
  const first = (await tab()).of("alice");
  const other = (await tab()).of("alice");
  other.getState().addProofs([coin("d", 32), coin("e", 8)], "ev2");
  expect(sum(saved())).toBe(90);

  // one save per coin, all in one run: the first tab has not seen d and e
  first.getState().addProofs([coin("k16", 16), coin("k4", 4)], "ev3");
  expect(sum(saved())).toBe(110);
  expect(sum(first.getState().proofs)).toBe(110);
});

it("takes out only what the stale tab spent", async () => {
  const first = (await tab()).of("alice");
  const other = (await tab()).of("alice");
  other.getState().addProofs([coin("d", 32)], "ev2");
  first.getState().removeProofs([coin("b", 16)]);
  first.getState().addProofs([coin("k6", 6)], "ev3");
  expect(
    saved()
      .map((p) => p.secret)
      .sort()
  ).toEqual(["a", "c", "d", "k6"]);
});

it("keeps another guest tab's coins after this tab opens an account's copy", async () => {
  storage.setItem(
    "cashu",
    JSON.stringify({ state: { proofs: [coin("g", 16)] }, version: 0 })
  );
  const here = await tab();
  const guest = here.of(null);
  (await tab())
    .of(null)
    .getState()
    .addProofs([coin("g8", 8)], "ev2");
  here.of("bob"); // another account's copy, in this tab
  guest.getState().addProofs([coin("g4", 4)], "ev3");
  expect(sum(saved("cashu"))).toBe(28);
});

it("gives the purse what another tab left, not this tab's old copy", async () => {
  const first = await tab();
  const { legacyCoins } = await import("@/features/wallet/hooks/purseBridge");
  first.of("alice"); // loaded: a, b, c
  const other = (await tab()).of("alice");
  other.getState().removeProofs([coin("b", 16)]); // spent there
  other.getState().addProofs([coin("d", 32)], "ev2");
  storage.setItem(
    "cashu:alice",
    JSON.stringify({
      ...JSON.parse(storage.getItem("cashu:alice")!),
      state: {
        ...JSON.parse(storage.getItem("cashu:alice")!).state,
        mints: [
          { url: "m", keysets: [{ _id: "00ad268c4d1f5826", _unit: "sat" }] },
        ],
      },
    })
  );
  const coins = await legacyCoins.coins("alice", "m");
  expect(coins.map((c) => c.secret).sort()).toEqual(["a", "c", "d"]);
});

it("tells the purse when coins change, never for a reload that finds the same", async () => {
  const store = (await tab()).of("alice");
  const { legacyCoins } = await import("@/features/wallet/hooks/purseBridge");
  // a listener that reads the coins, as balances do (each read reloads the store)
  const heard = vi.fn(() => void legacyCoins.coins("alice"));
  const stop = legacyCoins.subscribe("alice", heard);
  await legacyCoins.coins("alice");
  expect(heard).not.toHaveBeenCalled();

  store.getState().addProofs([coin("d", 32)], "ev2");
  await new Promise((r) => setTimeout(r, 20));
  expect(heard).toHaveBeenCalledTimes(1);
  // and the listener's read never undid the change
  expect(saved().map((p) => p.secret)).toContain("d");
  expect(store.getState().proofs.map((p) => p.secret)).toContain("d");
  stop();
});
