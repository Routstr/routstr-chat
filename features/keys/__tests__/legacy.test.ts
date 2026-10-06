import { describe, expect, it, vi } from "vitest";
import {
  createSdkStore,
  createStorageAdapterFromStore,
  type StorageDriver,
} from "@routstr/sdk/storage";

// main's old IndexedDB store: a write lands a moment after it is made
const disk = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const reads: string[] = [];
  const driver = {
    getItem: async (key: string, fallback: unknown) => (
      reads.push(key),
      data.has(key) ? structuredClone(data.get(key)) : fallback
    ),
    setItem: (key: string, value: unknown) =>
      new Promise<void>((done) =>
        setTimeout(() => (data.set(key, structuredClone(value)), done()), 5)
      ),
    removeItem: async (key: string) => void data.delete(key),
  };
  return { driver, reads };
});
vi.mock("@/sdk/sharedStore", () => ({ driver: disk.driver }));

import { lockLegacy, oldCredit } from "../legacy";

// main's old store, as main left it
const seed = async (keys: Record<string, string>) => {
  const { store, hydrate } = createSdkStore({
    driver: disk.driver as StorageDriver,
  });
  await hydrate;
  const main = createStorageAdapterFromStore(store);
  Object.entries(keys).forEach(([url, key]) => main.setApiKey(url, key));
  await main.flush?.();
};
const listed = async (nodeUrl?: string) =>
  (await oldCredit(() => nodeUrl).load()).getAllApiKeys().map((k) => k.key);

describe("oldCredit", () => {
  it("hides the node's key, and a sweep's removal reaches main's old store", async () => {
    await seed({
      "https://p.test/": "sk-old",
      "https://node.test/": "sk-node",
    });
    const old = await oldCredit(() => "https://node.test").load();

    expect(old.getAllApiKeys().map((k) => k.key)).toContain("sk-old");
    expect(old.getAllApiKeys().map((k) => k.key)).not.toContain("sk-node");
    expect(old.getApiKey("https://node.test/")).toBeNull();

    old.removeApiKey("https://p.test/");
    await old.flush?.();
    expect(await listed()).not.toContain("sk-old");
    expect(await listed()).toContain("sk-node");
  });

  it("reads the node that pays at each load", async () => {
    await seed({ "https://a.test/": "sk-a", "https://b.test/": "sk-b" });
    let node = "https://a.test";
    const credit = oldCredit(() => node);

    const first = (await credit.load()).getAllApiKeys().map((k) => k.key);
    node = "https://b.test";
    const second = (await credit.load()).getAllApiKeys().map((k) => k.key);

    expect(first).not.toContain("sk-a");
    expect(second).toContain("sk-a");
    expect(second).not.toContain("sk-b");
    expect(credit.lock).toBe(lockLegacy);
  });

  it("sees what another tab already swept, so it never sweeps a stale copy", async () => {
    await seed({ "https://swept.test/": "sk-swept" });
    const credit = oldCredit(() => undefined);
    const before = await credit.load();
    expect(before.getAllApiKeys().map((k) => k.key)).toContain("sk-swept");

    const otherTab = await oldCredit(() => undefined).load();
    otherTab.removeApiKey("https://swept.test/");
    await otherTab.flush?.();

    const after = await credit.load();
    expect(after.getAllApiKeys().map((k) => k.key)).not.toContain("sk-swept");
  });

  it("two refunds in one tab, with another load in between, leave none behind", async () => {
    await seed({
      "https://one.test/": "sk-one",
      "https://two.test/": "sk-two",
    });
    const credit = oldCredit(() => undefined);
    const release = await credit.lock();
    const sweep = await credit.load();

    sweep.removeApiKey("https://one.test/");
    // the chat's "anything there?" hint, while the sweep is between two keys
    await credit.load();
    sweep.removeApiKey("https://two.test/");
    await sweep.flush?.();
    release();

    const left = await listed();
    expect(left).not.toContain("sk-one");
    expect(left).not.toContain("sk-two");
  });

  it("reads only the credit from main's old store, not its models and providers", async () => {
    disk.reads.length = 0;
    await oldCredit(() => undefined).load();
    expect(new Set(disk.reads)).toEqual(
      new Set([
        "api_keys",
        "child_keys",
        "xcashu_tokens",
        "cached_receive_tokens",
      ])
    );
  });

  it("lets one sweep at a time hold the old store", async () => {
    const order: string[] = [];
    const first = await lockLegacy();
    const second = lockLegacy().then((release) => {
      order.push("second");
      release();
    });
    await new Promise((r) => setTimeout(r, 20));
    order.push("first done");
    first();
    await second;
    expect(order).toEqual(["first done", "second"]);
  });
});
