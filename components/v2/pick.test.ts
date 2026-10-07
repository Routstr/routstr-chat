import { describe, expect, it, vi } from "vitest";
import type { Model } from "@/types/models";
import { ModelPick, choiceOf, defaultModel, keyOf, modelFor, pickedModel } from "./pick";

function memory(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed));
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items };
}
const model = (id: string) => ({ id, name: id }) as Model;

describe("ModelPick: main's keys", () => {
  it("takes main's last used model, quoted, bare, or pinned to a provider", () => {
    expect(new ModelPick(memory({ lastUsedModel: '"gpt-5"' })).getSnapshot().chosen).toEqual({ id: "gpt-5" });
    expect(new ModelPick(memory({ lastUsedModel: "gpt-5" })).getSnapshot().chosen).toEqual({ id: "gpt-5" });
    expect(new ModelPick(memory({ lastUsedModel: '"gpt-5@@api.example.com"' })).getSnapshot().chosen).toEqual({
      id: "gpt-5",
      provider: "https://api.example.com/",
    });
    expect(new ModelPick(memory()).getSnapshot().chosen).toBeNull();
  });

  it("lets a ?model= link pick for this visit, keeping your choice under it", () => {
    const storage = memory({ lastUsedModel: '"gpt-5"' });
    const pick = new ModelPick(storage, "?model=openai%2Fgpt-4o");
    expect(pick.getSnapshot()).toMatchObject({ link: { id: "openai/gpt-4o" }, chosen: { id: "gpt-5" } });
    expect(storage.items.get("lastUsedModel")).toBe('"gpt-5"');
    const list = [model("gpt-4o"), model("gpt-5")];
    expect(pickedModel(list, pick.getSnapshot())?.id).toBe("gpt-4o");
    // a link to a model nobody serves falls back to your choice, not to the default
    expect(pickedModel([model("gpt-5")], pick.getSnapshot())?.id).toBe("gpt-5");
    // choosing ends the link's turn
    pick.choose({ id: "gpt-5" });
    expect(pick.getSnapshot().link).toBeNull();
  });

  it("saves a choice as main does and tells listeners", () => {
    const storage = memory();
    const pick = new ModelPick(storage);
    const heard = vi.fn();
    pick.subscribe(heard);
    const before = pick.getSnapshot();
    pick.choose({ id: "gpt-5", provider: "https://api.example.com/" });
    expect(storage.items.get("lastUsedModel")).toBe('"gpt-5@@https://api.example.com/"');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(pick.getSnapshot()).not.toBe(before);
    expect(new ModelPick(storage).getSnapshot().chosen).toEqual({ id: "gpt-5", provider: "https://api.example.com/" });
  });

  it("brings main's old favorites over as your models, once", () => {
    const storage = memory({ favorite_models: '["a","b"]' });
    expect(new ModelPick(storage).getSnapshot().configured).toEqual(["a", "b"]);
    expect(storage.items.get("configured_models")).toBe('["a","b"]');
    storage.items.set("configured_models", "[]");
    expect(new ModelPick(storage).getSnapshot().configured).toEqual([]);
  });

  it("adds and removes your models, and keeps a pin per model", () => {
    const storage = memory({ configured_models: '["a"]' });
    const pick = new ModelPick(storage);
    pick.toggle("b@@https://p.example/");
    pick.toggle("a");
    expect(pick.getSnapshot().configured).toEqual(["b@@https://p.example/"]);
    pick.pin("b", "https://p.example/");
    expect(JSON.parse(storage.items.get("model_provider_map")!)).toEqual({ b: "https://p.example/" });
    expect(JSON.parse(storage.items.get("configured_models")!)).toEqual(["b@@https://p.example/"]);
  });

  it("still works when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const pick = new ModelPick(blocked);
    expect(pick.getSnapshot()).toEqual({ chosen: null, link: null, configured: [], pins: {} });
    pick.choose({ id: "gpt-5" });
    expect(pick.getSnapshot().chosen).toEqual({ id: "gpt-5" });
  });
});

describe("keys and lookups", () => {
  it("round-trips main's key", () => {
    expect(keyOf(choiceOf("m@@https://p.example/"))).toBe("m@@https://p.example/");
    expect(keyOf(choiceOf("m"))).toBe("m");
  });

  it("finds a linked model by its full or short id", () => {
    const list = [model("gpt-5"), model("claude-sonnet-5")];
    expect(modelFor(list, { id: "gpt-5" })?.id).toBe("gpt-5");
    expect(modelFor(list, { id: "openai/gpt-5" })?.id).toBe("gpt-5");
    expect(modelFor(list, { id: "gone" })).toBeNull();
    expect(modelFor(list, null)).toBeNull();
  });
});

describe("defaultModel", () => {
  const need: Record<string, number> = { cheap: 5, mid: 50, dear: 500, unknown: 0 };
  const list = ["cheap", "mid", "dear", "unknown"].map(model);
  const needOf = (m: Model) => need[m.id];
  const within = (sats: number) => (m: Model) => needOf(m) <= sats;

  it("takes the first of Routstr's picks you can afford, in their order", () => {
    expect(defaultModel(list, ["dear", "mid", "cheap"], needOf, within(100))?.id).toBe("mid");
  });

  it("else the costliest you can afford, never one whose price is unknown", () => {
    expect(defaultModel(list, ["dear"], needOf, within(100))?.id).toBe("mid");
    expect(defaultModel(list, [], needOf, within(1000))?.id).toBe("dear");
    expect(defaultModel([model("unknown")], ["unknown"], needOf, within(1000))).toBeNull();
  });

  it("picks nothing you cannot afford", () => {
    expect(defaultModel(list, ["cheap"], needOf, within(1))).toBeNull();
  });

  it("asks whether each model is affordable on its own: credit held where only one goes", () => {
    expect(defaultModel(list, [], needOf, (m) => m.id === "dear")?.id).toBe("dear");
  });
});
