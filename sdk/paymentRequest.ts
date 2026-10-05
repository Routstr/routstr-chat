import type { StorageAdapter, WalletAdapter } from "@routstr/sdk/wallet";

/**
 * This account's payment lock, shared by all tabs. Requests and refunds both
 * hold it, so a refund never runs while a reply is being paid for.
 */
export function acquirePaymentLock(
  owner: string,
  signal?: AbortSignal
): Promise<() => void> {
  if (!navigator.locks) {
    return Promise.reject(
      new Error("This browser cannot safely coordinate payments across tabs.")
    );
  }
  return new Promise((resolve, reject) => {
    navigator.locks
      .request(`routstr-chat-payment:${owner}`, { signal }, () =>
        new Promise<void>((release) => resolve(release))
      )
      .catch(reject);
  });
}

export function bindProviderStorage(
  storage: StorageAdapter,
  provider: string
): StorageAdapter {
  const base = provider.endsWith("/") ? provider : `${provider}/`;
  return {
    ...storage,
    getApiKey(url) {
      if ((url.endsWith("/") ? url : `${url}/`) !== base) {
        throw new Error(
          "Provider failed. Choose a provider before sending again."
        );
      }
      return storage.getApiKey(url);
    },
    getAllApiKeys: () =>
      storage.getAllApiKeys().filter((key) => key.baseUrl === base),
    getApiKeyDistribution: () =>
      storage.getApiKeyDistribution().filter((key) => key.baseUrl === base),
  };
}

export function bindPaymentWallet(
  wallet: WalletAdapter,
  isCurrent: () => boolean,
  signal: AbortSignal,
  nodePays: boolean,
  hold: (
    token: string
  ) => Promise<{ amount: number; unit: "sat" | "msat"; added: boolean }>
): WalletAdapter {
  const check = () => {
    if (signal.aborted || !isCurrent()) {
      throw new DOMException(
        "Account or payment source changed. Send again.",
        "AbortError"
      );
    }
  };
  return {
    getBalances: async () => {
      check();
      return wallet.getBalances();
    },
    getMintUnits: () => {
      check();
      return wallet.getMintUnits();
    },
    getActiveMintUrl: () => {
      check();
      return wallet.getActiveMintUrl();
    },
    sendToken: async (...args) => {
      check();
      if (nodePays)
        throw new Error("Node mode: refusing to pay from your wallet.");
      return wallet.sendToken(...args);
    },
    // A refund belongs to the account that paid: after a switch, hold it for
    // that account. An already-held token reports failure so the SDK keeps it.
    receiveToken: async (token) => {
      if (isCurrent()) return wallet.receiveToken(token);
      const { amount, unit, added } = await hold(token);
      return { success: added, amount, unit };
    },
  };
}
