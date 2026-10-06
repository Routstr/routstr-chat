import {
  SDK_STORAGE_KEYS as KEY,
  createSdkStore,
  createStorageAdapterFromStore,
  type StorageDriver,
} from "@routstr/sdk/storage";
import { normalizeProviderUrl } from "@routstr/sdk";
import type { StorageAdapter } from "@routstr/sdk/wallet";
import { driver } from "@/sdk/sharedStore";
import { webLock } from "./service";

// main's old store keeps models and providers beside the credit; a sweep
// reads only the credit
const CREDIT = new Set<string>([
  KEY.API_KEYS,
  KEY.CHILD_KEYS,
  KEY.XCASHU_TOKENS,
  KEY.CACHED_RECEIVE_TOKENS,
]);
const creditOnly = (disk: StorageDriver): StorageDriver => ({
  getItem: (key, fallback) =>
    CREDIT.has(key) ? disk.getItem(key, fallback) : Promise.resolve(fallback),
  setItem: (key, value) => disk.setItem(key, value),
  removeItem: (key) => disk.removeItem(key),
});

/** The old store is shared by every account on this device, so its sweep
 *  holds one lock for all of them: two accounts never refund the same key. */
export const lockLegacy = (signal?: AbortSignal) =>
  webLock("routstr-chat-payment:legacy", signal);

/** Credit saved before keys were per account (main's shared `routstr-sdk`
 *  store), as the chat's refunds read it (chat.md `oldCredit`). Every load is
 *  a fresh copy from disk that no one else writes, so a sweep sees what
 *  another tab swept, and a second load never puts back what a sweep in this
 *  tab removed. The node's key is left out: it holds the node's balance. */
export const oldCredit = (nodeUrl: () => string | undefined) => ({
  load: async (): Promise<StorageAdapter> => {
    const { store, hydrate } = createSdkStore({ driver: creditOnly(driver) });
    await hydrate;
    const credit = createStorageAdapterFromStore(store);
    const node = nodeUrl();
    const isNode = (url: string) =>
      !!node && normalizeProviderUrl(url) === normalizeProviderUrl(node);
    return {
      ...credit,
      getApiKey: (url) => (isNode(url) ? null : credit.getApiKey(url)),
      getAllApiKeys: () =>
        credit.getAllApiKeys().filter((key) => !isNode(key.baseUrl)),
      getApiKeyDistribution: () =>
        credit.getApiKeyDistribution().filter((key) => !isNode(key.baseUrl)),
    };
  },
  lock: lockLegacy,
});
