import { describe, expect, it } from "vitest";
import { depositMint } from "../depositMint";

const base = { picked: false, balances: {}, fallback: "https://default.mint" };

describe("depositMint", () => {
  it("adds to the accepted mint that already holds the most, so one mint can pay", () => {
    expect(
      depositMint({
        ...base,
        active: "https://x",
        known: ["https://x", "https://a", "https://b"],
        balances: { "https://x": 90, "https://b": 60 },
        accepted: ["https://a", "https://b/"],
      })
    ).toBe("https://b");
  });

  it("keeps the active mint when it is accepted and nothing accepted holds more", () => {
    expect(
      depositMint({
        ...base,
        active: "https://a/",
        known: ["https://a/", "https://b"],
        accepted: ["https://b", "https://a"],
      })
    ).toBe("https://a/");
  });

  it("goes to the provider's first mint when the wallet knows none it takes", () => {
    expect(
      depositMint({
        ...base,
        active: "https://x",
        known: ["https://x"],
        accepted: ["https://c", "https://b"],
      })
    ).toBe("https://c");
  });

  it("keeps a mint the person picked", () => {
    expect(
      depositMint({
        ...base,
        picked: true,
        active: "https://x",
        known: ["https://x"],
        accepted: ["https://c"],
      })
    ).toBe("https://x");
  });

  it("keeps today's choice while no provider is known", () => {
    expect(
      depositMint({
        ...base,
        active: "https://a",
        known: ["https://b"],
        accepted: [],
      })
    ).toBe("https://a");
    expect(depositMint({ ...base, known: ["https://b"], accepted: [] })).toBe(
      "https://b"
    );
    expect(depositMint({ ...base, known: [], accepted: [] })).toBe(
      base.fallback
    );
  });
});
