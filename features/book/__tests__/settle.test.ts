import { describe, expect, it, vi } from "vitest";
import {
  CheckStateEnum,
  MeltQuoteState,
  MintOperationError,
  MintQuoteState,
  OutputData,
  createBlindSignature,
  createNewMintKeys,
  pointFromHex,
  serializeMintKeys,
  type Wallet,
} from "@cashu/cashu-ts";
import { Journal, memoryStorage } from "../journal";
import {
  saveOutputs,
  type MeltRecord,
  type MintRecord,
  type SwapRecord,
} from "../records";
import { settleMelt, settleMint, settleSwap } from "../settle";

const melt: MeltRecord = {
  v: 1,
  kind: "melt",
  id: "m1",
  owner: "alice",
  mintUrl: "m",
  createdAt: 0,
  keysetId: "00ad268c4d1f5826",
  quoteId: "q1",
  inputs: [{ id: "00ad268c4d1f5826", amount: 8, secret: "s1", C: "02" }],
  blanks: [],
};

describe("settleMelt", () => {
  it("waits while the mint still holds the coins, even if the quote reads unpaid", async () => {
    const journal = new Journal(memoryStorage());
    journal.put(melt);
    const commit = vi.fn();
    const wallet = {
      checkProofsStates: async () => [{ state: CheckStateEnum.PENDING }],
      checkMeltQuote: async () => ({ state: MeltQuoteState.UNPAID }),
    } as unknown as Wallet;

    const { state } = await settleMelt(wallet, melt, commit, journal);

    expect(state).toBe("pending");
    expect(commit).not.toHaveBeenCalled();
    expect(journal.list("alice")).toHaveLength(1);
  });

  it("gives the coins back when another payment paid the quote and these never left", async () => {
    const journal = new Journal(memoryStorage());
    journal.put(melt);
    const commit = vi.fn();
    const wallet = {
      checkProofsStates: async () => [{ state: CheckStateEnum.UNSPENT }],
      checkMeltQuote: async () => ({ state: MeltQuoteState.PAID }),
    } as unknown as Wallet;

    const { state } = await settleMelt(wallet, melt, commit, journal);

    expect(state).toBe("paid");
    expect(commit).toHaveBeenCalledWith(melt.inputs, []);
    expect(journal.list("alice")).toEqual([]);
  });

  it("judges a paid quote by the coins read after it: its own melt landing in between is still its own", async () => {
    const journal = new Journal(memoryStorage());
    journal.put(melt);
    const commit = vi.fn();
    const reads = [CheckStateEnum.UNSPENT, CheckStateEnum.SPENT];
    const wallet = {
      checkProofsStates: async () => [{ state: reads.shift() }],
      checkMeltQuote: async () => ({ state: MeltQuoteState.PAID }),
      mint: { restore: async () => ({ outputs: [], signatures: [] }) },
    } as unknown as Wallet;

    const { state } = await settleMelt(wallet, melt, commit, journal);

    expect(state).toBe("paid");
    // its coins were spent by its own payment: nothing of them comes back
    expect(commit).toHaveBeenCalledWith([], []);
    expect(journal.list("alice")).toEqual([]);
  });
});

describe("settleSwap", () => {
  it("restores a lost answer's coins from a keyset the mint has since rotated out", async () => {
    // a keyset the wallet has no keys loaded for any more
    const mint = createNewMintKeys(4);
    const keyset = {
      id: mint.keysetId,
      unit: "sat",
      keys: serializeMintKeys(mint.pubKeys),
    };
    const [output] = OutputData.createRandomData(8, keyset as never);
    const signed = createBlindSignature(
      pointFromHex(output.blindedMessage.B_),
      mint.privKeys["8"],
      8,
      mint.keysetId
    );
    const record: SwapRecord = {
      v: 1,
      kind: "swap",
      id: "s1",
      owner: "alice",
      mintUrl: "m",
      createdAt: 0,
      keysetId: mint.keysetId,
      inputs: melt.inputs,
      outputs: saveOutputs([output]),
    };
    const journal = new Journal(memoryStorage());
    journal.put(record);
    const commit = vi.fn();
    let reads = 0;
    const wallet = {
      // the inputs went into the swap; the restored coin is new
      checkProofsStates: async () => [
        { state: reads++ ? CheckStateEnum.UNSPENT : CheckStateEnum.SPENT },
      ],
      mint: {
        restore: async () => ({
          outputs: [output.blindedMessage],
          signatures: [
            { id: mint.keysetId, amount: 8, C_: signed.C_.toHex(true) },
          ],
        }),
      },
      getKeyset: () => {
        throw new Error("Keyset not found");
      },
      keyChain: { ensureKeysetKeys: async () => keyset },
    } as unknown as Wallet;

    const restored = await settleSwap(wallet, record, commit, journal);
    expect(restored?.map((p) => p.amount)).toEqual([8]);
    expect(commit).toHaveBeenCalledWith(restored, []);
    expect(journal.list("alice")).toEqual([]);
  });
});

describe("settleMint", () => {
  const deposit: MintRecord = {
    v: 1,
    kind: "mint",
    id: "d1",
    owner: "alice",
    mintUrl: "m",
    createdAt: 0,
    keysetId: "00ad268c4d1f5826",
    quoteId: "q1",
    amount: 8,
    outputs: [],
  };

  it("puts a claim whose keyset the mint retired back as a paid quote: it signed nothing, so the next claim asks again", async () => {
    const journal = new Journal(memoryStorage());
    journal.put(deposit);
    const commit = vi.fn();
    const wallet = {
      checkMintQuoteBolt11: async () => ({ state: MintQuoteState.PAID }),
      completeMint: async () => {
        throw new MintOperationError(12002, "keyset inactive");
      },
    } as unknown as Wallet;

    expect(await settleMint(wallet, deposit, commit, journal)).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    expect(journal.list("alice")).toMatchObject([
      { kind: "quote", id: "d1", quoteId: "q1", amount: 8 },
    ]);
  });

  it("waits while the quote is unpaid, and keeps the claim for any other failure", async () => {
    const journal = new Journal(memoryStorage());
    journal.put(deposit);
    let state: string = MintQuoteState.UNPAID;
    const wallet = {
      checkMintQuoteBolt11: async () => ({ state }),
      completeMint: async () => {
        throw new Error("mint busy");
      },
    } as unknown as Wallet;

    expect(await settleMint(wallet, deposit, vi.fn(), journal)).toBeNull();
    state = MintQuoteState.PAID;
    await expect(settleMint(wallet, deposit, vi.fn(), journal)).rejects.toThrow(
      "mint busy"
    );
    expect(journal.list("alice")).toHaveLength(1);
  });

  it("keeps the claim while the mint is still signing, so its coins can be restored once issued", async () => {
    const journal = new Journal(memoryStorage());
    journal.put(deposit);
    const restore = vi.fn(async () => ({ outputs: [], signatures: [] }));
    const wallet = {
      checkMintQuoteBolt11: async () => ({ state: "PENDING" }),
      mint: { restore },
    } as unknown as Wallet;

    expect(await settleMint(wallet, deposit, vi.fn(), journal)).toBeNull();
    expect(journal.list("alice")).toHaveLength(1);
  });
});
