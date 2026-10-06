import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BalanceManager,
  type StorageAdapter,
  type WalletAdapter,
} from "@routstr/sdk/wallet";
import {
  ExportedKeys,
  type ExportedKey,
  type Provider,
  type Purse,
} from "../exported";
import type { BackupPorts, Remote } from "../relayBackup";
import type { Saved } from "@/features/session/saved";

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

const purse = (token = "cashuBfixture") => {
  const calls: string[] = [];
  const p: Purse = {
    activeMint: () => "https://mint.test",
    async send(mint, sats, handoff) {
      calls.push(`send ${mint} ${sats}`);
      await handoff(token);
      return token;
    },
    async receive(t) {
      calls.push(`receive ${t}`);
    },
  };
  return { p, calls };
};

const balance = (amount: number, more: object = {}) => ({
  amount,
  reserved: 0,
  unit: "msat" as const,
  apiKey: "sk-made",
  ...more,
});

// the IndexedDB copy of the list, empty to start with
const kept = (): Saved => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k),
    put: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
};

const provider = (over: Partial<Provider> = {}): Provider => ({
  getTokenBalance: async () => balance(21000),
  fetchRefundToken: async () => ({ success: true, token: "cashuBrefund" }),
  ...over,
});

const key = (k: Partial<ExportedKey> = {}): ExportedKey => ({
  key: "sk-1",
  balance: 1000,
  label: "laptop",
  baseUrl: "https://p.test/",
  ...k,
});

afterEach(() => vi.unstubAllGlobals());

// one replaceable copy on the relays; every publish reaches every device
const relay = () => {
  let copy: ExportedKey[] | "none" = "none";
  let publishes = 0;
  const watchers = new Set<(remote: Remote<ExportedKey[]>) => void>();
  const ports: BackupPorts<ExportedKey[]> = {
    watch: (listener) => {
      watchers.add(listener);
      setTimeout(() => listener(structuredClone(copy)), 0);
      return () => watchers.delete(listener);
    },
    publish: async (keys) => {
      publishes++;
      copy = structuredClone(keys);
      setTimeout(() => watchers.forEach((w) => w(structuredClone(copy))), 0);
    },
  };
  return { ports, publishes: () => publishes, copy: () => copy };
};

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("ExportedKeys", () => {
  it("makes a key from the wallet and has it on disk before the token is let go", async () => {
    const storage = memory();
    let onDisk: string | undefined;
    const keys = new ExportedKeys(
      "alice",
      storage,
      provider({
        getTokenBalance: async (token, baseUrl) => {
          expect([token, baseUrl]).toEqual([
            "cashuBfixture",
            "https://p.test/",
          ]);
          return balance(21000);
        },
      }),
      kept()
    );
    const { p, calls } = purse();
    const send = p.send;
    p.send = async (mint, sats, handoff) =>
      send(mint, sats, async (t) => {
        await handoff(t);
        onDisk = storage.data.get("api_keys:alice");
      });

    await keys.create(p, "https://p.test", 21, "laptop");

    expect(calls).toEqual(["send https://mint.test 21"]);
    expect(JSON.parse(onDisk!)).toEqual([
      {
        key: "sk-made",
        balance: 21000,
        label: "laptop",
        baseUrl: "https://p.test/",
      },
    ]);
  });

  it("keeps nothing and fails the send when the provider makes no key", async () => {
    const storage = memory();
    const keys = new ExportedKeys(
      "alice",
      storage,
      provider({
        getTokenBalance: async () =>
          balance(0, { apiKey: "", balanceUnknown: true }),
      }),
      kept()
    );
    await expect(
      keys.create(purse().p, "https://p.test/", 21, "x")
    ).rejects.toThrow();
    expect(keys.list()).toEqual([]);
  });

  it("tops up with the token in the request body, never in the address", async () => {
    const storage = memory();
    storage.setItem("api_keys:alice", JSON.stringify([key()]));
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const keys = new ExportedKeys(
      "alice",
      storage,
      provider({
        getTokenBalance: async () => balance(5000, { apiKey: "sk-1" }),
      }),
      kept()
    );

    await keys.topUp(purse("cashuBtopup").p, key(), 4);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://p.test/v1/wallet/topup");
    expect(url).not.toContain("cashu");
    expect(JSON.parse(init.body as string)).toEqual({
      cashu_token: "cashuBtopup",
    });
    expect(keys.list()[0].balance).toBe(5000);
  });

  it("removes a key with credit only after the refund is in the wallet", async () => {
    const storage = memory();
    storage.setItem("api_keys:alice", JSON.stringify([key()]));
    const keys = new ExportedKeys("alice", storage, provider(), kept());
    const failing = purse();
    failing.p.receive = async () => {
      throw new Error("mint down");
    };
    await expect(keys.remove(failing.p, key())).rejects.toThrow("mint down");
    expect(keys.list()).toHaveLength(1);
    await expect(keys.remove(null, key())).rejects.toThrow();
    expect(keys.list()).toHaveLength(1);

    const ok = purse();
    await keys.remove(ok.p, key());
    expect(ok.calls).toEqual(["receive cashuBrefund"]);
    expect(keys.list()).toEqual([]);
  });

  it("lets the provider decide a removal: an unknown or empty key goes, a busy or unreachable one stays", async () => {
    const answers: Record<string, object> = {
      "sk-gone": { success: false, keyNotFound: true },
      "sk-empty": { success: false, noBalance: true },
      "sk-busy": { success: false, error: "ongoing requests" },
      "sk-far": { success: false, error: "Request timed out" },
    };
    const storage = memory();
    // a flag main once set on a network error says nothing: the provider is asked
    const listed = Object.keys(answers).map((k) =>
      key({ key: k, balance: 0, isInvalid: true })
    );
    storage.setItem("api_keys:alice", JSON.stringify(listed));
    const keys = new ExportedKeys(
      "alice",
      storage,
      provider({
        fetchRefundToken: async (_url, k) => answers[k] as { success: boolean },
      }),
      kept()
    );

    for (const k of listed) await keys.remove(purse().p, k).catch(() => {});

    expect(keys.list().map((k) => k.key)).toEqual(["sk-busy", "sk-far"]);
  });

  it("asks again with the same token when the provider's answer to a new key was lost", async () => {
    const storage = memory();
    const answers = [
      balance(0, { apiKey: "", balanceUnknown: true }),
      balance(21000, { apiKey: "sk-made" }),
    ];
    const asked: string[] = [];
    const keys = new ExportedKeys(
      "alice",
      storage,
      provider({
        getTokenBalance: async (token) => (asked.push(token), answers.shift()!),
      }),
      kept()
    );

    await keys.create(purse().p, "https://p.test/", 21, "laptop");

    expect(asked).toEqual(["cashuBfixture", "cashuBfixture"]);
    expect(keys.list().map((k) => k.key)).toEqual(["sk-made"]);
  });

  it("fails a top-up the provider refused, so its token stays in the wallet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 400 }))
    );
    const keys = new ExportedKeys("alice", memory(), provider(), kept());
    await expect(keys.topUp(purse().p, key(), 4)).rejects.toThrow("400");
  });

  it("never drops a key another tab made, even from a stale list", async () => {
    const storage = memory();
    storage.setItem("api_keys:alice", JSON.stringify([key({ key: "sk-old" })]));
    const tabA = new ExportedKeys("alice", storage, provider(), kept());
    const tabB = new ExportedKeys("alice", storage, provider(), kept());

    await tabA.create(purse().p, "https://p.test/", 21, "new");
    tabB.forget("sk-old");

    expect(
      JSON.parse(storage.data.get("api_keys:alice")!).map(
        (k: ExportedKey) => k.key
      )
    ).toEqual(["sk-made"]);
  });

  it("backs up on the relays: never before they answered, merges other devices' keys, skips removed ones", async () => {
    const storage = memory();
    storage.setItem(
      "api_keys:alice",
      JSON.stringify([key({ key: "sk-here" })])
    );
    const keys = new ExportedKeys("alice", storage, provider(), kept());
    const published: ExportedKey[][] = [];
    let push: (r: Remote<ExportedKey[]>) => void = () => {};
    keys.start({
      watch: (l) => ((push = l), () => {}),
      publish: async (v) => void published.push(v),
    });
    const tick = () => new Promise((r) => setTimeout(r, 0));

    keys.forget("sk-gone");
    await tick();
    expect(published).toEqual([]);
    push("unreadable");
    await tick();
    expect(published).toEqual([]);

    push([key({ key: "sk-there" }), key({ key: "sk-gone" })]);
    await tick();
    expect(keys.list().map((k) => k.key)).toEqual(["sk-here", "sk-there"]);
    expect(published.at(-1)!.map((k) => k.key)).toEqual([
      "sk-here",
      "sk-there",
    ]);
  });

  it("two devices settle on one copy, whatever their order and balances, and after a removal one of them keeps", async () => {
    const r = relay();
    const disk = (keys: ExportedKey[]) => {
      const storage = memory();
      storage.setItem("api_keys:alice", JSON.stringify(keys));
      return storage;
    };
    const a = new ExportedKeys(
      "alice",
      disk([key({ key: "sk-1", balance: 1 }), key({ key: "sk-2" })]),
      provider(),
      kept()
    );
    const b = new ExportedKeys(
      "alice",
      disk([key({ key: "sk-2", balance: 5 }), key({ key: "sk-1" })]),
      provider(),
      kept()
    );
    a.start(r.ports);
    b.start(r.ports);
    await settle();
    const first = r.publishes();
    await settle();
    expect(r.publishes()).toBe(first);
    expect(first).toBeLessThanOrEqual(2);

    a.forget("sk-1");
    await settle();
    const after = r.publishes();
    await settle();
    expect(r.publishes()).toBe(after);
    expect(a.list().map((k) => k.key)).toEqual(["sk-2"]);
    expect(
      b
        .list()
        .map((k) => k.key)
        .sort()
    ).toEqual(["sk-1", "sk-2"]);
  });

  it("publishes nothing over a copy it cannot read, nor before a new start has heard back", async () => {
    const storage = memory();
    storage.setItem(
      "api_keys:alice",
      JSON.stringify([key({ key: "sk-1" }), key({ key: "sk-2" })])
    );
    const keys = new ExportedKeys("alice", storage, provider(), kept());
    const published: ExportedKey[][] = [];
    let push: (r: Remote<ExportedKey[]>) => void = () => {};
    const ports: BackupPorts<ExportedKey[]> = {
      watch: (l) => ((push = l), () => {}),
      publish: async (v) => void published.push(v),
    };
    const tick = () => new Promise((r) => setTimeout(r, 0));

    const stop = keys.start(ports);
    push([key({ key: "sk-1" }), key({ key: "sk-2" })]);
    push("unreadable");
    keys.forget("sk-1");
    await tick();
    expect(published).toEqual([]);

    push([key({ key: "sk-2" })]);
    stop();
    keys.start(ports);
    keys.forget("sk-2");
    await tick();
    expect(published).toEqual([]);
  });

  it("never takes keys off the relays because this browser's list lost them", async () => {
    const r = relay();
    const storage = memory();
    storage.setItem(
      "api_keys:alice",
      JSON.stringify([key({ key: "sk-1" }), key({ key: "sk-2" })])
    );
    const keys = new ExportedKeys("alice", storage, provider(), kept());
    keys.start(r.ports);
    await settle();

    // a main tab's sign-out wiped localStorage, then a key is made here
    storage.data.clear();
    await keys.create(purse().p, "https://p.test/", 21, "new");
    await settle();

    const copy = r.copy() as ExportedKey[];
    expect(copy.map((k) => k.key).sort()).toEqual(["sk-1", "sk-2", "sk-made"]);
  });

  it("keeps the list through a main tab's sign-out, with the app open or closed", async () => {
    const storage = memory();
    const saved = kept();
    const two = [key({ key: "sk-1" }), key({ key: "sk-2" })];
    storage.setItem("api_keys:alice", JSON.stringify(two));
    const keys = new ExportedKeys("alice", storage, provider(), saved);
    await settle();
    const listed = () =>
      JSON.parse(storage.data.get("api_keys:alice") ?? "[]").map(
        (k: ExportedKey) => k.key
      );

    // open: main clears localStorage, this tab writes the list back
    storage.data.clear();
    keys.repair();
    expect(listed()).toEqual(["sk-1", "sk-2"]);

    // closed: cleared again, the next start reads the IndexedDB copy
    storage.data.clear();
    const next = new ExportedKeys("alice", storage, provider(), saved);
    await settle();
    expect(next.list().map((k) => k.key)).toEqual(["sk-1", "sk-2"]);
    expect(listed()).toEqual(["sk-1", "sk-2"]);
  });

  it("never writes the IndexedDB copy before it was read", async () => {
    const storage = memory();
    const saved = kept();
    await saved.put("api_keys:alice", JSON.stringify([key({ key: "sk-1" })]));
    let read: () => void = () => {};
    const gate = new Promise<void>((r) => (read = r));
    const slow: Saved = {
      ...saved,
      get: async (k) => (await gate, saved.get(k)),
    };

    // localStorage was wiped while the app was closed; a key is forgotten
    // before the IndexedDB copy came in
    const keys = new ExportedKeys("alice", storage, provider(), slow);
    keys.forget("sk-other");
    read();
    await settle();

    expect(keys.list().map((k) => k.key)).toEqual(["sk-1"]);
  });
});

// Ported from GitHub #215 (Abdou). A provider with routstr-core #779 answers a
// key it does not know with key_not_found, in detail.error, in the top-level
// error, or in both; the SDK reads all three.
describe("a new key when storage fails", () => {
  const full = () => {
    throw new DOMException("full", "QuotaExceededError");
  };
  const ids = async (saved: Saved) =>
    JSON.parse((await saved.get("api_keys:alice")) ?? "[]").map(
      (k: ExportedKey) => k.key
    );

  it("is in IndexedDB before its token is let go, when localStorage is full", async () => {
    const storage = memory();
    const saved = kept();
    const keys = new ExportedKeys("alice", storage, provider(), saved);
    await settle();
    storage.setItem = full;
    // IndexedDB is slow to write; what it holds when the handoff ends is what counts
    const put = saved.put;
    saved.put = async (k, v) => {
      await new Promise((r) => setTimeout(r, 20));
      return put(k, v);
    };
    const { p, calls } = purse();
    const send = p.send;
    let atHandoff: string[] = [];
    p.send = async (mint, sats, handoff) =>
      send(mint, sats, async (t) => {
        await handoff(t);
        atHandoff = await ids(saved);
      });

    await keys.create(p, "https://p.test/", 21, "laptop");

    expect(calls).toEqual(["send https://mint.test 21"]);
    expect(atHandoff).toEqual(["sk-made"]);
    const next = new ExportedKeys("alice", storage, provider(), saved);
    await settle();
    expect(next.list().map((k) => k.key)).toEqual(["sk-made"]);
  });

  it("survives the IndexedDB copy being read after it was made", async () => {
    const storage = memory();
    const saved = kept();
    await saved.put("api_keys:alice", JSON.stringify([key({ key: "sk-1" })]));
    // the first read is answered at once but arrives late, as IndexedDB does
    let read: () => void = () => {};
    const gate = new Promise<void>((r) => (read = r));
    let first = true;
    const late: Saved = {
      ...saved,
      get: async (k) => {
        const v = await saved.get(k);
        if (first) {
          first = false;
          await gate;
        }
        return v;
      },
    };
    const keys = new ExportedKeys("alice", storage, provider(), late);
    storage.setItem = full;

    await keys.create(purse().p, "https://p.test/", 21, "laptop");
    read();
    await settle();

    expect(keys.list().map((k) => k.key)).toEqual(["sk-1", "sk-made"]);
    expect(await ids(saved)).toEqual(["sk-1", "sk-made"]);
  });

  it("never brings back a key removed here while it is saved", async () => {
    const storage = memory();
    const saved = kept();
    await saved.put("api_keys:alice", JSON.stringify([key({ key: "sk-old" })]));
    let read: () => void = () => {};
    const gate = new Promise<void>((r) => (read = r));
    // reads are answered at once but arrive late, as IndexedDB does: here
    // both the first read and the new key's read still see the removed key
    let reads = 0;
    const late: Saved = {
      ...saved,
      get: async (k) => {
        const v = await saved.get(k);
        if (++reads === 2) read();
        await gate;
        return v;
      },
    };
    const keys = new ExportedKeys("alice", storage, provider(), late);
    keys.forget("sk-old");
    storage.setItem = full;

    await keys.create(purse().p, "https://p.test/", 21, "laptop");
    await settle();

    expect(await ids(saved)).toEqual(["sk-made"]);
  });

  it("hands its token back only when neither store could keep it", async () => {
    const storage = memory();
    const saved = kept();
    const keys = new ExportedKeys("alice", storage, provider(), saved);
    await settle();
    storage.setItem = full;
    saved.put = async () => {
      throw new Error("disk full");
    };

    await expect(
      keys.create(purse().p, "https://p.test/", 21, "laptop")
    ).rejects.toThrow("disk full");
  });
});

describe("adopt: a token the wallet could not take back", () => {
  // the provider's answer to the token, as routstr-core gives it
  const answer = (status: number, body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status }))
    );
  const spent = {
    message: "Cashu token already spent",
    type: "token_already_spent",
    code: "cashu_token_already_spent",
  };

  it("stores the key the provider made from it for good, and says its sats", async () => {
    const storage = memory();
    const saved = kept();
    const keys = new ExportedKeys("alice", storage, provider(), saved);
    await settle();
    // localStorage full and IndexedDB slow: the key is in IndexedDB when adopt ends
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    const put = saved.put;
    saved.put = async (k, v) => {
      await new Promise((r) => setTimeout(r, 20));
      return put(k, v);
    };
    answer(200, { api_key: "sk-made", balance: 21000 });

    expect(await keys.adopt("cashuBspent", "https://p.test")).toBe(21);
    expect(keys.list()).toEqual([
      {
        key: "sk-made",
        balance: 21000,
        label: "Recovered",
        baseUrl: "https://p.test/",
      },
    ]);
    expect(JSON.parse((await saved.get("api_keys:alice"))!)).toHaveLength(1);
  });

  it("keeps a key it already lists, with its own label, at the new balance", async () => {
    const storage = memory();
    storage.setItem(
      "api_keys:alice",
      JSON.stringify([key({ key: "sk-made" })])
    );
    const keys = new ExportedKeys("alice", storage, provider(), kept());
    answer(200, { api_key: "sk-made", balance: 7000 });

    expect(await keys.adopt("cashuBspent", "https://p.test/")).toBe(7);
    expect(keys.list()).toEqual([key({ key: "sk-made", balance: 7000 })]);
  });

  it("says 0 only when the provider says the token was spent elsewhere", async () => {
    const keys = new ExportedKeys("alice", memory(), provider(), kept());
    answer(400, { detail: { error: spent }, error: spent });
    expect(await keys.adopt("cashuBspent", "https://p.test/")).toBe(0);
    expect(keys.list()).toEqual([]);

    // anything else: the token may still be the key's, so it is not gone
    answer(503, { detail: "upstream down" });
    await expect(keys.adopt("cashuBspent", "https://p.test/")).rejects.toThrow(
      "did not answer"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    await expect(
      keys.adopt("cashuBspent", "https://p.test/")
    ).rejects.toThrow();
  });
});

describe("refresh, as the SDK reads the provider's answer", () => {
  const notFound = {
    message:
      "Key not found. Deposit first via /v1/wallet/create to get a key on this node.",
    type: "invalid_request_error",
    code: "key_not_found",
  };
  const refreshed = async (status: number, body: unknown, was = key()) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status }))
    );
    const storage = memory();
    storage.setItem("api_keys:alice", JSON.stringify([was]));
    const sdk = new BalanceManager({} as WalletAdapter, {} as StorageAdapter);
    const keys = new ExportedKeys("alice", storage, sdk, kept());
    await keys.refresh(was);
    return keys.list()[0];
  };

  it.each([
    ["detail.error", { detail: { error: notFound } }],
    ["the top-level error", { error: notFound }],
    ["both", { detail: { error: notFound }, error: notFound }],
  ])(
    "marks a key the provider does not know invalid, from %s",
    async (_, body) => {
      expect(await refreshed(401, body)).toMatchObject({
        isInvalid: true,
        balance: 1000,
      });
    }
  );

  it.each([
    "insufficient_balance",
    "internal_server_error",
    "unauthorized",
    // an older provider's answer to any unknown key: the SDK trusts it only
    // for spent proofs, so the last balance stays
    "invalid_api_key",
  ])("keeps the last balance on %s", async (code) => {
    const error = { message: "Refused", type: "invalid_request_error", code };
    for (const body of [{ error }, { detail: { error } }]) {
      expect((await refreshed(401, body)).isInvalid).toBeUndefined();
    }
  });

  it("keeps the last balance when the answer carries no code", async () => {
    for (const body of [{}, { error: {} }, { detail: { error: {} } }]) {
      expect((await refreshed(401, body)).isInvalid).toBeUndefined();
    }
  });

  it("never marks a funded key invalid, and clears an old mark", async () => {
    const answer = { api_key: "sk-1", balance: 7000, reserved: 0 };
    expect(await refreshed(200, answer)).toMatchObject({
      isInvalid: false,
      balance: 7000,
    });
    expect(
      await refreshed(200, answer, key({ isInvalid: true }))
    ).toMatchObject({ isInvalid: false, balance: 7000 });
  });
});
