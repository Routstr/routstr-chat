import { deriveKeysetId, getEncodedTokenV4 } from "@cashu/cashu-ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mint: {} as any,
  updateProofs: vi.fn(),
}));

vi.mock("react", () => ({
  useState: () => [null, vi.fn()],
  useEffect: (effect: () => void) => effect(),
  useCallback: (fn: unknown) => fn,
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("@/features/session/owned", () => ({ currentOwner: () => "alice" }));
vi.mock("@/features/wallet/state/cashuStore", () => ({
  useCashuStore: Object.assign(
    () => ({ mints: [state.mint], getMint: () => state.mint }),
    {
      of: () => ({ persist: { getOptions: () => ({ name: "cashu" }) } }),
    }
  ),
}));
vi.mock("@/features/wallet/hooks/useCashuWallet", () => ({
  useCashuWallet: () => ({
    owner: "alice",
    wallet: { mints: [state.mint.url] },
    updateProofs: state.updateProofs,
  }),
}));
vi.mock("@/features/wallet/hooks/useCashuHistory", () => ({
  useCashuHistory: () => ({ createHistory: vi.fn() }),
}));

import { useCashuToken } from "@/features/wallet/hooks/useCashuToken";
import { journal } from "@/runtime/book";

const mintUrl = "https://mint.example.com";
const publicKey =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const keys = { 1: publicKey, 2: publicKey, 4: publicKey };

// nothing saved yet: every received coin is new
beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  journal.list("alice").forEach((record) => journal.remove(record.id));
});

describe("useCashuToken receive", () => {
  it("rejects malformed tokens before contacting a mint", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(useCashuToken().receiveToken("invalid")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(state.updateProofs).not.toHaveBeenCalled();
  });

  it("preserves the mint URL on a short-keyset network error", async () => {
    const id = deriveKeysetId(keys, { unit: "sat", versionByte: 1 });
    state.mint = {
      url: mintUrl,
      mintInfo: {},
      keysets: [{ id, _active: true, _unit: "sat" }],
      keys: [{ [id]: keys }],
    };
    const error = new Error("NetworkError when attempting to fetch resource.");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    const token = getEncodedTokenV4({
      mint: mintUrl,
      unit: "sat",
      proofs: [{ id, amount: 4, secret: "synthetic-input", C: publicKey }],
    });

    await expect(useCashuToken().receiveToken(token)).rejects.toMatchObject({
      message: error.message,
      mintUrl,
    });
    expect(state.updateProofs).not.toHaveBeenCalled();
  });

  it.each([
    [0, "sat"],
    [1, "sat"],
    [1, "msat"],
  ])(
    "receives keyset version %i in %s through cashu-ts",
    async (versionByte, unit) => {
      const id = deriveKeysetId(keys, { versionByte, unit });
      const keyset = { id, unit, active: true, input_fee_ppk: 0 };
      state.mint = {
        url: mintUrl,
        mintInfo: {},
        keysets: [{ ...keyset, _active: true, _unit: unit }],
        keys: [{ [id]: keys }],
      };
      const swaps: any[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, options?: RequestInit) => {
          if (url.endsWith("/v1/info"))
            return Response.json({
              nuts: { 7: { supported: true }, 9: { supported: true } },
            });
          if (url.endsWith("/v1/keysets"))
            return Response.json({ keysets: [keyset] });
          if (url.includes("/v1/keys")) {
            return Response.json({ keysets: [{ ...keyset, keys }] });
          }
          if (url.endsWith("/v1/swap")) {
            const body = JSON.parse(options!.body as string);
            swaps.push(body);
            return Response.json({
              // The fixture's private key is 1, so signing leaves B_ unchanged.
              signatures: body.outputs.map((output: any) => ({
                id,
                amount: output.amount,
                C_: output.B_,
              })),
            });
          }
          throw new Error(`Unexpected request: ${url}`);
        })
      );
      state.updateProofs.mockImplementation(
        async ({ proofsToAdd, proofsToRemove }) => {
          // until the wallet has stored them, the new proofs are held in the book
          const [held] = journal.list("alice");
          expect(held.kind).toBe("landed");
          expect(
            held.kind === "landed" && held.proofs.map((p) => p.secret)
          ).toEqual(proofsToAdd.map((p: { secret: string }) => p.secret));
          expect(proofsToRemove).toEqual([]);
        }
      );
      const token = getEncodedTokenV4({
        mint: mintUrl,
        unit,
        proofs: [{ id, amount: 4, secret: "synthetic-input", C: publicKey }],
      });

      const proofs = await useCashuToken().receiveToken(token);

      expect(swaps).toHaveLength(1);
      expect(swaps[0].inputs[0].id).toBe(id);
      expect(proofs.reduce((sum, proof) => sum + proof.amount, 0)).toBe(4);
      expect(proofs.every((proof) => proof.id === id)).toBe(true);
      expect(state.updateProofs).toHaveBeenCalledOnce();
      expect(journal.list("alice")).toEqual([]);
    }
  );
});
