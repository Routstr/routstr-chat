import { describe, expect, it } from "vitest";
import { createMemoryDriver, type StorageDriver } from "@routstr/sdk/storage";
import { KeysService } from "../service";
import { KeyBackup, parseBackup, type SyncedApiKey } from "../backup";
import type { Remote } from "../relayBackup";

const setup = async () => {
  const drivers = new Map<string, StorageDriver>();
  const open = (name: string) => {
    if (!drivers.has(name)) drivers.set(name, createMemoryDriver());
    return drivers.get(name)!;
  };
  const keys = new KeysService(`acct-${Math.random()}`, open);
  await keys.ready();
  const published: SyncedApiKey[][] = [];
  let push: (remote: Remote<SyncedApiKey[]>) => void = () => {};
  const backup = new KeyBackup(
    keys,
    "this-device",
    {
      watch: (listener) => ((push = listener), () => {}),
      publish: async (list) => void published.push(list),
    },
    0
  );
  const stop = backup.start();
  const tick = () => new Promise((r) => setTimeout(r, 10));
  return {
    keys,
    open,
    backup,
    published,
    push: (r: Remote<SyncedApiKey[]>) => push(r),
    stop,
    tick,
  };
};

const entry = (device: string, baseUrl: string, key: string): SyncedApiKey => ({
  device,
  baseUrl,
  key,
  balance: 1000,
  lastUsed: null,
});

describe("KeyBackup", () => {
  it("never publishes before the relays answered, then publishes this device's keys beside the others'", async () => {
    const t = await setup();
    t.keys.storage().setApiKey("https://a.test/", "sk-a");
    await t.tick();
    expect(t.published).toEqual([]);

    await t.backup.apply([entry("other-device", "https://b.test/", "sk-b")]);
    expect(
      t.published
        .at(-1)!
        .map((k) => `${k.device} ${k.key}`)
        .sort()
    ).toEqual(["other-device sk-b", "this-device sk-a"]);
    expect(t.backup.otherKeys().map((k) => k.key)).toEqual(["sk-b"]);
  });

  it("restores this device's lost keys, but not one removed here or replaced by a newer key", async () => {
    const t = await setup();
    t.keys.storage().setApiKey("https://keep.test/", "sk-new");
    t.keys.storage().setApiKey("https://gone.test/", "sk-removed");
    await t.backup.apply("none");
    t.keys.storage().removeApiKey("https://gone.test/");
    await t.tick();

    await t.backup.apply([
      entry("this-device", "https://lost.test/", "sk-lost"),
      entry("this-device", "https://keep.test/", "sk-old"),
      entry("this-device", "https://gone.test/", "sk-removed"),
    ]);

    expect(
      t.keys
        .keys()
        .map((k) => k.key)
        .sort()
    ).toEqual(["sk-lost", "sk-new"]);
  });

  it("never writes over a backup it cannot read, even after reading an older one", async () => {
    const t = await setup();
    t.keys.storage().setApiKey("https://a.test/", "sk-a");
    expect(parseBackup([{ key: "sk-x" }])).toBe("unreadable");

    await t.backup.apply("unreadable");
    await t.tick();
    expect(t.published).toEqual([]);

    await t.backup.apply([entry("this-device", "https://a.test/", "sk-a")]);
    await t.backup.apply("unreadable");
    t.keys.storage().setApiKey("https://c.test/", "sk-c");
    await t.tick();
    expect(t.published).toEqual([]);
  });

  it("lets the chat drop refunded keys twice in a row, outside any lock", async () => {
    const t = await setup();
    await t.backup.apply([
      entry("other-device", "https://b.test/", "sk-b"),
      entry("other-device", "https://c.test/", "sk-c"),
    ]);
    await Promise.all([
      t.backup.dropOthers(["sk-b"]),
      t.backup.dropOthers(["sk-b"]),
    ]);
    await t.backup.dropOthers(["sk-b"]);

    expect(t.backup.otherKeys().map((k) => k.key)).toEqual(["sk-c"]);
    expect(t.published.at(-1)!.map((k) => k.key)).toEqual(["sk-c"]);
    expect(t.published.length).toBeLessThanOrEqual(2);
  });

  it("publishes only when the set changes, and drops other devices' keys after a refund", async () => {
    const t = await setup();
    await t.backup.apply([entry("other-device", "https://b.test/", "sk-b")]);
    expect(t.published).toEqual([]);

    await t.backup.dropOthers(["sk-b"]);
    expect(t.published).toEqual([[]]);
    expect(t.backup.otherKeys()).toEqual([]);
  });

  it("restores lost keys on top of what another tab wrote, never over it", async () => {
    const t = await setup();
    await t.backup.apply("none");
    // another tab of this account saves a key this tab has not read yet
    const other = new KeysService(t.keys.owner, t.open);
    await other.ready();
    other.storage().setApiKey("https://other.test/", "sk-other");
    await other.flush();

    await t.backup.apply([
      entry("this-device", "https://lost.test/", "sk-lost"),
    ]);
    await t.keys.flush();

    const disk = new KeysService(t.keys.owner, t.open);
    await disk.ready();
    expect(
      disk
        .keys()
        .map((k) => k.key)
        .sort()
    ).toEqual(["sk-lost", "sk-other"]);
  });
});
