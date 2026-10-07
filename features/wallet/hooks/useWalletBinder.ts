import { useContext, useEffect } from "react";
import { walletLock } from "@/features/book/executor";
import { RelaysContext } from "@/features/relays/view";
import { currentOwner } from "@/features/session/owned";
import { CASHU_EVENT_KINDS } from "@/lib/cashu";
import { normalizeMintUrl } from "@/features/book/mint";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import { dropSpent } from "../spent";
import { useCashuStore } from "../state/cashuStore";
import { useBalances, usePurseOf } from "../view";
import { walletCoins } from "./purseBridge";
import { useCashuWallet } from "./useCashuWallet";
import { useCreateCashuWallet } from "./useCreateCashuWallet";

// one wallet made at a time per account in this tab (a double effect, a second mount)
const making = new Map<string, Promise<unknown>>();

/**
 * The signed-in account's wallet, kept in order while the app runs. Its NIP-60
 * wallet is made once, and only when the relays answered that it has none: at
 * least one sent its end of stored events, and none that got the request went
 * silent or failed after it (it may hold the wallet: nothing is made on this
 * load). One that refused (CLOSED, auth-required) or never opened is left
 * out, so it cannot keep a first wallet from being made. Coins the mint
 * already saw spent leave on load. An active mint is set when there is none,
 * and an empty one gives way to a mint with money, unless the person picked
 * it. Mount it once per account.
 */
export function useWalletBinder() {
  const relays = useContext(RelaysContext);
  const { owner, wallet, isLoading } = useCashuWallet();
  const { mutateAsync: createWallet } = useCreateCashuWallet();
  const balances = useBalances(owner ?? null);
  const purseOf = usePurseOf();
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
        const { events, answered, outcomes } = await account.fetch({
          kinds: [CASHU_EVENT_KINDS.WALLET],
          authors: [owner],
          limit: 1,
        });
        const unsure = Object.entries(outcomes).filter(
          ([, outcome]) => outcome === "timeout" || outcome === "error"
        );
        Object.entries(outcomes)
          .filter(([, outcome]) => outcome === "closed")
          .forEach(([url]) =>
            console.warn(`${url} refused to say if a wallet exists`)
          );
        // the create signs as whoever is active: never for an account the
        // person switched to while the relays were asked
        if (currentOwner() !== owner) return;
        if (answered.length > 0 && !unsure.length && !events.length) {
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
    // tokens received while their mint could not be reached
    void purseOf(owner)
      ?.retryPending()
      .catch((error) =>
        console.error("Could not try the waiting tokens:", error)
      );
    for (const mint of new Set((wallet.mints ?? []).map(normalizeMintUrl))) {
      dropSpent(owner, mint, { coins: walletCoins(), locks }).catch((error) =>
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
