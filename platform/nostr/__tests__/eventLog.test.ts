import { describe, expect, it } from "vitest";
import { openDB as openIdb } from "idb";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { getEventTags, openDB } from "nostr-idb";
import { freshIndexedDBPerTest } from "@/tests/kit/idb";
import { memoryStorage } from "@/features/relays/__tests__/fakes";
import { openEventLog } from "../eventLog";

freshIndexedDBPerTest();

const secret = generateSecretKey();
const author = getPublicKey(secret);
const event = (kind: number, at: number) =>
  finalizeEvent(
    { kind, created_at: at, tags: [], content: `${kind}@${at}` },
    secret
  );

const MIGRATED = "routstr:eventdb:migrated:v1";

async function writeLegacyBlob(events: ReturnType<typeof event>[]) {
  const db = await openIdb("zustand-event-store", 1, {
    upgrade: (d) => void d.createObjectStore("keyval"),
  });
  const state = { events: Object.fromEntries(events.map((e) => [e.id, e])) };
  await db.put("keyval", JSON.stringify({ state }), "nostr-event-store");
  db.close();
}

describe("event log", () => {
  it("keeps what it was given, by kind and author, until removed", async () => {
    const log = openEventLog(memoryStorage({ [MIGRATED]: "1" }));
    const [a, b, c] = [event(1080, 1), event(1080, 2), event(1081, 3)];
    await log.put([a, b, c]);

    expect(
      (await log.query({ kinds: [1080], authors: [author] }))
        .map((e) => e.id)
        .sort()
    ).toEqual([a.id, b.id].sort());

    await log.remove([a.id]);
    expect((await log.query({ kinds: [1080] })).map((e) => e.id)).toEqual([
      b.id,
    ]);
  });

  it("writes rows the way main's sidecar does, so main reads them and we read main's", async () => {
    const log = openEventLog(memoryStorage({ [MIGRATED]: "1" }));
    const ours = event(1080, 1);
    await log.put([ours]);
    const db = await openDB("routstr-event-store");
    expect(await db.get("events", ours.id)).toEqual({
      event: JSON.parse(JSON.stringify(ours)),
      tags: getEventTags(ours),
    });

    const mains = event(1080, 2);
    await db.put(
      "events",
      { event: mains, tags: getEventTags(mains) },
      mains.id
    );
    db.close();
    expect(await log.query({ ids: [mains.id] })).toHaveLength(1);
  });

  it("copies main's pre-July blob once, then leaves it", async () => {
    const old = [event(1081, 1), event(1080, 2)];
    await writeLegacyBlob(old);
    const storage = memoryStorage();

    const log = openEventLog(storage);
    expect((await log.query({ authors: [author] })).length).toBe(2);
    expect(storage.getItem(MIGRATED)).toBe("1");

    await log.remove(old.map((e) => e.id));
    expect(await openEventLog(storage).query({ authors: [author] })).toEqual(
      []
    );
  });

  it("tries the copy again on the next start when it failed", async () => {
    const db = await openIdb("zustand-event-store", 1, {
      upgrade: (d) => void d.createObjectStore("keyval"),
    });
    db.close();
    const storage = memoryStorage();
    const failing = {
      ...storage,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    await openEventLog(failing).query({ kinds: [1] });
    expect(storage.getItem(MIGRATED)).toBeNull();

    await openEventLog(storage).query({ kinds: [1] });
    expect(storage.getItem(MIGRATED)).toBe("1");
  });

  it("rejects every call when the database cannot open, instead of losing writes", async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new Error("blocked by the browser");
      },
    } as unknown as IDBFactory;
    const log = openEventLog(memoryStorage({ [MIGRATED]: "1" }));

    await expect(log.put([event(1080, 1)])).rejects.toThrow("blocked");
    await expect(log.query({ kinds: [1] })).rejects.toThrow("blocked");
  });
});
