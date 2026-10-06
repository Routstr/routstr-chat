import { afterEach, expect, it, vi } from "vitest";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { freshIndexedDBPerTest } from "@/tests/kit/idb";
import { openEventLog } from "@/platform/nostr/eventLog";

freshIndexedDBPerTest();
afterEach(() => vi.unstubAllGlobals());

const secret = generateSecretKey();
const event = (kind: number, tags: string[][] = []) =>
  finalizeEvent({ kind, created_at: 1_700_000_000, tags, content: "" }, secret);

it("keeps history's events out of the old store's memory when it hydrates", async () => {
  const storage = new Map([["routstr:eventdb:migrated:v1", "1"]]);
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  };
  const message = event(1080);
  const wallet = event(7375);
  const walletDelete = event(5, [["e", "0".repeat(64)], ["k", "7375"]]);
  // written the way history writes them, into the database both share
  await openEventLog(localStorage).put([
    event(1081),
    message,
    event(5, [["e", message.id], ["k", "1080"]]),
    wallet,
    walletDelete,
  ]);

  vi.stubGlobal("window", { localStorage });
  vi.resetModules();
  const { eventDatabaseReady, useEventDatabase } = await import("@/lib/eventDatabase");
  await eventDatabaseReady;

  expect(Object.keys(useEventDatabase.getState().events).sort()).toEqual([wallet.id, walletDelete.id].sort());
});
