import { describe, expect, it } from "vitest";
import { firstNeed } from "./useFirstSend";

const me = { node: false, pubkey: "a".repeat(64), keys: true, loading: false, total: 0, held: 0 };

describe("what a first send needs", () => {
  it("asks only for sats with no key yet, and which key with some on the device, unless a node pays", () => {
    expect(firstNeed({ ...me, pubkey: null, keys: false })).toBe("try");
    expect(firstNeed({ ...me, pubkey: null })).toBe("who");
    expect(firstNeed({ ...me, pubkey: null, keys: false, node: true })).toBeNull();
  });

  it("offers the try only when there is nothing to pay with", () => {
    expect(firstNeed(me)).toBe("try");
    expect(firstNeed({ ...me, total: 5 })).toBeNull();
    // change a provider still holds pays the next reply too
    expect(firstNeed({ ...me, held: 12 })).toBeNull();
  });

  it("waits for the wallet to load before deciding", () => {
    expect(firstNeed({ ...me, loading: true })).toBeNull();
  });
});
