import type {
  ApiKeyEntry,
  BalanceManager,
  StorageAdapter,
  WalletAdapter,
} from "@routstr/sdk/wallet";
import { lockedAfter } from "./lateWrites";
import type { Keys, OldCredit, OtherDevices, Purse, Sdk } from "./ports";
import { sdkWallet } from "./request";

export interface RefundResult {
  baseUrl: string;
  success: boolean;
}

interface RefundDeps {
  keys: Keys;
  purse: Purse;
  sdk: Sdk;
  oldCredit: OldCredit;
  otherDevices: OtherDevices;
  live(): boolean;
}

// A refund pays whole sats only, so small credit waits for the next chat
const KEEP_BELOW_MSATS = 10_000;
// The SDK skips a key used this recently: a late top-up may still be landing
const RECENT_MS = 5 * 60 * 1000;

const due = (key: ApiKeyEntry) =>
  !key.lastUsed || Date.now() - key.lastUsed >= RECENT_MS;

/** Credit a refund would act on; `force` counts keys just used too. */
const hasCredit = (storage: StorageAdapter, force = true) =>
  storage.getAllApiKeys().some((key) => force || due(key)) ||
  Object.values(storage.getXcashuTokens()).some(
    (tokens) => tokens.length > 0
  ) ||
  storage.getCachedReceiveTokens().length > 0;

/**
 * Brings this account's provider credit back into its wallet. It takes the
 * payment lock, so it waits for a running reply. `force` (the Refund button)
 * takes everything, also keys the account's other devices made; otherwise
 * keys used in the last five minutes and credit under 10 sats stay for the
 * next chat.
 */
export async function refundCredit(
  deps: RefundDeps,
  force: boolean
): Promise<RefundResult[]> {
  const { keys } = deps;
  const [, old] = await Promise.all([keys.ready(), deps.oldCredit.load()]);
  if (!force && !hasCredit(keys.storage("direct"), false) && !hasCredit(old)) {
    return [];
  }
  let results: RefundResult[];
  let refunded: string[] = [];
  let released = false;
  const release = await keys.lock();
  try {
    await keys.reload("direct");
    const wallet = sdkWallet(deps.purse, deps.live, false);
    const storage = lockedAfter(
      keys.storage("direct"),
      () => released,
      keys,
      "direct"
    );
    results = await refundStorage(deps.sdk, wallet, storage, force);
    if (force) {
      const others = await refundOthers(deps, wallet);
      results.push(...others.results);
      refunded = others.refunded;
    }
    if (hasCredit(old)) results.push(...(await sweepOld(deps, wallet)));
  } finally {
    released = true;
    try {
      await keys.flush("direct");
    } finally {
      release();
    }
  }
  // Forgetting them publishes the key backup, which can wait on the signer:
  // never while holding the payment lock, and never holding up the refund
  if (refunded.length) {
    void deps.otherDevices
      .drop(refunded)
      .catch((error) =>
        console.warn("Could not forget refunded keys yet", error)
      );
  }
  return results;
}

/** main's old shared store, under its device-wide lock and read again under
 *  it: another tab may have swept it while this one waited. */
async function sweepOld(deps: RefundDeps, wallet: WalletAdapter) {
  const release = await deps.oldCredit.lock();
  try {
    // No chat uses the old store's keys, so nothing there waits for one
    return await refundStorage(
      deps.sdk,
      wallet,
      await deps.oldCredit.load(),
      true
    );
  } finally {
    release();
  }
}

async function refundStorage(
  sdk: Sdk,
  wallet: WalletAdapter,
  storage: StorageAdapter,
  force: boolean
): Promise<RefundResult[]> {
  const client = sdk.client(wallet, storage);
  const spender = client.getCashuSpender();
  const mintUrl = wallet.getActiveMintUrl()!;
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
  // asking the provider about a key just used would only hold the lock longer
  for (const key of storage.getAllApiKeys().filter(due)) {
    const balance = await balances.getTokenBalance(key.key, key.baseUrl);
    if (!balance.balanceUnknown) {
      // Show the real balance, also for credit left in place
      storage.updateApiKeyBalance(
        key.baseUrl,
        balance.amount / 1000,
        balance.reserved / 1000
      );
      // An empty or dead key still goes to refundApiKey: it replays a payout
      // the wallet failed to receive, or removes a key the provider forgot
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

/** A lost device's keys live only in the relay backup. */
async function refundOthers(deps: RefundDeps, wallet: WalletAdapter) {
  const balances = deps.sdk
    .client(wallet, deps.keys.storage("direct"))
    .getBalanceManager();
  const mintUrl = wallet.getActiveMintUrl()!;
  const results: RefundResult[] = [];
  const refunded: string[] = [];
  for (const key of deps.otherDevices.keys()) {
    // A key the provider forgot is done. Every other one goes to the
    // provider, even when it reads empty: a payout this wallet missed is
    // paid again.
    const { isInvalidApiKey } = await balances.getTokenBalance(
      key.key,
      key.baseUrl
    );
    const { success } = isInvalidApiKey
      ? { success: true }
      : await balances.refundApiKey({
          mintUrl,
          baseUrl: key.baseUrl,
          apiKey: key.key,
          forceRefund: true,
        });
    results.push({ baseUrl: key.baseUrl, success });
    if (success) refunded.push(key.key);
  }
  return { results, refunded };
}
