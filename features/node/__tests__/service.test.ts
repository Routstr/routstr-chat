import { describe, expect, it, vi } from "vitest";
import { NodeError, type NodeLink } from "../ports";
import { NODE_KEY, NodeSetting, nodeUrl, type RemoteNode } from "../service";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
const NODE: RemoteNode = { url: "https://node.example/", apiKey: "sk-1", pubkey: ME, enabled: true };

function memory(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    items,
  };
}

const setting = (seed?: Record<string, string>, link: NodeLink = { connect: async () => "sk-new" }) => {
  const storage = memory(seed);
  const s = new NodeSetting(link);
  s.boot(storage);
  return { s, storage };
};

describe("nodeUrl", () => {
  it("makes a typed address a base URL", () => {
    expect(nodeUrl(" node.example ")).toBe("https://node.example/");
    expect(nodeUrl("http://10.0.0.2:8000")).toBe("http://10.0.0.2:8000/");
    expect(nodeUrl("https://node.example/")).toBe("https://node.example/");
    expect(nodeUrl("   ")).toBeNull();
  });
});

describe("NodeSetting", () => {
  it("reads main's saved node", () => {
    const { s } = setting({ [NODE_KEY]: JSON.stringify(NODE) });
    expect(s.get()).toEqual(NODE);
  });

  it("pays only when on, holding a key, for the npub the key was issued to", () => {
    const { s } = setting({ [NODE_KEY]: JSON.stringify(NODE) });
    expect(s.paysFor(ME)).toEqual(NODE);
    expect(s.paysFor(OTHER)).toBeNull();
    expect(s.paysFor(null)).toBeNull();
    s.save({ ...NODE, enabled: false });
    expect(s.paysFor(ME)).toBeNull();
    s.save({ ...NODE, apiKey: "" });
    expect(s.paysFor(ME)).toBeNull();
  });

  it("keeps the same snapshot until the setting changes, and tells listeners once per change", () => {
    const { s, storage } = setting({ [NODE_KEY]: JSON.stringify(NODE) });
    const heard = vi.fn();
    s.subscribe(heard);
    const first = s.get();
    s.reload();
    expect(s.get()).toBe(first);
    expect(heard).not.toHaveBeenCalled();
    // another tab paused it
    storage.setItem(NODE_KEY, JSON.stringify({ ...NODE, enabled: false }));
    s.reload();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(s.get()?.enabled).toBe(false);
  });

  it("saves as main does, so either app reads it", () => {
    const { s, storage } = setting();
    s.save(NODE);
    expect(JSON.parse(storage.items.get(NODE_KEY)!)).toEqual(NODE);
    s.save(null);
    expect(storage.items.get(NODE_KEY)).toBe("null");
    expect(s.get()).toBeNull();
  });

  it("connects: the node's key is saved, on, for this npub", async () => {
    const { s } = setting();
    await s.connect("https://node.example/", ME, { signEvent: vi.fn() });
    expect(s.get()).toEqual({ url: "https://node.example/", apiKey: "sk-new", pubkey: ME, enabled: true });
  });

  it("saves nothing when the node refuses", async () => {
    const refuse: NodeLink = { connect: async () => Promise.reject(new NodeError("not yet", true)) };
    const { s } = setting({}, refuse);
    await expect(s.connect("https://node.example/", ME, { signEvent: vi.fn() })).rejects.toMatchObject({ unauthorized: true });
    expect(s.get()).toBeNull();
  });

  it("treats a broken saved value as no node", () => {
    const { s } = setting({ [NODE_KEY]: "{not json" });
    expect(s.get()).toBeNull();
    expect(s.paysFor(ME)).toBeNull();
  });
});
