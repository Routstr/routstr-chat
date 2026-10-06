import type { Proof } from "@cashu/cashu-ts";
import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
  type StorageValue,
} from "zustand/middleware";

/**
 * Saves a tab's coins without dropping another tab's. Each tab keeps its own
 * copy of the store and saves all of it, so a plain save from a tab that has
 * not seen another tab's coins writes over them. This save merges by secret:
 * it keeps what is saved, takes out only the coins this tab removed since it
 * last read or saved, and adds only the ones it added. A coin both hold keeps
 * what another tab wrote for it (its NIP-60 event) unless this tab changed it.
 * `follow` must hand the tab what was saved before its next save, so it runs
 * at once, whenever that differs from the tab's copy.
 */
export function coinSafeStorage<S extends { proofs: Proof[] }>(
  getStorage: () => StateStorage,
  follow: (name: string, proofs: S["proofs"]) => void
): PersistStorage<S> | undefined {
  const json = createJSONStorage<S>(getStorage);
  if (!json) return undefined;
  // per name: each coin this tab last read or saved there, as it was then
  const seen = new Map<string, Map<string, string>>();
  const known = (proofs: Proof[]) =>
    new Map(proofs.map((p) => [p.secret, JSON.stringify(p)]));

  return {
    getItem(name) {
      const value = json.getItem(name) as StorageValue<S> | null;
      seen.set(name, known(value?.state?.proofs ?? []));
      return value;
    },
    setItem(name, value) {
      const stored = json.getItem(name) as StorageValue<S> | null;
      // nothing saved at all (storage cleared): this tab's coins are written back whole
      const before = (stored && seen.get(name)) || new Map<string, string>();
      const mine = value.state.proofs;
      const held = new Set(mine.map((p) => p.secret));
      const saved = stored?.state?.proofs ?? [];
      const there = new Map(saved.map((p) => [p.secret, p]));
      const proofs = [
        // another tab's coins, which this tab never had
        ...saved.filter((p) => !held.has(p.secret) && !before.has(p.secret)),
        // this tab's, except those another tab took out since
        ...mine.flatMap((p) => {
          const other = there.get(p.secret);
          if (!other) return before.has(p.secret) ? [] : [p];
          const now = JSON.stringify(p);
          const unchanged = before.get(p.secret) === now;
          return [unchanged && JSON.stringify(other) !== now ? other : p];
        }),
      ];
      json.setItem(name, { ...value, state: { ...value.state, proofs } });
      seen.set(name, known(proofs));
      if (
        proofs.length !== mine.length ||
        proofs.some((p, i) => p !== mine[i])
      ) {
        follow(name, proofs);
      }
    },
    removeItem(name) {
      seen.delete(name);
      json.removeItem(name);
    },
  };
}
