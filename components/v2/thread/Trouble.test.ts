import { describe, expect, it } from "vitest";
import { NODE_SAYS } from "@/features/payments/view";
import { kindOf } from "./Trouble";

describe("kindOf: what a failed reply is said to be", () => {
  // routstr.otrta.me, 10-14: every request came back 503 with this, shown as "Something went wrong"
  it("reads a provider's mint turning payments away as the provider being busy", () => {
    expect(kindOf("Uncaught Error: all_providers_failed: Cashu mint is rate-limiting requests; retry later")).toBe("busy");
  });

  it("still reads a short wallet as not enough sats", () => {
    expect(kindOf("Insufficient balance: need 40 sats, have 10 sats available.")).toBe("funds");
  });

  it("reads node mode's own words as the node's", () => {
    for (const words of Object.values(NODE_SAYS)) expect(kindOf(words)).toBe("node");
  });
});
