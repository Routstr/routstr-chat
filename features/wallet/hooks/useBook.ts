import { useCallback, useEffect, useRef } from "react";
import type { Proof } from "@cashu/cashu-ts";
import type { StorageValue } from "zustand/middleware";
import { currentOwner } from "@/features/session/owned";
import { WalletExecutor } from "@/features/book/executor";
import type { CommitProofs } from "@/features/book/settle";
import { journal, locks } from "@/runtime/book";
import { useCashuStore } from "../state/cashuStore";
import { useCashuWallet } from "./useCashuWallet";

/**
 * The signed-in account's wallet book. Proofs are stored through the old
 * wallet's `updateProofs` (its store and NIP-60) until the book has its own
 * proof store. That call stores and signs as the account of the latest
 * render, so a commit for any other account is refused and its record waits
 * for it.
 */
export function useBook() {
  const { owner, updateProofs } = useCashuWallet();
  const latest = useRef({ owner, updateProofs });
  // after useCashuWallet's own effects, which hand updateProofs its account
  useEffect(() => {
    latest.current = { owner, updateProofs };
  });

  const commitFor = useCallback(
    (account: string) =>
      (mintUrl: string): CommitProofs =>
      async (add, remove) => {
        const wallet = latest.current;
        if (wallet.owner !== account || currentOwner() !== account) {
          throw new Error("Another account is active; this waits for its own.");
        }
        // coins already saved are not stored again: a second NIP-60 copy of
        // them would outlive their spend and bring them back
        const held = savedSecrets(account);
        const fresh = add.filter((p) => !held.has(p.secret));
        if (!fresh.length && !remove.length) return null;
        return wallet.updateProofs({
          mintUrl,
          proofsToAdd: fresh,
          proofsToRemove: remove,
        });
      },
    []
  );

  /** The executor of the account whose wallet this render shows, the owner of
   *  the coins its callers pass in, even after a switch or sign out. With no
   *  account yet, the one active now: a key made a moment ago (the first
   *  money in) is already the one paid into. */
  const activeExecutor = useCallback(() => {
    const account = latest.current.owner ?? currentOwner();
    if (!account) return null;
    const commit = commitFor(account);
    return new WalletExecutor({
      owner: account,
      journal,
      commitFor: commit,
      locks,
    });
  }, [commitFor]);

  return { owner, activeExecutor, commitFor };
}

/** The secrets of the coins saved for this account. What is saved, not the
 *  store in memory: memory runs ahead when a save fails (storage full), and a
 *  stale tab's memory still holds coins another tab has spent. Read straight
 *  from localStorage: a read through the store's own storage counts as this
 *  tab loading them, and its next save would then drop another tab's coins. */
function savedSecrets(account: string): Set<string> {
  const { name } = useCashuStore.of(account).persist.getOptions();
  const saved = JSON.parse(
    localStorage.getItem(name!) ?? "null"
  ) as StorageValue<{ proofs: Proof[] }> | null;
  return new Set((saved?.state?.proofs ?? []).map((p) => p.secret));
}

/** Whether this account (by default the active one) has money in the wallet
 *  book: a token not claimed yet, or a payment or receive still settling. */
export const holdsRecords = (owner = currentOwner()) =>
  !!owner && journal.list(owner).length > 0;

/** Removes an unclaimed token from the list (claimed by someone, or dismissed). */
export const dismissToken = (id: string) => journal.remove(id);
