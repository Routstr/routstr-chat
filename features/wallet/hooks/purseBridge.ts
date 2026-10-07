import type { Proof } from "@cashu/cashu-ts";
import type { CommitProofs } from "@/features/book/settle";
import { MintService } from "../core/services/MintService";
import type { ActivityLog, Coin, CoinStore } from "../ports";
import { useCashuStore } from "../state/cashuStore";
import { useWalletStore, type WalletStore } from "../state/walletStore";
import { useTransactionHistoryStore } from "../state/transactionHistoryStore";

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
    await listMint(useWalletStore.of(owner).getState(), mintUrl, add);
    await commitFor(mintUrl)(add, remove);
  },
  async coins(owner, mintUrl) {
    const store = useCashuStore.of(owner);
    // another tab may have spent or added coins since this copy loaded; a
    // send reads them under the account's lock, so what is saved is current
    await store.persist.rehydrate();
    const { proofs, mints } = store.getState();
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
  activeMint: (owner) =>
    useWalletStore.of(owner).getState().activeMintUrl ?? "",
  subscribe(owner, listener) {
    const store = useCashuStore.of(owner);
    // only what balances read: a reload with the same coins is no change
    // (reading coins reloads the store, so anything more would loop)
    const what = () => {
      const { proofs, mints } = store.getState();
      const ids = mints.flatMap((m) =>
        (m.keysets ?? []).map((k) => `${m.url}:${keysetOf(k).id}`)
      );
      return `${proofs.map((p) => p.secret).sort()}|${ids.sort()}`;
    };
    let last = what();
    // after the save: zustand tells listeners first, and a listener that reads
    // (and so reloads) the coins then would reload them without this change
    return store.subscribe(() =>
      queueMicrotask(() => {
        const now = what();
        if (now === last) return;
        last = now;
        listener();
      })
    );
  },
};

let coinStore: CoinStore = legacyCoins;

/** Where purses keep coins: the IndexedDB store once the runtime registers
 *  it, for the wallet's own hooks (spent cleanup, recovery's commits). */
export function registerCoins(store: CoinStore): void {
  coinStore = store;
}

export const walletCoins = (): CoinStore => coinStore;

/** Coins of a mint or keyset the store does not list are stored but never
 *  counted: list the mint and its keysets first (also for a mint about to be
 *  paid into). The coins are stored either way; a mint that does not answer is
 *  listed by the wallet's next refresh. */
export async function listMint(
  store: Pick<
    WalletStore,
    "mints" | "addMint" | "setMintInfo" | "setKeysets" | "setKeys"
  >,
  mintUrl: string,
  add: Proof[] = []
) {
  const listed = store.mints.find((m) => m.url === mintUrl);
  const ids = new Set(listed?.keysets?.map((k) => keysetOf(k).id));
  if (ids.size && add.every((p) => ids.has(p.id))) return;
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

type Recorder = (entry: { direction: "in" | "out"; amount: string }) => void;
const recorders = new Map<string, Recorder>();

/** Lets purses write `owner`'s activity through its open wallet, which also
 *  publishes it (NIP-60); the returned function takes it back. */
export function registerRecorder(owner: string, record: Recorder): () => void {
  recorders.set(owner, record);
  return () => recorders.delete(owner);
}

/** Activity kept on this device only: chat's per-reply payments and refunds,
 *  so a reply never asks the signer for anything. */
export const localActivity: ActivityLog = {
  record(owner, { direction, sats }) {
    useTransactionHistoryStore
      .of(owner)
      .getState()
      .addHistoryEntry({
        id: crypto.randomUUID(),
        direction,
        amount: String(sats),
        timestamp: Math.floor(Date.now() / 1000),
      });
  },
};

/** Activity of moves the person makes on the wallet screens: published
 *  (NIP-60) through the open wallet, else kept on this device. */
export const legacyActivity: ActivityLog = {
  record(owner, entry) {
    const record = recorders.get(owner);
    if (!record) return localActivity.record(owner, entry);
    record({ direction: entry.direction, amount: String(entry.sats) });
  },
};

// the open account's NIP-60 wallet still loading from relays: coins may yet arrive
let loading: { owner: string | null; is: boolean } = { owner: null, is: false };
const loadingListeners = new Set<() => void>();

/** Set by the app's one recovery hook, which holds the open wallet. */
export function setWalletLoading(owner: string | null, is: boolean): void {
  if (loading.owner === owner && loading.is === is) return;
  loading = { owner, is };
  loadingListeners.forEach((listener) => listener());
}

export const walletLoading = {
  subscribe(listener: () => void): () => void {
    loadingListeners.add(listener);
    return () => loadingListeners.delete(listener);
  },
  of: (owner: string | null): boolean => loading.owner === owner && loading.is,
};
