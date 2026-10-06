import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Proof } from "@cashu/cashu-ts";
import type { StateStorage, StorageValue } from "zustand/middleware";
import { coinSafeStorage } from "../coinSafeStorage";

type State = { proofs: Proof[]; activeMintUrl?: string };
const coin = (secret: string, amount = 1): Proof => ({
  id: "00ad268c4d1f5826",
  amount,
  secret,
  C: "02",
});
const sum = (ps: Proof[]) => ps.reduce((s, p) => s + p.amount, 0);

/** one device: a storage every tab shares */
function device() {
  const items = new Map<string, string>();
  const storage: StateStorage = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
  const saved = (name = "cashu:a") =>
    JSON.parse(items.get(name) ?? '{"state":{"proofs":[]}}').state
      .proofs as Proof[];
  /** a tab: its own copy of the coins, saved through its own storage */
  const tab = (name = "cashu:a") => {
    let copy: Proof[] = [];
    const followed: Proof[][] = [];
    const store = coinSafeStorage<State>(
      () => storage,
      (_, proofs) => {
        followed.push(proofs);
        copy = proofs;
      }
    )!;
    return {
      load: () =>
        void (copy =
          (store.getItem(name) as StorageValue<State> | null)?.state.proofs ??
          []),
      save: (next: Proof[]) => {
        copy = next;
        store.setItem(name, { state: { proofs: next }, version: 0 });
      },
      copy: () => copy,
      followed,
    };
  };
  return {
    tab,
    saved,
    seed: (ps: Proof[]) => tab().save(ps),
    clear: () => items.clear(),
  };
}

describe("coinSafeStorage", () => {
  it("keeps coins another tab received when this tab saves next", () => {
    const { tab, saved, seed } = device();
    seed([coin("a", 32), coin("b", 16), coin("c", 2)]);
    const first = tab();
    const other = tab();
    first.load();
    other.load();
    other.save([...other.copy(), coin("d", 32), coin("e", 8)]);
    expect(sum(saved())).toBe(90);

    // the first tab, which has not seen the 40, makes a 10 sat token from b
    first.save([coin("a", 32), coin("c", 2), coin("k", 6)]);
    expect(sum(saved())).toBe(80);
    expect(
      saved()
        .map((p) => p.secret)
        .sort()
    ).toEqual(["a", "c", "d", "e", "k"]);
    // and its copy follows what was saved
    expect(sum(first.copy())).toBe(80);
  });

  it("never brings back a coin another tab spent", () => {
    const { tab, saved, seed } = device();
    seed([coin("a"), coin("b")]);
    const first = tab();
    const other = tab();
    first.load();
    other.load();
    other.save([coin("a")]); // b spent there
    first.save([...first.copy(), coin("x")]); // still holds b, adds x
    expect(
      saved()
        .map((p) => p.secret)
        .sort()
    ).toEqual(["a", "x"]);
  });

  it("keeps the NIP-60 event another tab moved a coin to, and this tab's own move", () => {
    const { tab, saved, seed } = device();
    const at = (secret: string, eventId: string) => ({
      ...coin(secret),
      eventId,
    });
    seed([at("a", "e1"), at("b", "e1")]);
    const first = tab();
    const other = tab();
    first.load();
    other.load();
    other.save([at("a", "e2"), at("b", "e1")]); // a rolled over into e2 there
    first.save([at("a", "e1"), at("b", "e3"), coin("x")]); // b rolled into e3 here
    const events = Object.fromEntries(
      saved().map((p) => [
        p.secret,
        (p as Proof & { eventId?: string }).eventId,
      ])
    );
    expect(events).toEqual({ a: "e2", b: "e3", x: undefined });
  });

  it("writes a tab's coins back whole when nothing is saved at all", () => {
    const { tab, saved, seed, clear } = device();
    seed([coin("a"), coin("b")]);
    const only = tab();
    only.load();
    clear(); // storage cleared, or an old tab's sign out removed it
    only.save([...only.copy(), coin("c")]);
    expect(
      saved()
        .map((p) => p.secret)
        .sort()
    ).toEqual(["a", "b", "c"]);
  });

  it("keeps the rest of the state as this tab saves it, and does not follow when nothing changed", () => {
    const { tab, seed } = device();
    seed([coin("a")]);
    const only = tab();
    only.load();
    only.save([coin("a"), coin("b")]);
    expect(only.followed).toEqual([]);
  });

  it("ends with every coin some tab added and none some tab removed, however tabs interleave", () => {
    const op = fc.record({
      tab: fc.integer({ min: 0, max: 2 }),
      kind: fc.constantFrom("load", "change"),
      remove: fc.array(fc.nat(), { maxLength: 3 }),
      add: fc.nat({ max: 2 }),
    });
    fc.assert(
      fc.property(fc.array(op, { maxLength: 30 }), (ops) => {
        const { tab, saved, seed } = device();
        seed([coin("s0"), coin("s1"), coin("s2")]);
        const added = new Set(["s0", "s1", "s2"]);
        const removed = new Set<string>();
        const tabs = [tab(), tab(), tab()];
        tabs.forEach((t) => t.load());
        let fresh = 0;
        for (const { tab: i, kind, remove, add } of ops) {
          const t = tabs[i];
          if (kind === "load") {
            t.load();
            continue;
          }
          // a tab spends coins it holds (maybe ones another tab spent already) and gets new ones
          const held = t.copy();
          const gone = new Set(
            remove.map((n) => held[n % Math.max(1, held.length)]?.secret)
          );
          const next = held.filter((p) => !gone.has(p.secret));
          for (let k = 0; k < add; k++) next.push(coin(`n${fresh++}`));
          gone.forEach((s) => s && removed.add(s));
          next.forEach((p) => added.add(p.secret));
          t.save(next);
        }
        const want = [...added].filter((s) => !removed.has(s)).sort();
        expect(
          saved()
            .map((p) => p.secret)
            .sort()
        ).toEqual(want);
      }),
      { numRuns: 500 }
    );
  });
});
