import { vi } from "vitest";
import { getEncodedTokenV4 } from "@cashu/cashu-ts";
import { RoutstrClient } from "@routstr/sdk/client";
import {
  createDiscoveryAdapterFromStore,
  createMemoryDriver,
  createMemoryUsageTrackingDriver,
  createSdkStore,
  createStorageAdapterFromStore,
} from "@routstr/sdk/storage";
import { noopLogger } from "@routstr/sdk";
import type { Keys, PaySource, Purse, Sdk } from "../ports";

/** A lock that hands over in order, like one Web Lock name. */
export function fakeLock() {
  let tail = Promise.resolve();
  let held = 0;
  const lock = vi.fn((signal?: AbortSignal) => {
    const previous = tail;
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    tail = previous.then(() => mine);
    return new Promise<() => void>((resolve, reject) => {
      const abort = () =>
        reject(new DOMException("The lock request was aborted", "AbortError"));
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      void previous.then(() => {
        if (signal?.aborted) return release();
        signal?.removeEventListener("abort", abort);
        held++;
        resolve(() => {
          held--;
          release();
        });
      });
    });
  });
  return {
    lock,
    get held() {
      return held;
    },
  };
}

function sdkStorage() {
  const { store, hydrate } = createSdkStore({ driver: createMemoryDriver() });
  return { store, hydrate, storage: createStorageAdapterFromStore(store) };
}

/** One account's credit, in memory, through the real SDK store. */
export function fakeKeys() {
  const stores = { direct: sdkStorage(), node: sdkStorage() };
  const locks = fakeLock();
  const keys = {
    ready: vi.fn(async () => {
      await Promise.all([stores.direct.hydrate, stores.node.hydrate]);
    }),
    storage: (source: PaySource = "direct") => stores[source].storage,
    lock: locks.lock,
    reload: vi.fn(async (_source?: PaySource) => {}),
    flush: vi.fn(async (source: PaySource = "direct") => {
      await stores[source].storage.flush?.();
    }),
  } satisfies Keys;
  return {
    keys,
    stores,
    get held() {
      return locks.held;
    },
  };
}

export const MINT = "https://mint.example";

export const tokenOf = (amount: number) =>
  getEncodedTokenV4({
    mint: MINT,
    unit: "sat",
    proofs: [
      {
        id: "009a1f293253e41e",
        amount,
        secret: `s${amount}`,
        C: "02" + "a".repeat(64),
      },
    ],
  });

/** A wallet for one account; it remembers what it sent and received. */
export function fakePurse(balance = 100) {
  const received: string[] = [];
  const sent: number[] = [];
  const purse = {
    balances: vi.fn(async () => ({ [MINT]: balance })),
    activeMint: () => MINT,
    send: vi.fn(
      async (
        _mint: string,
        sats: number,
        handoff?: (token: string) => Promise<void>
      ) => {
        const token = tokenOf(sats);
        await handoff?.(token);
        sent.push(sats);
        return token;
      }
    ),
    receive: vi.fn(async (token: string) => {
      received.push(token);
      return 1;
    }),
  } satisfies Purse;
  return { purse, received, sent };
}

/** The SDK with its request replaced by the test; refunds use the real client. */
export function fakeSdk(request: Sdk["request"] = vi.fn(async () => {})) {
  const discovery = createSdkStore({ driver: createMemoryDriver() }).store;
  const discoveryAdapter = createDiscoveryAdapterFromStore(discovery);
  const usageTrackingDriver = createMemoryUsageTrackingDriver();
  return {
    request,
    client: (wallet, storage) =>
      new RoutstrClient(wallet, storage, discoveryAdapter, "min", "apikeys", {
        logger: noopLogger,
        usageTrackingDriver,
      }),
    cost: vi.fn(async () => undefined),
    warm: vi.fn(() => undefined),
    ensureNode: vi.fn(async () => {}),
    torMode: () => false,
  } satisfies Sdk;
}

/** A device with nothing left from main and no other devices. */
export function emptyDevice() {
  const old = fakeKeys();
  return {
    oldCredit: {
      load: async () => {
        await old.keys.ready();
        return old.keys.storage();
      },
      lock: () => fakeLock().lock(),
    },
    otherDevices: { keys: () => [], drop: async () => {} },
  };
}
