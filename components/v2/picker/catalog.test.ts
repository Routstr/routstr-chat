import { describe, expect, it } from "vitest";
import type { Model } from "@/types/models";
import { answers, baseKey, fmt, handles, hostOf, makerOf, measureFor, mostReferences, priceScale, searchRank, sortRows, type Row } from "./catalog";
import { offList, pct, smartsOf } from "./deals";
import list from "./openrouter.json";

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
  const a = model("a", "A: Alpha", { created: 30, context_length: 1000 } as unknown as Partial<Model>);
  const b = model("b", "B: Beta", { created: 10, context_length: 0 } as unknown as Partial<Model>);
  const c = model("c", "C: Gamma", { created: 20, context_length: 5000 } as unknown as Partial<Model>);
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

describe("deals", () => {
  // whatever the shipped list holds: a model only one maker has, sold at a share of its list price
  const all = Object.entries(list.prices);
  const bare = (x: string) => x.slice(x.indexOf("/") + 1);
  const [id, [lp, lc]] = all.find(([x]) => all.filter(([y]) => bare(y) === bare(x)).length === 1)!;
  const sold = (at: string, share: number) => model(at, "X: Y", { pricing: { prompt: lp * share, completion: lc * share } } as unknown as Partial<Model>);

  it("a model sold for a tenth of its list price is 90% off", () => {
    expect(pct(offList(sold(id, 0.1))!)).toBe("90%");
  });
  it("finds a model a node lists without its maker's prefix", () => {
    expect(offList(sold(bare(id), 0.5))).toBeCloseTo(0.5);
  });
  it("a little less than list is no deal, and neither is an unpriced listing", () => {
    expect(offList(sold(id, 0.95))).toBeNull();
    expect(offList(sold(id, 0))).toBeNull();
    expect(offList(sold("nobody/unlisted-model", 0.1))).toBeNull();
  });
  it("never rounds up to a deal it is not, and float dust never costs a point", () => {
    expect(pct(0.929)).toBe("92%");
    expect(pct(0.29)).toBe("29%");
    expect(pct(offList(sold(id, 0.9))!)).toBe("10%");
    expect(pct(offList(sold(id, 0.8))!)).toBe("20%");
    expect(pct(offList(sold(id, 0.71))!)).toBe("29%");
  });
  // the cleverest and the least clever model the list scores
  const scored = Object.entries(list.intelligence).sort((a, b) => b[1] - a[1]);
  const [clever, dim] = [scored[0][0], scored[scored.length - 1][0]];
  it("finds a model's intelligence as it finds its price", () => {
    expect(smartsOf(clever)).toBe(scored[0][1]);
    expect(smartsOf(bare(clever))).toBe(scored[0][1]);
    expect(smartsOf("nobody/unscored-model")).toBeUndefined();
  });
  it("best deal first: a cut on a clever model before a bigger cut on a dim one, unscored deals after by what they save, no deal last", () => {
    const off: Record<string, number> = { [dim]: 0.9, [clever]: 0.4, "nobody/a": 0.3, "nobody/b": 0.8 };
    const m = measureFor("deal", () => 0, () => 1, (r) => off[r.model.id] ?? null);
    const rows = [dim, "nobody/a", "nobody/c", clever, "nobody/b"].map((x) => row(model(x, x)));
    expect(sortRows(rows, "deal", 1, m).map((r) => r.model.id)).toEqual([clever, dim, "nobody/b", "nobody/a", "nobody/c"]);
  });
  it("smartest first, unscored models after", () => {
    const m = measureFor("smart", () => 0, () => 1);
    const rows = ["nobody/a", dim, clever].map((x) => row(model(x, x)));
    expect(sortRows(rows, "smart", 1, m).map((r) => r.model.id)).toEqual([clever, dim, "nobody/a"]);
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

describe("baseKey and hostOf", () => {
  it("keys a base url with a scheme and a closing slash, as pins and the cache do", () => {
    expect(baseKey("api.example.com")).toBe("https://api.example.com/");
    expect(baseKey("http://127.0.0.1:8000")).toBe("http://127.0.0.1:8000/");
    expect(baseKey("https://api.example.com/")).toBe("https://api.example.com/");
  });

  it("names a route by its host, else by the maker in the model's name", () => {
    expect(hostOf("https://api.example.com/", model("m", "OpenAI: GPT-5"))).toBe("api.example.com");
    expect(hostOf(null, model("m", "OpenAI: GPT-5"))).toBe("OpenAI");
    expect(hostOf(null, model("m", "GPT-5"))).toBe("Unknown");
  });
});

describe("answers: the models a chat can talk to", () => {
  const takes = (input_modalities: string[], output_modalities: string[]) =>
    model("m", "M", { architecture: { input_modalities, output_modalities } } as unknown as Partial<Model>);

  it("keeps a model that answers in words, pictures too or not", () => {
    expect(answers(takes(["text"], ["text"]))).toBe(true);
    expect(answers(takes(["text", "image"], ["image", "text"]))).toBe(true);
  });

  it("leaves out a model that only makes pictures: providers send it to the images API", () => {
    expect(answers(takes(["text"], ["image"]))).toBe(false);
  });

  it("leaves out a model that does not read text", () => {
    expect(answers(takes(["audio"], ["text"]))).toBe(false);
  });
});

describe("mostReferences: the pictures of yours a picture model works from", () => {
  const painter = (input_modalities: string[], refs: (number | undefined)[]) =>
    model("p", "P", {
      architecture: { input_modalities, output_modalities: ["image"] },
      image_pricing: {
        max_usd: 0.04,
        tiers: [],
        resolutions: [],
        qualities: [],
        default_resolution: null,
        default_quality: null,
        endpoints: Object.fromEntries(refs.map((max, i) => [`e${i}`, { parameters: max === undefined ? {} : { input_references: { max } } }])),
      },
    } as unknown as Partial<Model>);

  it("takes as many as its most generous endpoint lists", () => {
    expect(mostReferences(painter(["text", "image"], [1]))).toBe(1);
    expect(mostReferences(painter(["text", "image"], [3, 14, undefined]))).toBe(14);
  });

  it("takes none from a model that reads only words, or lists no limit", () => {
    expect(mostReferences(painter(["text"], [4]))).toBe(0);
    expect(mostReferences(painter(["text", "image"], [undefined]))).toBe(0);
    expect(mostReferences(painter(["text", "image"], []))).toBe(0);
  });
});

describe("makerOf: the maker a model is filed under", () => {
  it("reads the maker from the id or the name", () => {
    expect(makerOf(model("magistral-small-2506", "Magistral Small 2506"))).toBe("mistral");
    expect(makerOf(model("lyria-3-pro-preview", "Lyria 3 Pro Preview"))).toBe("google");
    expect(makerOf(model("inclusionai/ling-3.0-flash", "Ling 3.0 Flash"))).toBe("inclusionai");
    expect(makerOf(model("seedream-v5-pro", "Seedream V5 Pro"))).toBe("bytedance");
  });

  it("matches a short keyword only where a word starts", () => {
    expect(makerOf(model("sao10k/l3.1-euryale-70b", "Llama 3.1 Euryale 70B"))).toBe("meta");
    expect(makerOf(model("openai/o3-pro", "o3 Pro"))).toBe("openai");
    expect(makerOf(model("wan-2.5", "Wan 2.5"))).toBe("alibaba");
    expect(makerOf(model("solar-pro4", "Upstage: Solar Pro 4"))).toBe("upstage");
    expect(makerOf(model("swan-7b", "Swan 7B"))).toBe("other");
  });
});
