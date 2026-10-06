// Exported API keys against real routstr-core and a real mint: a key made from
// the wallet holds what was sent, a top-up adds to it, and removing it brings
// back exactly that, as the mint itself counts it.
import { describe, expect, it } from "vitest";
import {
  BalanceManager,
  type StorageAdapter,
  type WalletAdapter,
} from "@routstr/sdk/wallet";
import { getKit } from "@/tests/kit";
import { ExportedKeys, type Purse } from "../exported";
import type { Saved } from "@/features/session/saved";

const kit = getKit();

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

// the IndexedDB copy of the list, empty to start with
const kept = (): Saved => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k),
    put: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
};

// a wallet that pays with fresh kit coins and keeps what comes back
const purse = () => {
  const received: string[] = [];
  const p: Purse = {
    activeMint: () => kit.env.mintUrl,
    async send(_mint, sats, handoff) {
      const token = await kit.mintToken(sats);
      await handoff(token);
      return token;
    },
    async receive(token) {
      received.push(token);
    },
  };
  return { p, received };
};

const service = () =>
  new ExportedKeys(
    "alice",
    memory(),
    new BalanceManager({} as WalletAdapter, {} as StorageAdapter),
    kept()
  );

describe("ExportedKeys at a real provider", () => {
  it("makes a key, tops it up, and removing it brings every sat back", async () => {
    const keys = service();
    const { p, received } = purse();

    const made = await keys.create(p, kit.coreUrl, 50, "laptop");
    expect(made.balance).toBe(50_000);

    await keys.topUp(p, made, 20);
    expect(keys.list()[0].balance).toBe(70_000);

    await keys.remove(p, keys.list()[0]);
    expect(keys.list()).toEqual([]);
    expect(received).toHaveLength(1);
    expect(await kit.redeem(received[0])).toBe(70);
  });

  it("pays a payout that never landed again, never one that did, and forgets a key the provider does not know", async () => {
    const keys = service();
    const { p } = purse();
    const made = await keys.create(p, kit.coreUrl, 30, "phone");

    // the mint is down when the payout comes: the key stays
    const down: Purse = {
      ...p,
      receive: async () => {
        throw new Error("mint down");
      },
    };
    await expect(keys.remove(down, made)).rejects.toThrow("mint down");
    expect(keys.list()).toHaveLength(1);

    // the next try gets the same payout from the provider, and it lands
    const landed: number[] = [];
    const wallet: Purse = {
      ...p,
      receive: async (token) => landed.push(await kit.redeem(token)),
    };
    await keys.remove(wallet, made);
    expect(landed).toEqual([30]);
    expect(keys.list()).toEqual([]);

    // another device still lists it: that payout is spent, so the key stays
    const storage = memory();
    storage.setItem("api_keys:alice", JSON.stringify([made]));
    const again = new ExportedKeys(
      "alice",
      storage,
      new BalanceManager({} as WalletAdapter, {} as StorageAdapter),
      kept()
    );
    await expect(again.remove(wallet, made)).rejects.toThrow();
    expect(landed).toEqual([30]);

    // a well-formed key this provider never issued
    const other = made.key.endsWith("0") ? "1" : "0";
    const unknown = { ...made, key: made.key.slice(0, -1) + other };
    storage.setItem("api_keys:alice", JSON.stringify([unknown]));
    await again.remove(wallet, unknown);
    expect(again.list().map((k) => k.key)).not.toContain(unknown.key);
  });

  it("adopts the key a spent token made, and says 0 for one the provider never saw", async () => {
    const keys = service();
    let handed = "";
    const { p } = purse();
    const send = p.send;
    p.send = (mint, sats, handoff) =>
      send(mint, sats, async (token) => {
        handed = token;
        await handoff(token);
      });
    const made = await keys.create(p, kit.coreUrl, 30, "laptop");

    // another device, which only has the token the provider redeemed
    const other = service();
    expect(await other.adopt(handed, kit.coreUrl)).toBe(30);
    expect(other.list().map((k) => k.key)).toEqual([made.key]);

    // a token spent at the mint that never reached the provider
    const spent = await kit.mintToken(5);
    expect(await kit.redeem(spent)).toBe(5);
    expect(await other.adopt(spent, kit.coreUrl)).toBe(0);
  });
});
