import { describe, expect, it } from "vitest";
import { hydrate, storageAdapter } from "../sharedStore";
import { hasCredit, legacyCredit } from "../refundCredit";

describe("credit saved before payments were per account", () => {
  it("is refundable, except the node's own key", async () => {
    await hydrate;
    storageAdapter.setApiKey("https://provider.example/", "provider-fixture");
    storageAdapter.setApiKey("https://node.example/", "node-fixture");

    const legacy = legacyCredit("https://node.example");
    expect(legacy.getAllApiKeys().map((key) => key.key)).toEqual([
      "provider-fixture",
    ]);
    expect(legacy.getApiKey("https://node.example/")).toBeNull();
    expect(hasCredit(legacy)).toBe(true);

    storageAdapter.removeApiKey("https://provider.example/");
    expect(hasCredit(legacy)).toBe(false);
    expect(hasCredit(legacyCredit())).toBe(true);
  });
});
