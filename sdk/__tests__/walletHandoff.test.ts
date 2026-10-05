import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const mint = {
    url: "https://mint.example",
    mintInfo: {},
    keys: [{}],
    keysets: [{ id: "keyset", active: true, unit: "sat" }],
  };
  const proof = { id: "keyset", amount: 7, secret: "fixture", C: "fixture" };
  return {
    mint,
    proof,
    updateProofs: vi.fn(async () => {}),
    history: vi.fn(async () => {}),
  };
});

vi.mock("react", () => ({
  useState: (value: unknown) => [value, vi.fn()],
  useEffect: () => {},
}));
vi.mock("@/features/wallet/state/cashuStore", () => ({
  useCashuStore: () => ({
    mints: [fixture.mint],
    getMint: () => fixture.mint,
    getMintProofs: async () => [fixture.proof],
  }),
}));
vi.mock("@/features/wallet/state/unclaimedTokensStore", () => ({
  useUnclaimedTokensStore: { getState: () => ({ addUnclaimedToken: vi.fn() }) },
}));
vi.mock("@/features/wallet/hooks/useCashuWallet", () => ({
  useCashuWallet: () => ({
    wallet: { mints: [fixture.mint.url] },
    updateProofs: fixture.updateProofs,
    tokens: [],
  }),
}));
vi.mock("@/features/wallet/hooks/useCashuHistory", () => ({
  useCashuHistory: () => ({ createHistory: fixture.history }),
}));
vi.mock("@/features/wallet/core/services/MintService", () => ({
  MintService: class {},
}));
vi.mock("@cashu/cashu-ts", () => ({
  Mint: class {},
  Wallet: class {
    keysetId = "keyset";
    async loadMint() {}
    async send() {
      return { keep: [], send: [fixture.proof] };
    }
  },
  getEncodedTokenV4: () => "fixture-token",
  getTokenMetadata: vi.fn(),
  CheckStateEnum: {},
}));

import { useCashuToken } from "@/features/wallet/hooks/useCashuToken";

describe("wallet to SDK handoff", () => {
  let records: Record<string, string>;
  beforeEach(() => {
    records = {};
    vi.stubGlobal("localStorage", {
      setItem: (key: string, value: string) => {
        records[key] = value;
      },
      getItem: (key: string) => records[key] ?? null,
      removeItem: (key: string) => {
        delete records[key];
      },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the proof backup until the SDK acknowledges durable storage", async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const called = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { sendToken } = useCashuToken();
    const handoff = vi.fn(async (token: string) => {
      expect(token).toBe("fixture-token");
      entered();
      await gate;
    });
    const pending = sendToken(
      fixture.mint.url,
      7,
      undefined,
      undefined,
      false,
      handoff
    );
    await Promise.race([called, pending]);
    expect(handoff).toHaveBeenCalledOnce();
    expect(Object.keys(records)).toHaveLength(1);
    release();
    await expect(pending).resolves.toBe("fixture-token");
    expect(records).toEqual({});
  });

  it("preserves the backup when the SDK cannot save the token", async () => {
    const { sendToken } = useCashuToken();
    await expect(
      sendToken(fixture.mint.url, 7, undefined, undefined, false, async () => {
        throw new Error("disk full");
      })
    ).rejects.toThrow("disk full");
    const saved = Object.values(records);
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0]).proofsToSend).toEqual([fixture.proof]);
  });
});
