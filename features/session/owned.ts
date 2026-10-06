import {
  create,
  type Mutate,
  type StateCreator,
  type StoreApi,
  type UseBoundStore,
} from "zustand";

let owner: string | null = null;
const followers = new Set<(previous: string | null) => void>();

/** The local storage name of something that belongs to one person: their
 *  pubkey is part of it. With no account the plain name is used, which is also
 *  where everything lived before accounts had owners. */
export const owned = (base: string, pubkey = owner): string =>
  pubkey ? `${base}:${pubkey}` : base;

export const currentOwner = (): string | null => owner;

/** Called by the composition root only, when the active account changes. */
export const setOwner = (pubkey: string | null): void => {
  const previous = owner;
  owner = pubkey;
  followers.forEach((follow) => follow(previous));
};

type Persisted<S> = UseBoundStore<
  Mutate<StoreApi<S>, [["zustand/persist", S]]>
>;

/** `create` for a persisted store with one copy per person. The hook and
 *  getState() read the active person's copy. A copy taken earlier keeps
 *  writing to its own person, so work begun for one account settles there
 *  even after a switch. */
export const ownedStore =
  <S>() =>
  (init: StateCreator<S, [], [["zustand/persist", S]]>) => {
    const copies = new Map<string | null, Persisted<S>>();
    let base = "";

    const of = (pubkey: string | null): Persisted<S> => {
      const copy = copies.get(pubkey);
      if (copy) return copy;
      const fresh = create<S>()(init);
      copies.set(pubkey, fresh);
      // a server render has no storage, so the store has no persist either
      if (!("persist" in fresh)) return fresh;
      base ||= fresh.persist.getOptions().name!;
      // only the person's own copy is loaded: nothing from another stays
      fresh.persist.setOptions({
        name: owned(base, pubkey),
        merge: (saved) => ({
          ...fresh.getInitialState(),
          ...(saved as Partial<S>),
        }),
      });
      fresh.persist.rehydrate();
      return fresh;
    };

    // A first account takes over what was done before it existed (a guest's
    // chosen mint, a top-up under way), unless it already has its own copy.
    followers.add((previous) => {
      const guest = copies.get(null);
      if (previous !== null || !owner || !guest || copies.has(owner)) return;
      const name = owned(base, owner);
      if (guest.persist.getOptions().storage?.getItem(name)) return;
      guest.persist.setOptions({ name });
      copies.delete(null);
      copies.set(owner, guest);
    });

    function useOwned(): S;
    function useOwned<T>(selector: (state: S) => T): T;
    function useOwned<T>(selector?: (state: S) => T) {
      const store = of(owner);
      return selector ? store(selector) : store();
    }

    return Object.assign(useOwned, {
      getState: () => of(owner).getState(),
      of,
    });
  };
