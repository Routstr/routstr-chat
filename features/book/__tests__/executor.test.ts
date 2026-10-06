import { describe, expect, it, vi } from "vitest";
import type { MeltQuoteBolt11Response, Proof, Wallet } from "@cashu/cashu-ts";
import { walletLock, WalletExecutor } from "../executor";
import { Journal, memoryStorage } from "../journal";

const proofs = [{ id: "00ad268c4d1f5826", amount: 64, secret: "s1", C: "02" }];

/** a mint that answers info only: whatever else the executor asks of it fails the test */
function mintWith(supported: { 7: boolean; 9: boolean }) {
  return vi.fn(
    async () =>
      ({
        unit: "sat",
        getMintInfo: () => ({
          isSupported: (n: 7 | 9) => ({ supported: supported[n] }),
        }),
      }) as unknown as Wallet
  );
}

describe("WalletExecutor", () => {
  it("refuses to move money when tabs cannot be kept apart (no Web Locks)", async () => {
    const openWallet = mintWith({ 7: true, 9: true });
    const executor = new WalletExecutor({
      owner: "alice",
      journal: new Journal(memoryStorage()),
      commitFor: () => vi.fn(),
      openWallet,
    });
    await expect(executor.send("m", 8, proofs)).rejects.toThrow(
      "cannot safely coordinate"
    );
    expect(openWallet).not.toHaveBeenCalled();
  });

  it.each([[{ 7: false, 9: true }], [{ 7: true, 9: false }]])(
    "refuses a mint that cannot report a lost answer (%o)",
    async (supported) => {
      const journal = new Journal(memoryStorage());
      const commit = vi.fn();
      const executor = new WalletExecutor({
        owner: "alice",
        journal,
        commitFor: () => commit,
        openWallet: mintWith(supported),
        locks: navigator.locks,
      });
      await expect(executor.send("m", 8, proofs)).rejects.toThrow(
        "NUT-07 and NUT-09"
      );
      expect(commit).not.toHaveBeenCalled();
      expect(journal.list("alice")).toEqual([]);
    }
  );

  it("holds the account's wallet lock for the whole operation", async () => {
    let stop = () => {};
    const openWallet = vi.fn(
      () =>
        new Promise<Wallet>(
          (_, reject) => (stop = () => reject(new Error("stop")))
        )
    );
    const executor = new WalletExecutor({
      owner: "alice",
      journal: new Journal(memoryStorage()),
      commitFor: () => vi.fn(),
      openWallet,
      locks: navigator.locks,
    });

    const sending = executor.send("m", 8, proofs);
    await vi.waitFor(() => expect(openWallet).toHaveBeenCalled());
    const { held = [] } = await navigator.locks.query();
    expect(held.map((lock) => lock.name)).toContain(walletLock("alice"));
    stop();
    await expect(sending).rejects.toThrow("stop");
  });

  it("gives a failed request time to land before asking the mint what became of it", async () => {
    const journal = new Journal(memoryStorage());
    let failedAt = 0;
    let askedAt = 0;
    const wallet = {
      unit: "sat",
      keysetId: "00ad268c4d1f5826",
      getMintInfo: () => ({ isSupported: () => ({ supported: true }) }),
      prepareSwapToSend: async () => ({
        keysetId: "00ad268c4d1f5826",
        inputs: proofs,
        sendOutputs: [],
        keepOutputs: [],
      }),
      completeSwap: async () => {
        failedAt = Date.now();
        throw new TypeError("network error");
      },
      checkProofsStates: async () => {
        askedAt = Date.now();
        return [{ state: "UNSPENT" }];
      },
      mint: { restore: async () => ({ outputs: [], signatures: [] }) },
    } as unknown as Wallet;
    const executor = new WalletExecutor({
      owner: "alice",
      journal,
      commitFor: () => vi.fn(),
      openWallet: async () => wallet,
      locks: navigator.locks,
    });

    await expect(executor.send("m", 8, proofs)).rejects.toThrow(
      "network error"
    );
    expect(askedAt - failedAt).toBeGreaterThanOrEqual(1900);
  });

  it("has the operation written down at the moment of every mint call", async () => {
    const journal = new Journal(memoryStorage());
    const seen: string[] = [];
    const written = () =>
      journal
        .list("alice")
        .map((r) => r.kind)
        .join("+");
    const wallet = {
      unit: "sat",
      keysetId: "00ad268c4d1f5826",
      getMintInfo: () => ({ isSupported: () => ({ supported: true }) }),
      sendOffline: () => {
        throw new Error("no exact coins");
      },
      prepareSwapToSend: async () => ({
        keysetId: "00ad268c4d1f5826",
        inputs: proofs,
        sendOutputs: [],
        keepOutputs: [],
      }),
      completeSwap: async () => {
        seen.push(`swap:${written()}`);
        return { keep: [], send: [{ ...proofs[0], secret: "s2", amount: 16 }] };
      },
      prepareMelt: async () => ({
        keysetId: "00ad268c4d1f5826",
        outputData: [],
      }),
      completeMelt: async () => {
        seen.push(`melt:${written()}`);
        return { quote: { state: "PAID" }, change: [] };
      },
    } as unknown as Wallet;
    const commit = vi.fn(async (add: Proof[], remove: Proof[]) => [
      add,
      remove,
    ]);
    const executor = new WalletExecutor({
      owner: "alice",
      journal,
      commitFor: () => commit,
      openWallet: async () => wallet,
      locks: navigator.locks,
    });
    const quote = {
      quote: "q1",
      amount: 15,
      fee_reserve: 1,
    } as MeltQuoteBolt11Response;

    expect((await executor.pay("m", quote, proofs)).state).toBe("paid");
    expect(seen).toEqual(["swap:swap", "melt:melt"]);
    // the swap's coins for the melt went straight into it, never into the wallet
    const added = commit.mock.calls.flatMap(([add]) =>
      add.map((p) => p.secret)
    );
    expect(added).not.toContain("s2");
    expect(journal.list("alice")).toEqual([]);
  });

  it("reports a paid payment as paid even when storage is too full to write its change down", async () => {
    const storage = memoryStorage();
    const setItem = storage.setItem;
    storage.setItem = (key, value) => {
      if (String(value).includes('"landed"'))
        throw new Error("QuotaExceededError");
      setItem(key, value);
    };
    const journal = new Journal(storage);
    const wallet = {
      unit: "sat",
      keysetId: "00ad268c4d1f5826",
      getMintInfo: () => ({ isSupported: () => ({ supported: true }) }),
      sendOffline: () => ({ send: proofs }),
      getFeesForProofs: () => 0,
      prepareMelt: async () => ({
        keysetId: "00ad268c4d1f5826",
        outputData: [],
      }),
      completeMelt: async () => ({ quote: { state: "PAID" }, change: [] }),
    } as unknown as Wallet;
    const executor = new WalletExecutor({
      owner: "alice",
      journal,
      commitFor: () => vi.fn(async () => undefined),
      openWallet: async () => wallet,
      locks: navigator.locks,
    });
    const quote = {
      quote: "q1",
      amount: 63,
      fee_reserve: 1,
    } as MeltQuoteBolt11Response;

    expect((await executor.pay("m", quote, proofs)).state).toBe("paid");
  });
});
