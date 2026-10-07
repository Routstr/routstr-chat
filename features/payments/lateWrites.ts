import type { StorageAdapter } from "@routstr/sdk/wallet";
import type { Keys, PaySource } from "./ports";

type HeldTokens = Parameters<StorageAdapter["setCachedReceiveTokens"]>[0];

// writes to the one key stored for a provider
const ONE_KEY = new Set([
  "replaceApiKey",
  "updateApiKeyBalance",
  "touchApiKeyLastUsed",
  "removeApiKey",
]);

/**
 * `storage` for an SDK client that can write after the payment lock is
 * released: a top-up it did not wait for, its balance update after Stop, or
 * its 2-minute retry of an X-Cashu refund. Such a change would come from this
 * tab's memory, which another tab may have moved past, so once `released()`
 * it is made again under the lock after a reload, in the order the SDK made
 * it. A change that fails stops the ones after it and fails `flush`, so none
 * lands while an earlier one was lost. Reads stay as they are.
 */
export function lockedAfter(
  storage: StorageAdapter,
  released: () => boolean,
  keys: Keys,
  source: PaySource
): StorageAdapter {
  let late = Promise.resolve();
  // the key each provider has once the late writes already queued are made
  const expected = new Map<string, string | undefined>();
  const replay = async (write: () => void) => {
    const unlock = await keys.lock();
    try {
      await keys.reload(source);
      write();
      await keys.flush(source);
    } finally {
      unlock();
    }
  };
  const wrapped: Record<string, unknown> = { ...storage };
  for (const [name, method] of Object.entries(storage)) {
    if (typeof method !== "function" || name.startsWith("get")) continue;
    wrapped[name] = (...args: unknown[]) => {
      if (!released()) return method.apply(storage, args);
      const write =
        name === "setCachedReceiveTokens"
          ? heldTokensChange(storage, args[0] as HeldTokens)
          : ONE_KEY.has(name)
            ? whileSameKey(
                storage,
                args[0] as string,
                () => method.apply(storage, args),
                expected
              )
            : () => method.apply(storage, args);
      if (name === "replaceApiKey")
        expected.set(args[0] as string, args[1] as string);
      if (name === "removeApiKey") expected.set(args[0] as string, undefined);
      late = late.then(() => replay(write));
      late.catch((error) =>
        console.warn("Could not record a late change to credit", error)
      );
    };
  }
  wrapped.flush = async () => {
    await late;
    await storage.flush?.();
  };
  return wrapped as unknown as StorageAdapter;
}

/** A change to a provider's key is made only while that key is still the one
 *  the SDK changed: another tab may have refunded it and stored a new one.
 *  The SDK's own late writes before it count: its key as they leave it. */
function whileSameKey(
  storage: StorageAdapter,
  baseUrl: string,
  write: () => void,
  expected: Map<string, string | undefined>
) {
  const key = expected.has(baseUrl)
    ? expected.get(baseUrl)
    : storage.getApiKey(baseUrl)?.key;
  return () => {
    if (storage.getApiKey(baseUrl)?.key === key) write();
  };
}

/** The one write that takes a whole list, built from this tab's memory: only
 *  the change it makes is applied, to the list as it is by then. */
function heldTokensChange(storage: StorageAdapter, next: HeldTokens) {
  const before = storage.getCachedReceiveTokens().map((held) => held.token);
  const removed = before.filter(
    (token) => !next.some((t) => t.token === token)
  );
  const added = next.filter((held) => !before.includes(held.token));
  return () => {
    const now = storage
      .getCachedReceiveTokens()
      .filter((held) => !removed.includes(held.token));
    const fresh = added.filter(
      (held) => !now.some((t) => t.token === held.token)
    );
    storage.setCachedReceiveTokens([...now, ...fresh]);
  };
}
