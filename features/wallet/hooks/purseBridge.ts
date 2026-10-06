import type { Proof } from "@cashu/cashu-ts";
import type { CommitProofs } from "@/features/book/settle";
import { MintService } from "../core/services/MintService";
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

// keysets are stored as cashu-ts objects, which come back from storage with
// their fields as _id and _unit
type StoredKeyset = {
  id?: string;
  unit?: string;
  _id?: string;
  _unit?: string;
};
const keysetOf = (keyset: object) => {
  const k = keyset as StoredKeyset;
  return { id: k.id ?? k._id, unit: k.unit ?? k._unit ?? "sat" };
};

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
    await listMint(owner, mintUrl, add);
    await commitFor(mintUrl)(add, remove);
  },
  async coins(owner, mintUrl) {
    const { proofs, mints } = useCashuStore.of(owner).getState();
    // a coin's mint and unit are its keyset's
    const keysets = new Map(
      mints.flatMap((m) =>
        (m.keysets ?? []).map((stored) => {
          const k = keysetOf(stored);
          return [k.id, { mintUrl: m.url, unit: k.unit }];
        })
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

/** Coins of a mint or keyset the store does not list are stored but never
 *  counted: list the mint and its keysets first. The coins are stored either
 *  way; a mint that does not answer is listed by the wallet's next refresh. */
async function listMint(owner: string, mintUrl: string, add: Proof[]) {
  const store = useCashuStore.of(owner).getState();
  const listed = store.mints.find((m) => m.url === mintUrl);
  const ids = new Set(listed?.keysets?.map((k) => keysetOf(k).id));
  if (add.every((p) => ids.has(p.id))) return;
  try {
    const { mintInfo, keysets, keys } = await new MintService().activateMint(
      mintUrl
    );
    if (!listed) store.addMint(mintUrl);
    store.setMintInfo(mintUrl, mintInfo);
    store.setKeysets(mintUrl, keysets);
    store.setKeys(mintUrl, keys);
  } catch (error) {
    console.error(`Could not list ${mintUrl} yet:`, error);
  }
}
