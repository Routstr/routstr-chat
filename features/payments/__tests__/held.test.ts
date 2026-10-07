import { describe, expect, it } from "vitest";
import { heldSats, keyCredit } from "../held";
import { fakeKeys, tokenOf } from "./fakes";

describe("heldSats", () => {
  it("adds what the keys hold, X-Cashu tokens and refunds not taken in yet, in sats", async () => {
    const { keys } = fakeKeys();
    await keys.ready();
    const storage = keys.storage();
    expect(heldSats(storage)).toBe(0);

    storage.setApiKey("https://a.example/", "k1");
    storage.updateApiKeyBalance("https://a.example/", 120);
    storage.setCachedReceiveTokens([
      { token: "t1", amount: 30, unit: "sat", createdAt: 1 },
      { token: "t2", amount: 5000, unit: "msat", createdAt: 2 },
    ]);

    expect(heldSats(storage)).toBe(155);

    storage.addXcashuToken("https://a.example/", tokenOf(40));
    expect(heldSats(storage)).toBe(195);

    // a key the provider has not reported on yet holds the token it was made from
    storage.setApiKey("https://b.example/", tokenOf(7));
    expect(heldSats(storage)).toBe(202);
  });
});

describe("keyCredit", () => {
  it("is what each provider's key holds, nothing else held counts", async () => {
    const { keys } = fakeKeys();
    await keys.ready();
    const storage = keys.storage();
    expect(keyCredit(storage)).toEqual({});

    storage.setApiKey("https://a.example", "k1");
    storage.updateApiKeyBalance("https://a.example/", 120);
    storage.setApiKey("https://b.example/", tokenOf(7));
    // not spent by the next message: X-Cashu tokens and refunds waiting for the wallet
    storage.addXcashuToken("https://c.example/", tokenOf(40));
    storage.setCachedReceiveTokens([{ token: "t1", amount: 30, unit: "sat", createdAt: 1 }]);

    expect(keyCredit(storage)).toEqual({ "https://a.example/": 120, "https://b.example/": 7 });
  });
});
