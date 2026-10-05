import { noopLogger } from "@routstr/sdk";
import { RoutstrClient } from "@routstr/sdk/client";
import type {
  BalanceManager,
  StorageAdapter,
  WalletAdapter,
} from "@routstr/sdk/wallet";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import {
  discoveryAdapter,
  storageAdapter as sharedStorage,
  usageTrackingDriver,
} from "@/sdk/sharedStore";

const slash = (url: string) => (url.endsWith("/") ? url : `${url}/`);

export interface RefundResult {
  baseUrl: string;
  success: boolean;
}

export function hasCredit(storage: StorageAdapter): boolean {
  return (
    storage.getAllApiKeys().length > 0 ||
    Object.values(storage.getXcashuTokens()).some((tokens) => tokens.length > 0) ||
    storage.getCachedReceiveTokens().length > 0
  );
}

/**
 * Credit saved before payments were per account (the shared `routstr-sdk`
 * store), minus the node's key: that holds the node's balance, not ours.
 */
export function legacyCredit(nodeUrl?: string): StorageAdapter {
  const isNode = (url: string) => !!nodeUrl && slash(url) === slash(nodeUrl);
  return {
    ...sharedStorage,
    getApiKey: (url) => (isNode(url) ? null : sharedStorage.getApiKey(url)),
    getAllApiKeys: () =>
      sharedStorage.getAllApiKeys().filter((key) => !isNode(key.baseUrl)),
    getApiKeyDistribution: () =>
      sharedStorage
        .getApiKeyDistribution()
        .filter((key) => !isNode(key.baseUrl)),
  };
}

function refundClient(wallet: WalletAdapter, storage: StorageAdapter) {
  return new RoutstrClient(wallet, storage, discoveryAdapter, "min", "apikeys", {
    logger: noopLogger,
    usageTrackingDriver,
  });
}

// A refund pays whole sats only, so small credit waits for the next chat.
const KEEP_BELOW_MSATS = 10_000;

/**
 * Without `force`, small credit stays and keys used in the last five minutes
 * are skipped, since a top-up the SDK sent late may still be landing.
 */
export async function refundStorage(
  wallet: WalletAdapter,
  storage: StorageAdapter,
  force: boolean
): Promise<RefundResult[]> {
  const client = refundClient(wallet, storage);
  const spender = client.getCashuSpender();
  const mintUrl = wallet.getActiveMintUrl() || DEFAULT_MINT_URL;
  const providers = force
    ? await spender.refundProviders(mintUrl, true)
    : await refundLargeCredit(client.getBalanceManager(), storage, mintUrl);
  const xcashu = await spender.refundXcashuTokens(mintUrl);
  const held = await spender.recoverCachedReceiveTokens();
  await storage.flush?.();
  return [
    ...providers,
    ...xcashu.map(({ baseUrl, success }) => ({ baseUrl, success })),
    ...held.map(({ success }) => ({ baseUrl: "held refund", success })),
  ];
}

async function refundLargeCredit(
  balances: BalanceManager,
  storage: StorageAdapter,
  mintUrl: string
): Promise<RefundResult[]> {
  const results: RefundResult[] = [];
  for (const key of storage.getAllApiKeys()) {
    const balance = await balances.getTokenBalance(key.key, key.baseUrl);
    if (!balance.balanceUnknown) {
      // Show the real balance, also for credit left in place.
      storage.updateApiKeyBalance(
        key.baseUrl,
        balance.amount / 1000,
        balance.reserved / 1000
      );
      // An empty or dead key still goes to refundApiKey: it replays a payout
      // the wallet failed to receive, or removes a key the provider forgot.
      if (balance.amount > 0 && balance.amount < KEEP_BELOW_MSATS) continue;
    }
    const { success } = await balances.refundApiKey({
      mintUrl,
      baseUrl: key.baseUrl,
      apiKey: key.key,
      forceRefund: false,
    });
    results.push({ baseUrl: key.baseUrl, success });
  }
  return results;
}
