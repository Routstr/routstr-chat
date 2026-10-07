import { describe, expect, it, vi } from "vitest";
import { noopLogger } from "@routstr/sdk";
import { RoutstrClient } from "@routstr/sdk/client";
import {
  createMemoryDriver,
  createSdkStore,
  createStorageAdapterFromStore,
} from "@routstr/sdk/storage";
import type { DiscoveryAdapter } from "@routstr/sdk/discovery";
import type { WalletAdapter } from "@routstr/sdk/wallet";
import { topUpFor } from "../topUp";

const P = "https://p.example/";
const MINT = "https://mint.example";

/** What the SDK itself takes from the wallet for one request: its own
 *  _spendToken and _topUpIfNeeded, with the wallet and the provider faked. */
async function sdkTakes(need: number, credit: number | null) {
  const { store } = createSdkStore({ driver: createMemoryDriver() });
  const storage = createStorageAdapterFromStore(store);
  if (credit !== null) {
    storage.setApiKey(P, "sk-mine");
    storage.updateApiKeyBalance(P, credit);
  }
  const client = new RoutstrClient(
    {
      getBalances: async () => ({ [MINT]: 1_000_000 }),
      getActiveMintUrl: () => MINT,
      getMintUnits: () => ({}),
    } as unknown as WalletAdapter,
    storage,
    {} as DiscoveryAdapter,
    "min",
    "apikeys",
    { logger: noopLogger }
  ) as unknown as {
    cashuSpender: { spend: (o: { amount: number }) => Promise<unknown> };
    balanceManager: {
      topUp: (o: { amount: number }) => Promise<unknown>;
      getTokenBalance: () => Promise<unknown>;
    };
    _spendToken(o: object): Promise<Record<string, unknown>>;
    _topUpIfNeeded(o: object): Promise<void>;
  };
  const spent: number[] = [];
  const toppedUp: number[] = [];
  let blocked = false;
  client.cashuSpender.spend = vi.fn(async ({ amount }) => {
    spent.push(amount);
    return { token: "cashuBfirst", balance: amount, status: "success" };
  });
  client.balanceManager.getTokenBalance = vi.fn(async () => ({
    amount: (spent[0] ?? credit ?? 0) * 1000,
    reserved: 0,
    unit: "msat",
  }));
  // a refill that never answers: it holds the request only if it is awaited
  client.balanceManager.topUp = vi.fn(({ amount }) => {
    toppedUp.push(amount);
    return new Promise(() => {});
  });
  const spend = await client._spendToken({
    mintUrl: MINT,
    amount: need,
    baseUrl: P,
  });
  const going = client
    ._topUpIfNeeded({ ...spend, baseUrl: P, mintUrl: MINT, requiredSats: need })
    .then(() => (blocked = false));
  blocked = true;
  await new Promise((resolve) => setTimeout(resolve, 20));
  void going;
  const refill = toppedUp.reduce((sum, a) => sum + Math.ceil(a), 0);
  return {
    first: spent.reduce((sum, a) => sum + a, 0),
    refill,
    blocking: blocked && toppedUp.length > 0,
  };
}

describe("topUpFor: what the SDK takes from the wallet for one message", () => {
  it.each([
    [10, null],
    [3, null],
    [50, null],
    [10, 0],
    [10, 5],
    [10, 9.99],
    [10, 10],
    [10, 12],
    [10, 13.99],
    [10, 14],
    [10, 40],
    [0.7, 0.1],
  ])("need %s with %s at the provider", async (need, credit) => {
    const sdk = await sdkTakes(need, credit);
    const ours = topUpFor(need, credit);

    expect(ours.now).toBe(sdk.first + (sdk.blocking ? sdk.refill : 0));
    expect(ours.later).toBe(sdk.blocking ? 0 : sdk.refill);
  });

  it("with X-Cashu each message carries a token of what it may cost", () => {
    expect(topUpFor(9.2, 40, "xcashu")).toEqual({ now: 10, later: 0 });
  });
});
