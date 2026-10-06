import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cashu = vi.hoisted(() => {
  const state = {} as any;

  class MintOperationError extends Error {
    constructor(
      public code: number,
      message: string
    ) {
      super(message);
    }
  }

  class OutputData {
    constructor(
      public blindedMessage: any,
      public blindingFactor: bigint,
      public secret: Uint8Array
    ) {}

    toProof(signature: any) {
      return {
        amount: this.blindedMessage.amount,
        id: this.blindedMessage.id,
        secret: `restored-${[...this.secret].join("-")}`,
        C: signature.C_,
      };
    }
  }

  class Mint {
    async checkMintQuoteBolt11() {
      state.quoteChecks += 1;
      if (state.quoteGate) await state.quoteGate;
      return state.quote;
    }
  }

  class Wallet {
    keysetId: string;
    keyChain = {
      ensureKeysetKeys: async (keysetId: string) => {
        this.keysetId = keysetId;
      },
      getKeysets: () => [
        {
          toMintKeyset: () => ({
            id: this.keysetId,
            unit: "sat",
            active: true,
            input_fee_ppk: 0,
          }),
        },
      ],
    };
    mint: { restore: (request: any) => Promise<any> };
    private spec: any;

    constructor() {
      state.walletCount += 1;
      this.spec = state.wallets.shift() ?? {};
      this.keysetId = this.spec.keysetId ?? "keyset-a";
      this.mint = {
        restore: async (request) => {
          state.restores.push(request);
          return this.spec.restore(request);
        },
      };
    }

    async loadMint() {}

    async prepareMint(method: string, amount: number, quote: string) {
      state.prepareCount += 1;
      const blindedMessage = {
        amount,
        B_: `B-${this.keysetId}`,
        id: this.keysetId,
      };
      return {
        method,
        payload: { quote, outputs: [blindedMessage] },
        outputData: [
          new OutputData(blindedMessage, 11n, Uint8Array.from([1, 2, 3])),
        ],
        keysetId: this.keysetId,
        quote,
      };
    }

    async completeMint(preview: any) {
      state.order.push("post");
      state.completes.push(preview);
      if (this.spec.complete) return this.spec.complete(preview);
      return [proof(this.keysetId)];
    }

    getKeyset(keysetId: string) {
      return { id: keysetId };
    }
  }

  function proof(keysetId: string) {
    return {
      amount: state.quote.amount,
      id: keysetId,
      secret: `proof-${keysetId}`,
      C: `signature-${keysetId}`,
    };
  }

  return {
    Mint,
    MintOperationError,
    MintQuoteState: { UNPAID: "UNPAID", PAID: "PAID", ISSUED: "ISSUED" },
    OutputData,
    Wallet,
    state,
  };
});

vi.mock("@cashu/cashu-ts", () => ({
  Mint: cashu.Mint,
  MintOperationError: cashu.MintOperationError,
  MintQuoteState: cashu.MintQuoteState,
  OutputData: cashu.OutputData,
  Wallet: cashu.Wallet,
}));

vi.mock("@/features/wallet/state/cashuStore", () => ({
  useCashuStore: {
    of: () => ({
      getState: () => cashu.state.store,
      persist: { rehydrate: () => cashu.state.rehydrate() },
    }),
  },
}));

import { claimPaidMintQuote, finalizeMintClaim } from "@/lib/mintQuoteRecovery";

const MINT_URL = "https://mint.test";
const STORAGE_PREFIX = "cashu_mint_preview_v1";
let values: Map<string, string>;

function previewKey(quote: string, mintUrl = MINT_URL) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(mintUrl)}:${encodeURIComponent(quote)}`;
}

function preview(quote: string) {
  const stored = values.get(previewKey(quote));
  return stored ? JSON.parse(stored) : null;
}

function seedPreview(quote: string) {
  const blindedMessage = {
    amount: 64,
    B_: "stored-B",
    id: "stored-keyset",
  };
  values.set(
    previewKey(quote),
    JSON.stringify({
      mintUrl: MINT_URL,
      amount: 64,
      createdAt: 1,
      method: "bolt11",
      payload: { quote, outputs: [blindedMessage] },
      outputData: [
        {
          blindedMessage,
          blindingFactor: "17",
          secret: [7, 8, 9],
        },
      ],
      keysetId: "stored-keyset",
      quote,
    })
  );
  return blindedMessage;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("window", {
    crypto: {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(1),
    },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        cashu.state.order.push("preview");
        values.set(key, value);
      },
      removeItem: (key: string) => values.delete(key),
    },
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: (name: string, operation: () => Promise<any>) => {
        cashu.state.lockNames.push(name);
        cashu.state.order.push(`lock:${name}`);
        const result = cashu.state.lockTail.then(operation);
        cashu.state.lockTail = result.then(
          () => undefined,
          () => undefined
        );
        return result;
      },
    },
  });

  Object.assign(cashu.state, {
    quote: { amount: 64, state: cashu.MintQuoteState.PAID, unit: "sat" },
    quoteGate: undefined,
    quoteChecks: 0,
    walletCount: 0,
    wallets: [],
    prepareCount: 0,
    completes: [],
    restores: [],
    order: [],
    lockNames: [],
    lockTail: Promise.resolve(),
    rehydrate: vi.fn(async () => cashu.state.order.push("rehydrate")),
  });
  const store = {
    mints: [] as any[],
    proofs: [] as any[],
    getMint: vi.fn((mintUrl: string) =>
      store.mints.find((mint) => mint.url === mintUrl)
    ),
    addMint: vi.fn((mintUrl: string) => {
      cashu.state.order.push("mint");
      if (!store.mints.some((mint) => mint.url === mintUrl)) {
        store.mints.push({ url: mintUrl });
      }
    }),
    setKeysets: vi.fn((mintUrl: string, keysets: any[]) => {
      cashu.state.order.push("keysets");
      store.mints = store.mints.map((mint) =>
        mint.url === mintUrl ? { ...mint, keysets } : mint
      );
    }),
    addProofs: vi.fn((proofs: any[]) => {
      cashu.state.order.push("proofs");
      store.proofs.push(...proofs);
    }),
    updateMintQuote: vi.fn(() => cashu.state.order.push("issued")),
  };
  cashu.state.store = store;
});

afterEach(() => vi.unstubAllGlobals());

describe("paid mint quote recovery", () => {
  it("persists the exact preview before posting the mint request", async () => {
    cashu.state.wallets = [{ keysetId: "keyset-a" }];

    await claimPaidMintQuote(MINT_URL, "test-quote", 64, 1);

    expect(preview("test-quote")).toEqual(
      expect.objectContaining({
        amount: 64,
        keysetId: "keyset-a",
        quote: "test-quote",
        outputData: [
          expect.objectContaining({
            blindingFactor: "11",
            secret: [1, 2, 3],
          }),
        ],
      })
    );
    expect(cashu.state.order).toEqual([
      "lock:cashu-mint-settlement",
      "rehydrate",
      "preview",
      "post",
      "mint",
      "keysets",
      "proofs",
      "issued",
    ]);
    expect(cashu.state.store.setKeysets).toHaveBeenCalledWith(MINT_URL, [
      expect.objectContaining({ id: "keyset-a", active: true }),
    ]);
    finalizeMintClaim(MINT_URL, "test-quote");
  });

  it("refreshes once with fresh outputs after a 12002 rejection", async () => {
    cashu.state.wallets = [
      {
        keysetId: "old-keyset",
        complete: async () => {
          throw new cashu.MintOperationError(12002, "Inactive keyset");
        },
      },
      { keysetId: "new-keyset" },
    ];

    const proofs = await claimPaidMintQuote(MINT_URL, "rotated-quote", 64, 1);

    expect(cashu.state.walletCount).toBe(2);
    expect(cashu.state.prepareCount).toBe(2);
    expect(
      cashu.state.completes.map((preview: any) => preview.keysetId)
    ).toEqual(["old-keyset", "new-keyset"]);
    expect(proofs[0]).toMatchObject({ id: "new-keyset" });
    finalizeMintClaim(MINT_URL, "rotated-quote");
  });

  it("keeps the preview and does not fresh-retry an ambiguous error", async () => {
    cashu.state.wallets = [
      {
        complete: async () => {
          throw new Error("Failed to fetch");
        },
      },
    ];

    await expect(
      claimPaidMintQuote(MINT_URL, "ambiguous-quote", 64, 1)
    ).rejects.toThrow("Failed to fetch");

    expect(cashu.state.walletCount).toBe(1);
    expect(cashu.state.prepareCount).toBe(1);
    expect(cashu.state.completes).toHaveLength(1);
    expect(preview("ambiguous-quote")).toEqual(
      expect.objectContaining({ quote: "ambiguous-quote" })
    );
    expect(cashu.state.store.addProofs).not.toHaveBeenCalled();
  });

  it("restores an issued quote from the exact stored output data", async () => {
    const blindedMessage = seedPreview("issued-quote");
    cashu.state.quote.state = cashu.MintQuoteState.ISSUED;
    cashu.state.wallets = [
      {
        complete: async () => {
          throw new Error("Quote already issued");
        },
        restore: async ({ outputs }: any) => ({
          outputs,
          signatures: [{ C_: "restored-signature" }],
        }),
      },
    ];

    const proofs = await claimPaidMintQuote(MINT_URL, "issued-quote", 64, 1);

    expect(cashu.state.prepareCount).toBe(0);
    const preview = cashu.state.completes[0];
    expect(preview.outputData[0].blindedMessage).toEqual(blindedMessage);
    expect(preview.outputData[0].blindingFactor).toBe(17n);
    expect([...preview.outputData[0].secret]).toEqual([7, 8, 9]);
    expect(cashu.state.restores).toEqual([{ outputs: [blindedMessage] }]);
    expect(proofs[0]).toMatchObject({
      C: "restored-signature",
      secret: "restored-7-8-9",
    });
    finalizeMintClaim(MINT_URL, "issued-quote");
  });

  it("coalesces concurrent claims for the same normalized quote", async () => {
    const gate = deferred();
    cashu.state.quoteGate = gate.promise;
    cashu.state.wallets = [{ keysetId: "keyset-a" }];

    const first = claimPaidMintQuote(`${MINT_URL}/`, "same-quote", 64, 1);
    const second = claimPaidMintQuote(MINT_URL, "same-quote", 64, 1);

    expect(second).toBe(first);
    gate.resolve();
    const [firstProofs, secondProofs] = await Promise.all([first, second]);
    expect(secondProofs).toBe(firstProofs);
    expect(cashu.state.walletCount).toBe(1);
    expect(cashu.state.prepareCount).toBe(1);
    expect(cashu.state.completes).toHaveLength(1);
    finalizeMintClaim(MINT_URL, "same-quote");
  });

  it("keeps different quote previews in independent storage records", async () => {
    cashu.state.store.mints = [
      {
        url: `${MINT_URL}/`,
        keysets: [
          {
            _id: "existing-msat-keyset",
            _unit: "msat",
            _active: true,
            _input_fee_ppk: 0,
          },
        ],
      },
    ];
    cashu.state.wallets = [{ keysetId: "keyset-a" }, { keysetId: "keyset-b" }];

    await Promise.all([
      claimPaidMintQuote(MINT_URL, "quote-a", 64, 1),
      claimPaidMintQuote(MINT_URL, "quote-b", 64, 1),
    ]);

    expect(preview("quote-a")).toMatchObject({
      keysetId: "keyset-a",
      quote: "quote-a",
    });
    expect(preview("quote-b")).toMatchObject({
      keysetId: "keyset-b",
      quote: "quote-b",
    });
    expect(
      [...values.keys()].filter((key) => key.startsWith(STORAGE_PREFIX))
    ).toHaveLength(2);
    expect(cashu.state.lockNames).toEqual([
      "cashu-mint-settlement",
      "cashu-mint-settlement",
    ]);
    expect(
      cashu.state.store.getMint(`${MINT_URL}/`).keysets.map(({ id }: any) => id)
    ).toEqual(["existing-msat-keyset", "keyset-a", "keyset-b"]);
    expect(cashu.state.store.mints).toHaveLength(1);
    finalizeMintClaim(MINT_URL, "quote-a");
    finalizeMintClaim(MINT_URL, "quote-b");
  });

  it("does not return or mark issued unless proofs are persisted", async () => {
    cashu.state.wallets = [{}];
    cashu.state.store.addProofs = vi.fn();

    await expect(
      claimPaidMintQuote(MINT_URL, "persistence-quote", 64, 1)
    ).rejects.toThrow("Minted proofs could not be saved locally");

    expect(cashu.state.store.updateMintQuote).not.toHaveBeenCalled();
  });

  it("does not persist proofs when mint keysets cannot be saved", async () => {
    cashu.state.wallets = [{}];
    cashu.state.store.setKeysets = vi.fn();

    await expect(
      claimPaidMintQuote(MINT_URL, "keyset-persistence-quote", 64, 1)
    ).rejects.toThrow("Mint keysets could not be saved locally");

    expect(cashu.state.store.addProofs).not.toHaveBeenCalled();
    expect(cashu.state.store.updateMintQuote).not.toHaveBeenCalled();
  });
});
