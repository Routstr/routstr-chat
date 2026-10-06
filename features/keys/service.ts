import {
  createIndexedDBDriver,
  createSdkStore,
  createStorageAdapterFromStore,
  type SdkStore,
  type StorageDriver,
} from "@routstr/sdk/storage";
import type { ApiKeyEntry, StorageAdapter } from "@routstr/sdk/wallet";

/* One account's credit at providers: API keys, X-Cashu tokens, child keys
   and refunds held for it. Same storage as main, so nothing moves on upgrade:
   IndexedDB `routstr-chat-payments:<pubkey>:<direct|node>` in the SDK's own
   format, and the per-account lock main's tabs also take. */

export type PaySource = "direct" | "node";

export const dbName = (owner: string, source: PaySource) =>
  `routstr-chat-payments:${owner}:${source}`;

class Credit {
  readonly store: SdkStore;
  readonly storage: StorageAdapter;
  readonly hydrate: Promise<void>;

  constructor(private readonly driver: StorageDriver) {
    const { store, hydrate } = createSdkStore({ driver });
    this.store = store;
    this.hydrate = hydrate;
    this.storage = createStorageAdapterFromStore(store);
  }

  /** Reads what another tab wrote. The SDK store only writes on change, so a
   *  second store over the same driver gives the current disk state. */
  async reload(): Promise<void> {
    await this.hydrate;
    await this.storage.flush?.();
    const disk = createSdkStore({ driver: this.driver });
    await disk.hydrate;
    const { apiKeys, childKeys, xcashuTokens, cachedReceiveTokens } =
      disk.store.getState();
    this.store.setState({
      apiKeys,
      childKeys,
      xcashuTokens,
      cachedReceiveTokens,
    });
  }
}

/** Holds a Web Lock (shared by every tab) until the returned release runs. */
export function webLock(
  name: string,
  signal?: AbortSignal
): Promise<() => void> {
  if (!navigator.locks) {
    return Promise.reject(
      new Error("This browser cannot safely coordinate payments across tabs.")
    );
  }
  return new Promise((resolve, reject) => {
    navigator.locks
      .request(
        name,
        { signal },
        () => new Promise<void>((release) => resolve(release))
      )
      .catch(reject);
  });
}

export class KeysService {
  private readonly credit = new Map<PaySource, Credit>();

  constructor(
    readonly owner: string,
    private readonly open: (name: string) => StorageDriver
  ) {}

  private of(source: PaySource): Credit {
    let credit = this.credit.get(source);
    if (!credit) {
      credit = new Credit(this.open(dbName(this.owner, source)));
      this.credit.set(source, credit);
    }
    return credit;
  }

  ready(source: PaySource = "direct"): Promise<void> {
    return this.of(source).hydrate;
  }

  storage(source: PaySource = "direct"): StorageAdapter {
    return this.of(source).storage;
  }

  /** Requests, refunds and restores of this account hold it, in every tab. */
  lock(signal?: AbortSignal): Promise<() => void> {
    return webLock(`routstr-chat-payment:${this.owner}`, signal);
  }

  reload(source: PaySource = "direct"): Promise<void> {
    return this.of(source).reload();
  }

  async flush(source: PaySource = "direct"): Promise<void> {
    await this.of(source).storage.flush?.();
  }

  keys(): ApiKeyEntry[] {
    return this.of("direct").storage.getAllApiKeys();
  }

  subscribe(listener: () => void): () => void {
    return this.of("direct").store.subscribe((state, previous) => {
      if (state.apiKeys !== previous.apiKeys) listener();
    });
  }

  /** Calls `listener` when the credit held at providers may have changed:
   *  the keys, X-Cashu tokens, or refunds not taken in yet. */
  subscribeCredit(listener: () => void): () => void {
    return this.of("direct").store.subscribe((state, previous) => {
      if (
        state.apiKeys !== previous.apiKeys ||
        state.xcashuTokens !== previous.xcashuTokens ||
        state.cachedReceiveTokens !== previous.cachedReceiveTokens
      ) {
        listener();
      }
    });
  }
}

const services = new Map<string, KeysService>();

/** This account's keys, one service per account per tab. */
export function keysFor(owner: string): KeysService {
  let keys = services.get(owner);
  if (!keys) {
    keys = new KeysService(owner, (name) =>
      createIndexedDBDriver({ dbName: name })
    );
    services.set(owner, keys);
  }
  return keys;
}
