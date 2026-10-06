import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { verifyEvent, type NostrEvent } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { derivePnsKeys, type PnsKeys } from "@/lib/pns";
import { freshIndexedDBPerTest } from "@/tests/kit/idb";
import { createFileStore } from "../files";

freshIndexedDBPerTest();

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const A = "https://a.example";
const B = "https://b.example";

/** Blossom servers in memory; a server can refuse uploads or never answer. */
function fakeBlossom() {
  const blobs = new Map<string, Uint8Array<ArrayBuffer>>();
  const uploads: Array<{
    server: string;
    auth: NostrEvent;
    body: Uint8Array<ArrayBuffer>;
  }> = [];
  const refusing = new Set<string>();
  const silent = new Set<string>();
  const fetch = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    if (silent.has(url.origin)) {
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        )
      );
    }
    if (init.method === "PUT") {
      if (refusing.has(url.origin)) return new Response("no", { status: 401 });
      const body = new Uint8Array(await new Response(init.body).arrayBuffer());
      const header = (init.headers as Record<string, string>).Authorization;
      const hash = bytesToHex(sha256(body));
      blobs.set(`${url.origin}/${hash}`, body);
      uploads.push({
        server: url.origin,
        auth: JSON.parse(atob(header.slice(6))),
        body,
      });
      return Response.json({ sha256: hash, url: `${url.origin}/${hash}` });
    }
    const body = blobs.get(`${url.origin}${url.pathname}`);
    return body ? new Response(body) : new Response("", { status: 404 });
  });
  return { fetch, uploads, refusing, silent, blobs };
}

let blossom: ReturnType<typeof fakeBlossom>;
let settings: Map<string, string>;
let keys: PnsKeys[];
const store = () =>
  createFileStore({
    keys: () => keys,
    settings: {
      getItem: (key) => settings.get(key) ?? null,
      setItem: (key, value) => void settings.set(key, value),
    },
  });
const signal = () => new AbortController().signal;

beforeEach(() => {
  blossom = fakeBlossom();
  vi.stubGlobal("fetch", blossom.fetch);
  settings = new Map([["blossomServers", JSON.stringify([A, B])]]);
  keys = [derivePnsKeys(randomBytes(32))];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("FileStore: this device", () => {
  it("keeps files in main's database, so main and v2 open each other's", async () => {
    settings.set("blossomSyncEnabled", "false");
    vi.resetModules();
    const main = await import("@/utils/indexedDb");

    const { storageId } = await store().store(PNG, signal());
    const fromMain = await main.getFile(storageId!);
    const mainId = await main.saveFile(
      new File([fromMain!], "x.png", { type: "image/png" })
    );

    expect(fromMain?.type).toBe("image/png");
    expect(await store().load({ storageId: mainId }, signal())).toBe(PNG);
    // main forgets files older than a week when it opens
    await main.clearOldFiles();
    expect(await main.getFile(storageId!)).toBeDefined();
  });

  it("reads the copy a screen recovered from Blossom under its new id", async () => {
    settings.set("blossomSyncEnabled", "false");
    const { storageId } = await store().store(PNG, signal());
    settings.set("storage_id_mapping", JSON.stringify({ lost: storageId }));

    expect(await store().load({ storageId: "lost" }, signal())).toBe(PNG);
  });

  it("keeps nothing it cannot read, and never fails a save over it", async () => {
    expect(await store().store("data:image/png;base64,%%%", signal())).toEqual(
      {}
    );
    expect(blossom.fetch).not.toHaveBeenCalled();
  });
});

describe("FileStore: what screens use", () => {
  it("keeps a file here at once and copies it to Blossom on its own", async () => {
    const files = store();
    const storageId = await files.keep(PNG);
    expect(blossom.uploads).toHaveLength(0);

    const copies = await files.copy(PNG, signal());

    expect(await files.load({ storageId: storageId! }, signal())).toBe(PNG);
    expect(copies).toEqual({
      blossomHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      blossomServers: [A, B],
    });
  });

  it("keeps a copy fetched from Blossom here, found next time under the message's id", async () => {
    const { blossomHash } = await store().copy(PNG, signal());
    const files = store();

    expect(
      await files.load({ storageId: "elsewhere", blossomHash }, signal())
    ).toBe(PNG);
    await vi.waitFor(() =>
      expect(
        JSON.parse(settings.get("storage_id_mapping") ?? "{}")
      ).toHaveProperty("elsewhere")
    );
    blossom.blobs.clear();
    expect(
      await files.load({ storageId: "elsewhere", blossomHash }, signal())
    ).toBe(PNG);
  });

  it("reads and changes the sync setting in main's keys, and says when it changed", async () => {
    vi.stubGlobal("window", new EventTarget());
    const files = store();
    const heard = vi.fn();
    files.subscribe(heard);
    expect(files.sync()).toEqual({ on: true, servers: [A, B] });

    files.setSync({ on: false });

    expect(settings.get("blossomSyncEnabled")).toBe("false");
    expect(files.sync()).toEqual({ on: false, servers: [A, B] });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(await files.copy(PNG, signal())).toEqual({});

    // another tab turned it back on
    settings.set("blossomSyncEnabled", "true");
    window.dispatchEvent(
      Object.assign(new Event("storage"), { key: "blossomSyncEnabled" })
    );
    expect(files.sync().on).toBe(true);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe("FileStore: Blossom", () => {
  it("uploads a copy only the account can open, which its other devices load", async () => {
    const kept = await store().store(PNG, signal());

    expect(kept).toEqual({
      storageId: expect.any(String),
      blossomHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      blossomServers: [A, B],
    });
    for (const { auth, body } of blossom.uploads) {
      expect(verifyEvent(auth)).toBe(true);
      expect(auth).toMatchObject({
        kind: 24242,
        pubkey: keys[0].pnsKeypair.pubKey,
      });
      expect(auth.tags).toContainEqual(["x", bytesToHex(sha256(body))]);
      expect(new TextDecoder().decode(body)).not.toContain("PNG");
    }
    // another device has no copy here
    const elsewhere = {
      blossomHash: kept.blossomHash,
      blossomServers: kept.blossomServers,
    };
    expect(await store().load(elsewhere, signal())).toBe(PNG);
    keys = [derivePnsKeys(randomBytes(32))];
    expect(await store().load(elsewhere, signal())).toBeUndefined();
  });

  it("writes with the account's writing key and opens with any of its keyrings", async () => {
    const [writing, other] = [keys[0], derivePnsKeys(randomBytes(32))];
    keys = [other];
    const { blossomHash: older, blossomServers } = await store().store(
      PNG,
      signal()
    );
    keys = [writing, other];
    const { blossomHash: newer } = await store().store(PNG, signal());
    const open = (blossomHash?: string) =>
      store().load({ blossomHash, blossomServers }, signal());

    expect(await open(older)).toBe(PNG);
    keys = [writing];
    expect(await open(newer)).toBe(PNG);
    expect(await open(older)).toBeUndefined();
  });

  it("tries the next server when one does not have the file", async () => {
    const { blossomHash } = await store().store(PNG, signal());
    blossom.blobs.delete(`${A}/${blossomHash}`);
    // this device lists other servers than the one that made the file
    settings.set("blossomServers", JSON.stringify(["https://c.example"]));

    expect(
      await store().load({ blossomHash, blossomServers: [A, B] }, signal())
    ).toBe(PNG);
  });

  it("names only the servers that took the upload", async () => {
    blossom.refusing.add(A);

    expect((await store().store(PNG, signal())).blossomServers).toEqual([B]);
  });

  it("uses no server while file sync is off or the account's history is locked", async () => {
    const away = { blossomHash: "a".repeat(64), blossomServers: [A] };
    settings.set("blossomSyncEnabled", "false");
    expect(await store().store(PNG, signal())).toEqual({
      storageId: expect.any(String),
    });
    expect(await store().load(away, signal())).toBeUndefined();

    settings.delete("blossomSyncEnabled");
    keys = [];
    expect(await store().store(PNG, signal())).toEqual({
      storageId: expect.any(String),
    });
    expect(await store().load(away, signal())).toBeUndefined();

    expect(blossom.fetch).not.toHaveBeenCalled();
  });

  it("settles at once when stopped while a server is slow", async () => {
    const { blossomHash } = await store().store(PNG, signal());
    blossom.silent.add(A);
    const stop = new AbortController();

    const loading = store().load(
      { blossomHash, blossomServers: [A, B] },
      stop.signal
    );
    await vi.waitFor(() => expect(blossom.fetch).toHaveBeenCalledTimes(3));
    stop.abort();

    expect(await loading).toBeUndefined();
    expect(blossom.fetch).toHaveBeenCalledTimes(3);
  });

  it("stops an upload at Stop, keeping the copy here", async () => {
    blossom.silent.add(A).add(B);
    const stop = new AbortController();

    const keeping = store().store(PNG, stop.signal);
    await vi.waitFor(() => expect(blossom.fetch).toHaveBeenCalledTimes(2));
    stop.abort();

    expect(await keeping).toEqual({ storageId: expect.any(String) });
  });

  it("uploads on browsers that have no AbortSignal.any", async () => {
    vi.stubGlobal("AbortSignal", { ...AbortSignal, any: undefined });

    expect(await store().store(PNG, signal())).toEqual({
      storageId: expect.any(String),
      blossomHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      blossomServers: [A, B],
    });
  });

  it("stops waiting for an upload that never answers, keeping the copy here", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    blossom.silent.add(A).add(B);

    const keeping = store().store(PNG, signal());
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await keeping).toEqual({ storageId: expect.any(String) });
  });

  it("lets the composer's own copy take as long as the upload takes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    blossom.silent.add(A).add(B);
    let done = false;

    void store()
      .copy(PNG, signal())
      .then(() => (done = true));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(done).toBe(false);
  });
});
