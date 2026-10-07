import type { StorageAdapter, WalletAdapter } from "@routstr/sdk/wallet";
import type { Pay } from "@/features/chat/ports";
import { withNodeModeError } from "./nodeErrors";
import { lockedAfter } from "./lateWrites";
import type { Keys, Purse, Sdk, Spending } from "./ports";

interface PayDeps {
  keys: Keys;
  purse: Purse;
  sdk: Sdk;
  spending(): Spending;
  /** The account is still the one in use. */
  live(): boolean;
}

// NUT error code: the mint saw these proofs spent already
const ALREADY_SPENT = 11001;

const sourceChanged = () =>
  new DOMException(
    "Account or payment source changed. Send again.",
    "AbortError"
  );

/**
 * The wallet as the SDK sees it during one request or refund. It spends only
 * while `canSpend` holds, never in node mode; refunds always reach the purse,
 * which belongs to the account that started the request. Every amount is in
 * sats, so no mint is reported as msat.
 */
export function sdkWallet(
  purse: Purse,
  canSpend: () => boolean,
  node: boolean,
  recover?: (token: string) => Promise<number | undefined>
): WalletAdapter {
  const check = () => {
    if (!canSpend()) throw sourceChanged();
  };
  return {
    getBalances: async () => {
      check();
      return purse.balances();
    },
    getMintUnits: () => ({}),
    getActiveMintUrl: () => {
      check();
      return purse.activeMint();
    },
    sendToken: async (mintUrl, amount, _p2pk, persistToken) => {
      check();
      if (node) throw new Error("Node mode: refusing to pay from your wallet.");
      return purse.send(mintUrl, amount, persistToken);
    },
    receiveToken: async (token) => {
      try {
        return {
          success: true,
          amount: (await purse.take(token)).sats,
          unit: "sat",
        };
      } catch (error) {
        // The mint says it is spent: `recover` asks the provider what it holds
        // for it. Spent elsewhere (a payout this wallet already took), or now
        // an exported key: the wallet received nothing either way.
        if ((error as { code?: number }).code === ALREADY_SPENT && recover) {
          try {
            if ((await recover(token)) !== undefined) {
              return { success: true, amount: 0, unit: "sat" };
            }
          } catch (adoptError) {
            console.warn(
              "The provider did not say what it holds yet",
              adoptError
            );
          }
        }
        // The SDK keeps the key or the X-Cashu token and claims it again later
        return {
          success: false,
          amount: 0,
          unit: "sat",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/** Pays for each request of one account through the Routstr SDK. */
export function createPay(deps: PayDeps): Pay {
  return async ({ messages, model }, callbacks, signal) => {
    const spending = deps.spending();
    const { node } = spending;
    const source = node ? "node" : "direct";
    // A request that started in one mode must not route in the other: the
    // SDK's own discovery would turn an unreviewed node off for good
    const sameSource = () => deps.spending().node?.url === node?.url;
    const release = await deps.keys.lock(signal);
    // The SDK may top a key up in the background after the answer: once the
    // lock is released that must not spend, or two payments would overlap
    let settled = false;
    // A spend already past that check finishes under the lock, its handoff
    // included: that handoff runs inside the wallet's lock, so it must never
    // wait for this one
    let released = false;
    const sends = new Set<Promise<string>>();
    const purse: Purse = {
      ...deps.purse,
      send: (...args) => {
        const sent = deps.purse.send(...args);
        sends.add(sent);
        return sent;
      },
    };
    try {
      await deps.keys.reload(source);
      if (signal.aborted) return;
      if (!sameSource()) throw sourceChanged();
      const storage = lockedAfter(
        deps.keys.storage(source),
        () => released,
        deps.keys,
        source
      );
      if (node) {
        await deps.sdk.ensureNode(node.url);
        // setApiKey refuses to overwrite a key
        if (storage.getApiKey(node.url)?.key !== node.apiKey) {
          storage.replaceApiKey!(node.url, node.apiKey);
          await deps.keys.flush("node");
        }
        if (!sameSource()) throw sourceChanged();
      }
      const wallet = sdkWallet(
        purse,
        () => !settled && !signal.aborted && deps.live() && sameSource(),
        Boolean(node)
      );
      const warm = deps.sdk.warm();
      await deps.sdk.request(
        {
          messageHistory: messages,
          modelId: model.id,
          // The node is the only provider in node mode. Elsewhere a pinned
          // provider is forced only when the SDK reads our warm cache: cold, it
          // refetches and throws if that provider dropped the model.
          forcedProvider: node
            ? node.url
            : (warm && model.provider) || undefined,
          torMode: deps.sdk.torMode(),
          mode: !node && spending.mode === "xcashu" ? "xcashu" : "apikeys",
          walletAdapter: wallet,
          storageAdapter: storage,
          abortSignal: signal,
          ...warm,
        },
        node
          ? {
              ...callbacks,
              onMessageAppend: (message) =>
                callbacks.onMessageAppend(withNodeModeError(message)),
            }
          : callbacks
      );
    } finally {
      settled = true;
      await Promise.allSettled(sends);
      released = true;
      try {
        await deps.keys.flush(source);
      } finally {
        release();
      }
    }
  };
}
