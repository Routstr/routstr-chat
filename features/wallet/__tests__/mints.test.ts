import { describe, expect, it, vi } from "vitest";
import { MintKeysets } from "../mints";

const keyset = (id: string, unit: string) =>
  ({ id, unit, active: true, input_fee_ppk: 0 }) as never;

describe("MintKeysets", () => {
  it("tells a coin's unit by its keyset id, full or short, asking each mint once", async () => {
    const fetch = vi.fn(async () => [
      keyset("00ad268c4d1f5826", "sat"),
      keyset(
        "01b6092902c88edf6e371d4e1d7a2260da20626b51b6c910578015949b370ae946",
        "msat"
      ),
    ]);
    const mints = new MintKeysets(fetch);
    expect(await mints.unitOf("m", "00ad268c4d1f5826")).toBe("sat");
    expect(await mints.unitOf("m", "01b6092902c88edf")).toBe("msat");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("asks again for a keyset it does not know, and keeps no failed answer", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([keyset("00aa", "sat")])
      .mockResolvedValue([keyset("00aa", "sat"), keyset("00bb", "sat")]);
    const mints = new MintKeysets(fetch);
    await expect(mints.unitOf("m", "00aa")).rejects.toThrow("offline");
    expect(await mints.unitOf("m", "00aa")).toBe("sat");
    expect(await mints.unitOf("m", "00bb")).toBe("sat"); // rotated in since
    await expect(mints.unitOf("m", "00cc")).rejects.toThrow("no keyset");
  });
});
