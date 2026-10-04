import { describe, it, expect } from "vitest";
import { shortModelName as s } from "@/components/v2/format";
describe("shortModelName", () => {
  it("writes raw ids the way people do", () => {
    for (const [i, o] of [["claude-sonnet-5","Claude Sonnet 5"],["ollama_cloud/kimi-k3","Kimi K3"],["codex/gpt-6-astra","GPT-6 Astra"],["claude-opus-5.5","Claude Opus 5.5"],["llama-3.1-8b-instruct","Llama 3.1 8B Instruct"],["tinfoil-deepseek-v4-1-flash","Tinfoil DeepSeek V4.1 Flash"],["mistral-nemo","Mistral Nemo"],["gpt-oss-20b","GPT OSS 20B"]]) expect(s(i)).toBe(o);
    expect(s("Anthropic: Claude Fable 5.1")).toBe("Claude Fable 5.1");
    expect(s(undefined, "codex/gpt-6-luna")).toBe("GPT-6 Luna");
  });
});
