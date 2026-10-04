import { describe, expect, it } from "vitest";
import type { Model } from "@/types/models";
import { fmt, handles, measureFor, priceScale, searchRank, sortRows, type Row } from "./catalog";

const model = (id: string, name: string, extra: Partial<Model> = {}) =>
  ({ id, name, created: 0, context_length: 0, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, ...extra }) as unknown as Model;
const row = (m: Model): Row => ({ key: m.id, model: m, pin: null });

describe("searchRank", () => {
  const names = ["OpenAI: GPT-5.5", "OpenAI: GPT-5.4 Mini", "OpenAI: GPT-5", "DeepSeek: R1 70B (private)"];
  const ms = names.map((n, i) => model(`m${i}`, n));
  const rank = (q: string) =>
    ms
      .map((m) => ({ n: m.name, r: searchRank(m, "OpenAI", q) }))
      .filter((x) => x.r > 0)
      .sort((a, b) => b.r - a.r)
      .map((x) => x.n);

  it("puts the exact name first", () => {
    expect(rank("gpt 5")[0]).toBe("OpenAI: GPT-5");
    expect(rank("gpt-5")[0]).toBe("OpenAI: GPT-5");
  });
  it("ranks a clean prefix above one that runs into a number", () => {
    expect(rank("gpt 5.4")[0]).toBe("OpenAI: GPT-5.4 Mini");
  });
  it("finds a model by its maker", () => {
    expect(searchRank(ms[0], "OpenAI", "openai")).toBeGreaterThan(0);
  });
  it("misses what does not match", () => {
    expect(searchRank(ms[3], "DeepSeek", "llama 9")).toBe(0);
  });
});

describe("sortRows", () => {
  const a = model("a", "A: Alpha", { created: 30, context_length: 1000 } as Partial<Model>);
  const b = model("b", "B: Beta", { created: 10, context_length: 0 } as Partial<Model>);
  const c = model("c", "C: Gamma", { created: 20, context_length: 5000 } as Partial<Model>);
  const rows = [a, b, c].map(row);
  const names = (rs: Row[]) => rs.map((r) => r.model.id).join("");

  it("newest first, and flips", () => {
    const m = measureFor("latest", () => 0, () => 1);
    expect(names(sortRows(rows, "latest", 1, m))).toBe("acb");
    expect(names(sortRows(rows, "latest", -1, m))).toBe("bca");
  });
  it("sinks rows with no value whichever way it runs", () => {
    const m = measureFor("context", () => 0, () => 1);
    expect(names(sortRows(rows, "context", 1, m))).toBe("cab");
    expect(names(sortRows(rows, "context", -1, m))).toBe("acb");
  });
  it("A to Z and back", () => {
    const m = measureFor("name", () => 0, () => 1);
    expect(names(sortRows(rows, "name", 1, m))).toBe("abc");
    expect(names(sortRows(rows, "name", -1, m))).toBe("cba");
  });
});

describe("words", () => {
  it("prices read the way the composer says them", () => {
    expect(fmt(7.46)).toBe("7");
    expect(fmt(1240.2)).toBe("1,240");
  });
  it("says what a model takes in and gives back", () => {
    const m = model("x", "X", { architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] } } as unknown as Partial<Model>);
    expect(handles(m)).toEqual(["Text, images and PDFs in", "text out"]);
  });
  it("places prices on a log line", () => {
    const s = priceScale([1, 10, 100]);
    expect(s.at(10)).toBeCloseTo(0.5);
  });
});
