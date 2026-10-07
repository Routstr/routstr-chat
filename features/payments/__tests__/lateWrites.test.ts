import { describe, expect, it, vi } from "vitest";
import { createMemoryDriver } from "@routstr/sdk/storage";
import { CashuSpender } from "@routstr/sdk/wallet";
import { lockedAfter } from "../lateWrites";
import { sdkWallet } from "../request";
import { fakeLock, fakePurse, tabKeys, tokenOf } from "./fakes";

const PROVIDER = "https://one.example/";
const wallet = sdkWallet(fakePurse().purse, () => true, false);
const held = (keys: ReturnType<typeof tabKeys>) =>
  keys
    .storage()
    .getCachedReceiveTokens()
    .map((t) => t.token)
    .sort();

async function tab() {
  const disk = createMemoryDriver();
  const locks = fakeLock();
  const keys = tabKeys(disk, locks);
  await keys.ready();
  return { keys, reader: () => tabKeys(disk, locks) };
}

describe("lockedAfter", () => {
  it("holds a token the SDK parks late beside one this tab parked meanwhile", async () => {
    const { keys } = await tab();
    const late = lockedAfter(keys.storage(), () => true, keys, "direct");

    // a sweep in this tab holds the lock and parks a token
    const release = await keys.lock();
    await keys.reload();
    // an earlier sweep's retry parks its own, from the list it saw
    new CashuSpender(wallet, late).cacheReceiveToken(tokenOf(22));
    new CashuSpender(wallet, keys.storage()).cacheReceiveToken(tokenOf(11));
    await keys.flush();
    release();
    await late.flush?.();

    await keys.reload();
    expect(held(keys)).toEqual([tokenOf(11), tokenOf(22)].sort());
  });

  it("leaves a provider's newer key alone when the SDK changes the old one late", async () => {
    const { keys, reader } = await tab();
    keys.storage().setApiKey(PROVIDER, "cashuBootstrap");
    await keys.flush();
    const late = lockedAfter(keys.storage(), () => true, keys, "direct");

    // another tab refunds that key and makes a new one at the same provider
    const there = reader();
    await there.ready();
    const release = await there.lock();
    await there.reload();
    there.storage().removeApiKey(PROVIDER);
    there.storage().setApiKey(PROVIDER, "sk-newer");
    await there.flush();
    release();
    // the SDK's balance update after Stop names the old key's real id
    late.replaceApiKey!(PROVIDER, "sk-older");
    late.updateApiKeyBalance(PROVIDER, 0);
    await late.flush?.();

    await there.reload();
    expect(there.storage().getApiKey(PROVIDER)?.key).toBe("sk-newer");
  });

  it("makes a late change to a provider's key that is still the same", async () => {
    const { keys, reader } = await tab();
    keys.storage().setApiKey(PROVIDER, "cashuBootstrap");
    await keys.flush();
    const late = lockedAfter(keys.storage(), () => true, keys, "direct");

    late.replaceApiKey!(PROVIDER, "sk-real");
    await late.flush?.();

    const disk = reader();
    await disk.ready();
    expect(disk.storage().getApiKey(PROVIDER)?.key).toBe("sk-real");
  });

  it("lands the balance the SDK writes right after changing the key late", async () => {
    const { keys, reader } = await tab();
    keys.storage().setApiKey(PROVIDER, "cashuBootstrap");
    await keys.flush();
    const late = lockedAfter(keys.storage(), () => true, keys, "direct");

    // its update after Stop: the key's real id, then what it holds
    late.replaceApiKey!(PROVIDER, "sk-real");
    late.updateApiKeyBalance(PROVIDER, 6.9);
    late.touchApiKeyLastUsed(PROVIDER);
    await late.flush?.();

    const disk = reader();
    await disk.ready();
    expect(disk.storage().getApiKey(PROVIDER)).toMatchObject({
      key: "sk-real",
      balance: 6.9,
    });
  });

  it("makes no change after one that failed, and says so on flush", async () => {
    const { keys, reader } = await tab();
    const token = tokenOf(33);
    keys.storage().addXcashuToken(PROVIDER, token);
    await keys.flush();
    let failing = true;
    const flaky = {
      ...keys,
      reload: async () => {
        if (!failing) return keys.reload();
        failing = false;
        throw new Error("The disk could not be read");
      },
    };
    const late = lockedAfter(keys.storage(), () => true, flaky, "direct");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // the retry gives up on a token: it holds it, then drops its record
    new CashuSpender(wallet, late).cacheReceiveToken(token);
    late.removeXcashuToken(PROVIDER, token);

    await expect(late.flush!()).rejects.toThrow("could not be read");
    const disk = reader();
    await disk.ready();
    // still recorded, so the next sweep claims it
    expect(disk.storage().getXcashuTokensForBaseUrl(PROVIDER)).toHaveLength(1);
  });
});
