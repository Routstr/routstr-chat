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
