import type { Proof } from "@cashu/cashu-ts";
import type { Journal } from "@/features/book/journal";
import type { RecoveryHost } from "@/features/book/recovery";
import type { RelayOutcome } from "@/features/relays/service";
import { MintService } from "../core/services/MintService";
import type { ActivityLog, CoinStore } from "../ports";
import type { WalletStore } from "../state/walletStore";
import { useTransactionHistoryStore } from "../state/transactionHistoryStore";

/*
 * What the runtime hands the wallet's own hooks, which may not import it:
 * the tab's coin store and wallet book.
 */

// keysets are stored as cashu-ts objects, which come back from storage with
// their fields as _id and _unit
type StoredKeyset = {
  id?: string;
  _id?: string;
};
const keysetOf = (keyset: object) => {
  const k = keyset as StoredKeyset;
  return { id: k.id ?? k._id };
};

let coinStore: CoinStore | null = null;

/** Where purses keep coins (IndexedDB), registered by the runtime, for the
 *  wallet's own hooks (spent cleanup, recovery's commits). */
export function registerCoins(store: CoinStore): void {
  coinStore = store;
}

export function walletCoins(): CoinStore {
  if (!coinStore) throw new Error("The wallet's coin store is not set up");
  return coinStore;
}

/** The tab's wallet book: its journal, locks and recovery host. */
export interface Book {
  journal: Journal;
  locks?: LockManager;
  recovery: RecoveryHost;
}
let book: Book | null = null;

export function registerBook(registered: Book): void {
  book = registered;
}

export function theBook(): Book {
  if (!book) throw new Error("The wallet book is not set up");
  return book;
}

/** Coins of a mint or keyset the store does not list are stored but never
 *  counted: list the mint and its keysets first (also for a mint about to be
 *  paid into). The coins are stored either way; a mint that does not answer is
 *  listed by the wallet's next refresh. */
export async function listMint(
  store: Pick<
    WalletStore,
    "mints" | "removed" | "addMint" | "setMintInfo" | "setKeysets" | "setKeys"
  >,
  mintUrl: string,
  add: Proof[] = []
) {
  // one the person removed is listed again only when they add it
  if (store.removed?.includes(mintUrl)) return;
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
/** How the last read of an account's wallet copy on relays went. reading:
 *  no answer yet. read: a relay sent all it holds. unanswered: none did
 *  (offline, or every relay timed out, failed, refused or never opened). */
export type CopyStatus = "reading" | "read" | "unanswered";

let copy: {
  owner: string | null;
  status: CopyStatus;
  outcomes: Record<string, RelayOutcome>;
} = { owner: null, status: "reading", outcomes: {} };
const copyListeners = new Set<() => void>();

/** Set by the runtime, which reads the active account's copy. */
export function setWalletCopy(
  owner: string,
  status: CopyStatus,
  outcomes: Record<string, RelayOutcome> = {}
): void {
  copy = { owner, status, outcomes };
  copyListeners.forEach((listener) => listener());
}

export const walletCopy = {
  subscribe(listener: () => void): () => void {
    copyListeners.add(listener);
    return () => copyListeners.delete(listener);
  },
  of: (owner: string | null): typeof copy | null =>
    owner && copy.owner === owner ? copy : null,
};

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
