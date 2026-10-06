import { useContext, useEffect } from "react";
import { walletLock } from "@/features/book/executor";
import { RelaysContext } from "@/features/relays/view";
import { currentOwner } from "@/features/session/owned";
import { CASHU_EVENT_KINDS } from "@/lib/cashu";
import { normalizeMintUrl } from "@/features/book/mint";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import { dropSpent } from "../spent";
import { useCashuStore } from "../state/cashuStore";
import { useBalances } from "../view";
import { legacyCoins } from "./purseBridge";
import { useCashuWallet } from "./useCashuWallet";
import { useCreateCashuWallet } from "./useCreateCashuWallet";

// one wallet made at a time per account in this tab (a double effect, a second mount)
const making = new Map<string, Promise<unknown>>();

/**
 * The signed-in account's wallet, kept in order while the app runs. Its NIP-60
 * wallet is made once, and only when the relays answered that it has none:
 * every relay that connected sent its end of stored events, and at least one
 * did. A relay that connected and went silent may hold the wallet, so nothing
 * is made on this load; one that never connected is left out. Coins the mint
 * already saw spent leave on load. An active mint is set when there is none,
 * and an empty one gives way to a mint with money, unless the person picked
 * it. Mount it once per account.
 */
export function useWalletBinder() {
  const relays = useContext(RelaysContext);
  const { owner, wallet, isLoading } = useCashuWallet();
  const { mutateAsync: createWallet } = useCreateCashuWallet();
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
        const urls = account.urls();
        const { events, answered } = await account.fetch({
          kinds: [CASHU_EVENT_KINDS.WALLET],
          authors: [owner],
          limit: 1,
        });
        const silent = urls.filter(
          (url) => !answered.includes(url) && relays.port.status(url) === "ok"
        );
        // the create signs as whoever is active: never for an account the
        // person switched to while the relays were asked
        if (currentOwner() !== owner) return;
        if (answered.length > 0 && !silent.length && !events.length) {
          await createWallet();
        }
      })
      .catch((error) => console.error("Could not make the wallet:", error))
      .finally(() => making.delete(owner));
    making.set(owner, made);
  }, [owner, isLoading, wallet, relays, createWallet]);

  useEffect(() => {
    const locks = globalThis.navigator?.locks;
    if (!owner || !wallet || !locks) return;
    for (const mint of new Set((wallet.mints ?? []).map(normalizeMintUrl))) {
      dropSpent(owner, mint, { coins: legacyCoins, locks }).catch((error) =>
        console.error(`Could not check ${mint}'s coins:`, error)
      );
    }
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
