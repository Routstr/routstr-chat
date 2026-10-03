import { describe, expect, it } from "vitest";
import { isInvalidApiKeyError } from "../apiKeyErrors";

describe("isInvalidApiKeyError", () => {
  it.each(["invalid_api_key", "key_not_found"])(
    "recognizes %s in both Core error envelopes",
    (code) => {
      expect(isInvalidApiKeyError({ error: { code } })).toBe(true);
      expect(isInvalidApiKeyError({ detail: { error: { code } } })).toBe(true);
    }
  );

  it.each(["insufficient_balance", "internal_server_error", "unauthorized"])(
    "does not treat %s as an invalid key",
    (code) => {
      expect(isInvalidApiKeyError({ error: { code } })).toBe(false);
      expect(isInvalidApiKeyError({ detail: { error: { code } } })).toBe(false);
    }
  );

  it("does not treat missing error codes or a successful balance as invalid", () => {
    expect(isInvalidApiKeyError(undefined)).toBe(false);
    expect(isInvalidApiKeyError(null)).toBe(false);
    expect(isInvalidApiKeyError({})).toBe(false);
    expect(isInvalidApiKeyError({ error: {} })).toBe(false);
    expect(isInvalidApiKeyError({ detail: { error: {} } })).toBe(false);
    expect(isInvalidApiKeyError({ balance: 1000 })).toBe(false);
  });
});
