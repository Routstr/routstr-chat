import type { WalletStore } from "./state/walletStore";

/** The mints the wallet lists: its own, and every one still holding sats,
 *  removed or not, since money is never hidden. */
export const listedMints = (
  own: string[],
  balances: Record<string, number>
): string[] => [
  ...new Set([
    ...own,
    ...Object.keys(balances).filter((url) => balances[url] > 0),
  ]),
];

/** Takes a mint off the wallet: out of its NIP-60 event (published first, so
 *  a failure changes nothing) and out of its list, where the wallet itself no
 *  longer puts it back. A mint already off is left as it is. */
export async function takeOffMint(
  url: string,
  {
    event,
    publish,
    store,
  }: {
    event?: { privkey: string; mints: string[] };
    publish: (wallet: { privkey: string; mints: string[] }) => Promise<unknown>;
    store: Pick<WalletStore, "removeMint">;
  }
): Promise<void> {
  if (event?.mints.includes(url)) {
    await publish({
      privkey: event.privkey,
      mints: event.mints.filter((mint) => mint !== url),
    });
  }
  store.removeMint(url);
}
