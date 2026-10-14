import { describe, expect, it } from "vitest";
import { promptTokensOf, replyCap } from "../replyCap";

describe("replyCap: the longest reply a request asks for", () => {
  it("is 64k tokens for a model that allows more, with room for the prompt", () => {
    expect(replyCap({ context: 400_000, maxOut: 128_000 }, () => 1_000)).toBe(64_000);
  });

  it("is none for a model whose own limit is 64k tokens or less", () => {
    expect(replyCap({ context: 1_000_000, maxOut: 64_000 }, () => 10)).toBeUndefined();
    expect(replyCap({ context: 65_536, maxOut: 8_192 }, () => 10)).toBeUndefined();
    expect(replyCap(undefined, () => 10)).toBeUndefined();
  });

  // a provider refuses a prompt and a reply over the context: a long chat keeps the model's own limit
  it("is none when the prompt leaves less than 64k tokens of the context", () => {
    expect(replyCap({ context: 128_000, maxOut: 115_000 }, () => 70_000)).toBeUndefined();
  });

  // Codex, 10-14: 121,000 Chinese characters are 79,200 tokens to gpt-oss, but 41,077 by
  // characters over three; with 64k more the request ran past the 131,072-token context
  it("never counts a prompt below its real token count, Chinese included", () => {
    const chinese = [{ role: "user", content: "模型".repeat(60_500) }];
    expect(promptTokensOf(chinese)).toBeGreaterThanOrEqual(79_200);
    expect(replyCap({ context: 131_072, maxOut: 117_964 }, () => promptTokensOf(chinese))).toBeUndefined();
  });

  // 10-14: Nano Banana 2.1 held 836 sats for a 46-sat picture; one picture reply is about
  // 1,300 to 4,500 tokens
  it("is 16k tokens for a model that makes pictures", () => {
    expect(replyCap({ context: 65_536, maxOut: 58_982, draws: true }, () => 100)).toBe(16_000);
    expect(replyCap({ context: 32_768, maxOut: 8_192, draws: true }, () => 100)).toBeUndefined();
  });
});
