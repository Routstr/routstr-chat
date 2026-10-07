import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proof } from "@cashu/cashu-ts";
import { IDBFactory } from "fake-indexeddb";
import "@/tests/kit/idb";
import { IndexedCoins } from "@/platform/wallet/coins";

class MemoryStorage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key = (i: number) => [...this.data.keys()][i] ?? null;
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

const proof = (secret: string, amount = 8): Proof =>
  ({ id: "00ad268c4d1f5826", amount, secret, C: "02aa" }) as Proof;

const saved = (state: object) => JSON.stringify({ state, version: 0 });

let storage: MemoryStorage;
const load = async () => {
  vi.resetModules();
  vi.stubGlobal("window", { localStorage: storage });
  const { bindOwner } = await import("../owner");
  const { owned } = await import("@/features/session/owned");
  const bind = (pubkey: string | null) => bindOwner(pubkey, storage);
  return { bind, owned };
};
const stored = (key: string) =>
  JSON.parse(storage.getItem(key) ?? "null")?.state;

beforeEach(() => {
  storage = new MemoryStorage();
});

describe("per-person local stores", () => {
  it("give the shared copy from before accounts had owners to the first account", async () => {
    const legacy = {
      cashu: saved({ proofs: [{ ...proof("a"), eventId: "e1" }], mints: [] }),
      "cashu-history": saved({
        history: [{ amount: 8 }],
        pendingTransactions: [],
      }),
      "cashu-unclaimed-tokens": saved({ unclaimedTokens: [{ id: "u1" }] }),
      lightning_invoices: JSON.stringify({ invoices: [{ id: "i1" }] }),
      local_cashu_tokens: JSON.stringify([
        { baseUrl: "https://p/", token: "t" },
      ]),
      transaction_history: JSON.stringify([{ amount: 8 }]),
      api_keys: JSON.stringify([{ key: "sk-exported", balance: 5 }]),
      sats_spent_by_event: JSON.stringify({ e1: 8 }),
      pending_send_proofs_1700000000000: JSON.stringify({ tokenAmount: 8 }),
    };
    Object.entries(legacy).forEach(([k, v]) => storage.setItem(k, v));
    const m = await load();

    m.bind("alice");

    expect(Object.fromEntries(storage.data)).toEqual({
      "cashu:alice": legacy.cashu,
      "cashu-history:alice": legacy["cashu-history"],
      "cashu-unclaimed-tokens:alice": legacy["cashu-unclaimed-tokens"],
      "lightning_invoices:alice": legacy.lightning_invoices,
      "local_cashu_tokens:alice": legacy.local_cashu_tokens,
      "transaction_history:alice": legacy.transaction_history,
      "api_keys:alice": legacy.api_keys,
      "sats_spent_by_event:alice": legacy.sats_spent_by_event,
      "pending_send_proofs:alice_1700000000000":
        legacy.pending_send_proofs_1700000000000,
    });
    expect(m.owned("lightning_invoices")).toBe("lightning_invoices:alice");
  });

  it("leave each account's coins in the coin store under it, whoever is active", async () => {
    globalThis.indexedDB = new IDBFactory();
    const coins = IndexedCoins.open(async () => "sat");
    await coins.change("alice", "https://m", [proof("a")], []);
    const m = await load();

    m.bind("alice");
    m.bind("bob");
    await coins.change("bob", "https://m", [proof("b")], []);

    const secrets = async (owner: string) =>
      (await coins.coins(owner)).map((c) => c.secret);
    expect(await secrets("alice")).toEqual(["a"]);
    expect(await secrets("bob")).toEqual(["b"]);
  });

  it("keep a signed-out account's old coin list for its next sign-in, and never give it to the next key", async () => {
    const alices = saved({ proofs: [{ ...proof("a"), eventId: "e1" }] });
    storage.setItem("cashu:alice", alices);
    storage.setItem("pending_send_proofs:alice_1", "{}");
    const m = await load();
    m.bind("alice");

    // the last account signs out, then a new key is made on this device
    m.bind(null);
    m.bind("carol");
    expect(storage.getItem("cashu:carol")).toBeNull();

    m.bind("alice");
    expect(storage.getItem("cashu:alice")).toBe(alices);
    expect(storage.getItem("pending_send_proofs:alice_1")).toBe("{}");
  });

  it("never overwrite an account's copy, and keep the old one when a copy fails", async () => {
    storage.setItem(
      "cashu",
      saved({ proofs: [{ ...proof("old"), eventId: "e0" }] })
    );
    storage.setItem(
      "cashu:alice",
      saved({ proofs: [{ ...proof("a"), eventId: "e1" }] })
    );
    storage.setItem("cashu-history", saved({ history: [{ amount: 1 }] }));
    const m = await load();
    const set = storage.setItem;
    storage.setItem = (k, v) => {
      if (k === "cashu-history:alice") throw new Error("QuotaExceededError");
      set(k, v);
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    m.bind("alice");

    expect(stored("cashu:alice").proofs.map((p: Proof) => p.secret)).toEqual([
      "a",
    ]);
    expect(storage.getItem("cashu")).not.toBeNull();
    expect(storage.getItem("cashu-history")).not.toBeNull();
  });
});
