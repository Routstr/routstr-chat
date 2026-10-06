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
