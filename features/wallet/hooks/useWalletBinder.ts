import { useContext, useEffect } from "react";
import { walletLock } from "@/features/book/executor";
import { RelaysContext } from "@/features/relays/view";
import { CASHU_EVENT_KINDS } from "@/lib/cashu";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import { useCashuStore } from "../state/cashuStore";
import { useBalances } from "../view";
import { useCashuToken } from "./useCashuToken";
import { useCashuWallet } from "./useCashuWallet";
import { useCreateCashuWallet } from "./useCreateCashuWallet";

// one wallet made at a time per account in this tab (a double effect, a second mount)
const making = new Map<string, Promise<unknown>>();

/**
 * The signed-in account's wallet, kept in order while the app runs. Its NIP-60
 * wallet is made once, and only when the relays answered that it has none:
 * never on silence, a timeout or a copy this device could not read. Coins the
 * mint already saw spent leave on load, under the account's wallet lock. An
 * active mint is set when there is none, and an empty one gives way to a mint
 * with money, unless the person picked it. Mount it once per account.
 */
export function useWalletBinder() {
  const relays = useContext(RelaysContext);
  const { owner, wallet, isLoading } = useCashuWallet();
  const { mutateAsync: createWallet } = useCreateCashuWallet();
  const { cleanSpentProofs } = useCashuToken();
  const balances = useBalances(owner ?? null);
  const cashuStore = useCashuStore();

  useEffect(() => {
    const locks = globalThis.navigator?.locks;
    if (!owner || isLoading || wallet || !relays || !locks) return;
    if (making.has(owner)) return;
    const made = locks
      .request(walletLock(owner), async () => {
        const account = relays.of(owner);
        // the person's own relays (NIP-65) are asked too
        await account.ready();
        const { events, answered } = await account.fetch({
          kinds: [CASHU_EVENT_KINDS.WALLET],
          authors: [owner],
          limit: 1,
        });
        if (answered.length > 0 && events.length === 0) await createWallet();
      })
      .catch((error) => console.error("Could not make the wallet:", error))
      .finally(() => making.delete(owner));
    making.set(owner, made);
  }, [owner, isLoading, wallet, relays, createWallet]);

  useEffect(() => {
    const locks = globalThis.navigator?.locks;
    if (!owner || !wallet || !locks) return;
    void locks.request(walletLock(owner), async () => {
      for (const mint of wallet.mints ?? []) {
        await cleanSpentProofs(mint).catch((error) =>
          console.error(`Could not check ${mint}'s coins:`, error)
        );
      }
    });
    // once per wallet loaded, not per render of the hook
  }, [owner, wallet]);

  const { activeMintUrl, userSelectedMintUrl } = cashuStore;
  useEffect(() => {
    if (activeMintUrl) return;
    if (!cashuStore.mints.some((m) => m.url === DEFAULT_MINT_URL)) {
      cashuStore.addMint(DEFAULT_MINT_URL);
    }
    cashuStore.setActiveMintUrl(DEFAULT_MINT_URL);
  }, [activeMintUrl, cashuStore]);

  useEffect(() => {
    if (!balances || !activeMintUrl) return;
    // a choice the person saved wins, even an empty mint
    if (userSelectedMintUrl === activeMintUrl) return;
    if ((balances[activeMintUrl] ?? 0) > 0) return;
    const [best] = Object.entries(balances)
      .filter(([, sats]) => sats > 0)
      .sort((a, b) => b[1] - a[1]);
    if (best) cashuStore.setActiveMintUrl(best[0]);
  }, [balances, activeMintUrl, userSelectedMintUrl, cashuStore]);
}
