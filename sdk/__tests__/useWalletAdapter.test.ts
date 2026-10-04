import { getDecodedToken, getEncodedTokenV4 } from "@cashu/cashu-ts";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useRef: <T>(value: T) => ({ current: value }),
  useEffect: () => undefined,
  useMemo: <T>(factory: () => T) => factory(),
}));

import { useWalletAdapter } from "@/hooks/useWalletAdapter";

const fullKeysetId = `01${"11".repeat(32)}`;

const shortKeysetToken = getEncodedTokenV4({
  mint: "https://mint.example.com",
  unit: "msat",
  proofs: [
    {
      id: fullKeysetId,
      amount: 2,
      secret: "synthetic-secret-1",
      C: `02${"22".repeat(32)}`,
    },
    {
      id: fullKeysetId,
      amount: 5,
      secret: "synthetic-secret-2",
      C: `03${"33".repeat(32)}`,
    },
  ],
});

describe("useWalletAdapter", () => {
  it("receives TokenV4 tokens with short keyset IDs", async () => {
    expect(() => getDecodedToken(shortKeysetToken)).toThrow(/short keyset ID/i);

    const receiveToken = vi.fn(async () => [{ amount: 10 }, { amount: 11 }]);
    const adapter = useWalletAdapter({
      mintBalances: {},
      mintUnits: {},
      cashuStore: {},
      sendToken: async () => "",
      receiveToken,
    });

    await expect(adapter?.receiveToken(shortKeysetToken)).resolves.toEqual({
      success: true,
      amount: 21,
      unit: "msat",
    });
    expect(receiveToken).toHaveBeenCalledWith(shortKeysetToken);
  });
});
