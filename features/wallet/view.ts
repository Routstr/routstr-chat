import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { Proof } from "@cashu/cashu-ts";
import { normalizeMintUrl } from "@/features/book/mint";
import { currentOwner } from "@/features/session/owned";
import { useSession } from "@/features/session/view";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import { saveTransactionHistory } from "@/utils/storageUtils";
import { MintService } from "./core/services/MintService";
import { depositMint } from "./depositMint";
import { takeOffMint } from "./mintList";
import {
  listMint,
  walletCoins,
  walletCopy,
  walletLoading,
  type CopyStatus,
} from "./hooks/purseBridge";
import { useWalletEvent } from "./hooks/useWalletEvent";
import type { RelayOutcome } from "@/features/relays/service";
import type { UsageLog } from "./ports";
import { toSats, type Purse } from "./purse";
import { dropSpent } from "./spent";
import { useWalletStore } from "./state/walletStore";
import {
  useTransactionHistoryStore,
  type PendingTransaction,
} from "./state/transactionHistoryStore";
import { useUnclaimedTokensStore } from "./state/unclaimedTokensStore";

export { peek } from "./purse";
export { listedMints } from "./mintList";

/** The signed-in account's mints (every one that holds a coin, and the ones
 *  it added), the one it pays from, and whether the person picked that one:
 *  the wallet's own store, which main's old list only seeded. */
export const useMints = useWalletStore;

/** Each account's purse for the person's own moves, filled by the composition
 *  root (runtime/wallet's walletPurseFor). Without it screens have no purse and
 *  money buttons do nothing. */
export const PurseContext = createContext<((owner: string) => Purse) | null>(
  null
);

/** The purse of the account active when it is called: a key made a moment
 *  ago (the first money in) is the one paid into. Null with no account. A
 *  purse is one account's for good, so what it began settles there. */
export function usePurse(): () => Purse | null {
  const purseFor = useContext(PurseContext);
  return useCallback(() => {
    const owner = currentOwner();
    return owner && purseFor ? purseFor(owner) : null;
  }, [purseFor]);
}

/** The purse of a given account, for work that began for it: a deposit is
 *  claimed into the account that made the invoice, whoever is active now. */
export function usePurseOf(): (owner: string) => Purse | null {
  const purseFor = useContext(PurseContext);
  return useCallback(
    (owner) => (purseFor ? purseFor(owner) : null),
    [purseFor]
  );
}

/** This account's spendable sats per mint, read again when its coins change
 *  here; null until the first read, and with no account. */
export function useBalances(
  owner: string | null
): Record<string, number> | null {
  const purseFor = useContext(PurseContext);
  const [read, setRead] = useState<{
    owner: string;
    balances: Record<string, number>;
  } | null>(null);
  useEffect(() => {
    if (!owner || !purseFor) return;
    const purse = purseFor(owner);
    let live = true;
    const load = () =>
      void purse.balances().then((balances) => {
        if (live) setRead({ owner, balances });
      });
    load();
    const stop = purse.subscribe(load);
    return () => {
      live = false;
      stop();
    };
  }, [owner, purseFor]);
  return read?.owner === owner ? read.balances : null;
}

/** The signed-in account's money for the screens, in whole sats: per mint, in
 *  all, and whether its coins may still be arriving (its NIP-60 wallet is
 *  loading from relays). Each mount reads the coins itself: share one where
 *  the screens can. */
export function useWallet(): {
  balances: Record<string, number>;
  total: number;
  loading: boolean;
} {
  const { pubkey } = useSession();
  const balances = useBalances(pubkey);
  const arriving = useSyncExternalStore(
    walletLoading.subscribe,
    () => walletLoading.of(pubkey),
    () => false
  );
  return {
    balances: balances ?? {},
    total: Object.values(balances ?? {}).reduce((sum, n) => sum + n, 0),
    loading: arriving || (!!pubkey && !balances),
  };
}

/** How the last read of the signed-in account's wallet copy on relays went:
 *  "reading" until relays answered, "read" once one sent all it holds, and
 *  "unanswered" when none did (offline, or each timed out, failed, refused
 *  or never opened), with each relay's outcome. App's relay notice shows on
 *  "unanswered"; it is read again on every reload, switch and live event. */
export function useWalletCopy(): {
  status: CopyStatus;
  outcomes: Record<string, RelayOutcome>;
} {
  const { pubkey } = useSession();
  const now = useSyncExternalStore(
    walletCopy.subscribe,
    () => walletCopy.of(pubkey),
    () => null
  );
  return now ?? { status: "reading", outcomes: NONE };
}
const NONE: Record<string, RelayOutcome> = {};

/** How many coins the signed-in account holds (Settings → Console). */
export function useCoinCount(): number {
  const { pubkey } = useSession();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!pubkey) return;
    const coins = walletCoins();
    let live = true;
    const load = () =>
      void coins.coins(pubkey).then((all) => {
        if (live) setCount(all.length);
      });
    load();
    const stop = coins.subscribe(pubkey, load);
    return () => {
      live = false;
      stop();
    };
  }, [pubkey]);
  return pubkey ? count : 0;
}

/** The signed-in account's activity, newest first: what its wallet sent and
 *  received, and Lightning invoices not paid yet. The wallet writes it; screens
 *  only read it, or clear the records. */
export function useActivity() {
  const entries = useTransactionHistoryStore((s) => s.history);
  const invoices = useTransactionHistoryStore((s) => s.pendingTransactions);
  // received tokens whose mint could not be reached yet: not in the balance
  const waiting = useUnclaimedTokensStore((s) => s.waitingTokens);
  const pending = useMemo(
    (): PendingTransaction[] => [
      ...invoices,
      ...waiting.map((t) => ({
        id: t.id,
        direction: "in" as const,
        amount: String(toSats(t.amount, t.unit)),
        timestamp: Math.floor(t.createdAt / 1000),
        status: "pending" as const,
        mintUrl: t.mintUrl,
        quoteId: "",
        paymentRequest: "",
      })),
    ],
    [invoices, waiting]
  );
  const clearHistory = useTransactionHistoryStore((s) => s.clearHistory);
  const clear = useCallback(() => {
    clearHistory();
    // and the old chat engine's own payment records
    saveTransactionHistory([]);
  }, [clearHistory]);
  return { entries, pending, clear };
}

/** Asks the provider a token was handed to what it holds for it (keys'
 *  adopt): the key's sats, 0 when the provider says it was spent elsewhere;
 *  throws when it does not answer. Filled by the composition root for the
 *  token's owner, so the wallet never imports keys. */
export const AdoptContext = createContext<
  ((owner: string, token: string, baseUrl: string) => Promise<number>) | null
>(null);

/** The SDK's usage log, the one replies are recorded in; filled by the
 *  composition root. Without it Usage shows nothing. */
export const UsageLogContext = createContext<UsageLog | null>(null);

/** The mints the provider about to be paid takes, for `sats` of new money,
 *  read when money is added; filled by the composition root from the catalog,
 *  empty while none is known. The wallet never imports chat. */
export const AcceptedMintsContext = createContext<(sats: number) => string[]>(
  () => []
);

/** Where `sats` of new money should go, so the provider can take it (see
 *  depositMint), given the account's sats per mint. The wallet lists that mint
 *  and its keysets too, so what lands there counts at once. */
export function useDepositMint(): (
  balances: Record<string, number>,
  sats: number
) => string {
  const accepted = useContext(AcceptedMintsContext);
  return useCallback(
    (balances, sats) => {
      const { activeMintUrl, userSelectedMintUrl, mints } =
        useWalletStore.getState();
      const url = depositMint({
        active: activeMintUrl,
        picked: !!activeMintUrl && activeMintUrl === userSelectedMintUrl,
        known: mints.map((m) => m.url),
        balances,
        accepted: accepted(sats),
        fallback: DEFAULT_MINT_URL,
      });
      void listMint(useWalletStore.getState(), url);
      return url;
    },
    [accepted]
  );
}

/** Settings → Payments' edits of the wallet's mints: add one (its keysets
 *  asked for, and put in the wallet event), take one off (takeOffMint), and
 *  drop the coins a mint says are spent. */
export function useMintActions() {
  const cashuStore = useWalletStore();
  const { wallet, publish } = useWalletEvent();

  const ensureMintInitialized = async (mintUrl: string) => {
    const normalizedMintUrl = normalizeMintUrl(mintUrl);
    const existingMint = cashuStore.mints.find(
      (mint) => mint.url === normalizedMintUrl
    );
    const needsActivation =
      !existingMint ||
      !existingMint.mintInfo ||
      !existingMint.keysets?.length ||
      !existingMint.keys?.length ||
      !existingMint.keysets[0].id;

    if (!existingMint) {
      cashuStore.addMint(normalizedMintUrl, true);
    }

    if (needsActivation) {
      try {
        const mintService = new MintService();
        const { mintInfo, keysets, keys } =
          await mintService.activateMint(normalizedMintUrl);
        cashuStore.setMintInfo(normalizedMintUrl, mintInfo);
        cashuStore.setKeysets(normalizedMintUrl, keysets);
        cashuStore.setKeys(normalizedMintUrl, keys);
      } catch (err) {
        console.error("Failed to initialize mint data:", err);
      }
    }

    return normalizedMintUrl;
  };

  const addMintIfNotExists = async (mintUrl: string) => {
    const normalizedMintUrl = await ensureMintInitialized(mintUrl);

    try {
      new URL(normalizedMintUrl);
    } catch (err) {
      throw new Error("Invalid mint URL: " + mintUrl);
    }

    if (!wallet) {
      console.warn(
        "Wallet not loaded when trying to add mint URL:",
        normalizedMintUrl
      );
      return normalizedMintUrl;
    }

    if (!wallet.mints.includes(normalizedMintUrl)) {
      try {
        await publish({
          privkey: wallet.privkey,
          mints: [...wallet.mints, normalizedMintUrl],
        });
      } catch (err) {
        console.error("Failed to persist mint URL to wallet:", err);
      }
    }

    return normalizedMintUrl;
  };

  const removeMint = (mintUrl: string) =>
    takeOffMint(mintUrl, { event: wallet, publish, store: cashuStore });

  /** The account's coins at this mint that the mint says are spent leave
   *  the wallet; resolves with them. */
  const cleanSpentProofs = async (mintUrl: string): Promise<Proof[]> => {
    const owner = currentOwner();
    const locks = globalThis.navigator?.locks;
    if (!owner || !locks) return [];
    return dropSpent(owner, normalizeMintUrl(mintUrl), {
      coins: walletCoins(),
      locks,
    });
  };

  return {
    cleanSpentProofs,
    addMintIfNotExists,
    removeMint,
  };
}
