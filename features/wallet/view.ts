import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { currentOwner } from "@/features/session/owned";
import { useSession } from "@/features/session/view";
import { saveTransactionHistory } from "@/utils/storageUtils";
import { walletLoading } from "./hooks/purseBridge";
import type { Purse } from "./purse";
import { useTransactionHistoryStore } from "./state/transactionHistoryStore";

export { peek } from "./purse";

/** Each account's purse, filled by the composition root (runtime/wallet's
 *  purseFor). Without it screens have no purse and money buttons do nothing. */
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

/** The signed-in account's activity, newest first: what its wallet sent and
 *  received, and Lightning invoices not paid yet. The wallet writes it; screens
 *  only read it, or clear the records. */
export function useActivity() {
  const entries = useTransactionHistoryStore((s) => s.history);
  const pending = useTransactionHistoryStore((s) => s.pendingTransactions);
  const clearHistory = useTransactionHistoryStore((s) => s.clearHistory);
  const clear = useCallback(() => {
    clearHistory();
    // and the old chat engine's own payment records
    saveTransactionHistory([]);
  }, [clearHistory]);
  return { entries, pending, clear };
}
