import type { CommitProofs } from "@/features/book/settle";
import type { Coin, CoinStore } from "../ports";
import { useCashuStore } from "../state/cashuStore";

/*
 * Until the wallet layer has its own coin store, an account's coins are the old
 * store's copy for that account, and storing them goes through the old wallet's
 * updateProofs, which only the account's open wallet hooks hold (the app's
 * recovery hook hands it over here). An account whose wallet is not open
 * cannot store yet: the book keeps its coins in a record until it can.
 */

const committers = new Map<string, (mintUrl: string) => CommitProofs>();

/** Lets purses store coins for `owner` through this commit; the returned
 *  function takes it back. */
export function registerCommitter(
  owner: string,
  commitFor: (mintUrl: string) => CommitProofs
): () => void {
  committers.set(owner, commitFor);
  return () => committers.delete(owner);
}

export const legacyCoins: CoinStore = {
  async change(owner, mintUrl, add, remove) {
    const commitFor = committers.get(owner);
    if (!commitFor) {
      throw new Error("This account's wallet is not open; this waits for it.");
    }
    await commitFor(mintUrl)(add, remove);
  },
  async coins(owner, mintUrl) {
    const { proofs, mints } = useCashuStore.of(owner).getState();
    // a coin's mint and unit are its keyset's
    const keysets = new Map(
      mints.flatMap((m) =>
        (m.keysets ?? []).map((k) => [k.id, { mintUrl: m.url, unit: k.unit }])
      )
    );
    return proofs.flatMap((proof): Coin[] => {
      const keyset = keysets.get(proof.id);
      if (!keyset || (mintUrl && keyset.mintUrl !== mintUrl)) return [];
      return [{ ...proof, owner, ...keyset }];
    });
  },
  activeMint: (owner) => useCashuStore.of(owner).getState().activeMintUrl ?? "",
};
