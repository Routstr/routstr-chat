import { afterEach, describe, expect, it, vi } from "vitest";
import { walletLock } from "../executor";
import { Journal, memoryStorage } from "../journal";
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
