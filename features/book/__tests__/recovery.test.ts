import { afterEach, describe, expect, it, vi } from "vitest";
import { walletLock } from "../executor";
import type { Wallet } from "@cashu/cashu-ts";
import { Journal, memoryStorage, PREFIX } from "../journal";
import { RecoveryHost } from "../recovery";

const proof = { id: "00ad268c4d1f5826", amount: 8, secret: "s1", C: "02" };
const landed = (owner: string) => ({
  v: 1 as const,
  kind: "landed" as const,
  id: "l",
  owner,
  mintUrl: "m",
  unit: "sat",
  createdAt: 0,
  proofs: [proof],
});
const commit = vi.fn(async () => undefined);
// the mint is offline here, so a record recovery works on only shows up as a mint request
const openWallet = vi.fn(async () => {
  throw new TypeError("offline");
});

afterEach(() => vi.clearAllMocks());

describe("RecoveryHost", () => {
  it("works on this account's records only, and leaves tokens to the person", async () => {
    const journal = new Journal(memoryStorage());
    journal.put(landed("alice"));
    journal.put({
      v: 1,
      kind: "token",
      id: "t",
      owner: "alice",
      mintUrl: "t",
      createdAt: 0,
      token: "cashuB",
      amount: 8,
      unit: "sat",
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = new RecoveryHost({
      journal,
      openWallet,
      locks: navigator.locks,
    });

    await host.settle("bob", () => commit);
    expect(openWallet).not.toHaveBeenCalled();
    await host.settle("alice", () => commit);
    // in the record's own unit, whatever the mint prefers today
    expect(openWallet.mock.calls).toEqual([["m", "sat"]]);
    // the mint did not answer: both records wait
    expect(journal.list("alice")).toHaveLength(2);
  });

  it("settles the rest when one record cannot, and leaves a made token and an unreadable entry as they are", async () => {
    const storage = memoryStorage();
    const journal = new Journal(storage);
    const other = { ...proof, secret: "s2" };
    journal.put({ ...landed("alice"), id: "l1", mintUrl: "down" });
    journal.put({
      ...landed("alice"),
      id: "l2",
      mintUrl: "up",
      proofs: [other],
    });
    // a token the person made may already be someone else's: never returned by itself
    journal.put({
      v: 1,
      kind: "token",
      id: "t",
      owner: "alice",
      mintUrl: "up",
      createdAt: 0,
      token: "cashuB",
      amount: 8,
      unit: "sat",
    });
    storage.setItem(`${PREFIX}corrupt`, "{not json");
    const open = vi.fn(async (mintUrl: string) => {
      if (mintUrl === "down") throw new TypeError("offline");
      return {
        unit: "sat",
        checkProofsStates: async (ps: unknown[]) =>
          ps.map(() => ({ state: "UNSPENT" })),
      } as unknown as Wallet;
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await new RecoveryHost({
      journal,
      openWallet: open,
      locks: navigator.locks,
    }).settle("alice", () => commit);
    expect(open.mock.calls.map(([url]) => url)).toEqual(["down", "up"]);
    // the first could not be settled; the second landed all the same
    expect(commit).toHaveBeenCalledWith([other], []);
    expect(
      journal
        .list("alice")
        .map((r) => r.id)
        .sort()
    ).toEqual(["l1", "t"]);
    // an unreadable entry is left for a person to look at
    expect(storage.getItem(`${PREFIX}corrupt`)).toBe("{not json");
  });

  it("waits while an operation of the account holds its wallet lock, in any tab", async () => {
    const journal = new Journal(memoryStorage());
    journal.put(landed("alice"));
    let finish = () => {};
    const running = navigator.locks.request(
      walletLock("alice"),
      () => new Promise<void>((r) => (finish = r))
    );
    await new Promise((r) => setTimeout(r, 0));

    await new RecoveryHost({
      journal,
      openWallet,
      locks: navigator.locks,
    }).settle("alice", () => commit);
    expect(openWallet).not.toHaveBeenCalled();
    finish();
    await running;
  });

  it("settles nothing without Web Locks", async () => {
    const journal = new Journal(memoryStorage());
    journal.put(landed("alice"));
    await new RecoveryHost({ journal, openWallet }).settle(
      "alice",
      () => commit
    );
    expect(openWallet).not.toHaveBeenCalled();
  });
});
