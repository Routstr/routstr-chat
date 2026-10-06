import { describe, expect, it } from "vitest";
import { createMemoryDriver, type StorageDriver } from "@routstr/sdk/storage";
import { KeysService, dbName } from "../service";

// one disk per name, shared like IndexedDB is between tabs
const disk = () => {
  const drivers = new Map<string, StorageDriver>();
  return (name: string) => {
    if (!drivers.has(name)) drivers.set(name, createMemoryDriver());
    return drivers.get(name)!;
  };
};

describe("KeysService", () => {
  it("keeps each account's keys apart, under main's database names", async () => {
    const open = disk();
    const opened: string[] = [];
    const alice = new KeysService("alice", (n) => (opened.push(n), open(n)));
    const bob = new KeysService("bob", open);
    await Promise.all([alice.ready(), bob.ready()]);

    alice.storage().setApiKey("https://p.test/", "sk-alice");
    expect(alice.keys().map((k) => k.key)).toEqual(["sk-alice"]);
    expect(bob.keys()).toEqual([]);
    expect(opened).toEqual([dbName("alice", "direct")]);
    expect(dbName("alice", "node")).toBe("routstr-chat-payments:alice:node");
  });

  it("sees what another tab wrote after reload, and tells listeners", async () => {
    const open = disk();
    const tabA = new KeysService("alice", open);
    const tabB = new KeysService("alice", open);
    await Promise.all([tabA.ready(), tabB.ready()]);
    let heard = 0;
    tabB.subscribe(() => heard++);

    tabA.storage().setApiKey("https://p.test/", "sk-1");
    await tabA.flush();
    expect(tabB.keys()).toEqual([]);

    await tabB.reload();
    expect(tabB.keys().map((k) => k.key)).toEqual(["sk-1"]);
    expect(heard).toBe(1);
  });

  it("lets one holder of an account's lock at a time", async () => {
    const keys = new KeysService(`lock-${Math.random()}`, disk());
    const order: string[] = [];
    const first = await keys.lock();
    const second = keys.lock().then((release) => {
      order.push("second");
      release();
    });
    await new Promise((r) => setTimeout(r, 20));
    order.push("first done");
    first();
    await second;
    expect(order).toEqual(["first done", "second"]);
  });

  it("holds the same lock as main's payment code, so a main tab waits too", async () => {
    const keys = new KeysService("alice", disk());
    const release = await keys.lock();
    const { held } = await navigator.locks.query();
    release();
    expect(held?.map((l) => l.name)).toContain("routstr-chat-payment:alice");
  });
});
