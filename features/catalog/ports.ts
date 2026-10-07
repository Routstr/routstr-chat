/** A wallet as routing sees it: spendable sats per mint, and the mint it
 *  pays from first. */
export interface WalletView {
  balances: Record<string, number>;
  activeMint: string;
}

/** Where a request is paid: the provider, and the mint its token comes from. */
export interface RouteChoice {
  baseUrl: string;
  mintUrl: string;
}

/** The SDK's own choice for a model and a wallet, from the cache. */
export type Route = (
  modelId: string,
  wallet: WalletView
) => Promise<RouteChoice>;
