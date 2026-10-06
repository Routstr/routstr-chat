import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proof } from "@cashu/cashu-ts";

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
  const { useCashuStore } = await import("@/features/wallet/state/cashuStore");
  const { owned } = await import("@/features/session/owned");
  const bind = (pubkey: string | null) => bindOwner(pubkey, storage);
  const secrets = () => useCashuStore.getState().proofs.map((p) => p.secret);
  return {
    bind,
    useCashuStore,
    owned,
    secrets,
  };
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
    expect(m.secrets()).toEqual(["a"]);
    expect(m.owned("lightning_invoices")).toBe("lightning_invoices:alice");
  });

  it("show only the active account's coins, and work begun for one settles there after a switch", async () => {
    storage.setItem(
      "cashu:alice",
      saved({ proofs: [{ ...proof("a"), eventId: "e1" }] })
    );
    const m = await load();
    m.bind("alice");
    const begunForAlice = m.useCashuStore.getState();

    m.bind("bob");
    expect(m.secrets()).toEqual([]);
    m.useCashuStore.getState().addProofs([proof("b")], "e2");
    begunForAlice.addProofs([proof("late")], "e3");

    expect(m.secrets()).toEqual(["b"]);
    m.bind("alice");
    expect(m.secrets()).toEqual(["a", "late"]);
    expect(stored("cashu:bob").proofs.map((p: Proof) => p.secret)).toEqual([
      "b",
    ]);
  });

  it("let a first key take over what was begun before it existed", async () => {
    const m = await load();
    const asGuest = m.useCashuStore.getState();
    asGuest.addMint("https://mint.test");

    m.bind("carol");
    asGuest.setActiveMintUrl("https://mint.test");

    expect(m.useCashuStore.getState().activeMintUrl).toBe("https://mint.test");
    expect(stored("cashu:carol").activeMintUrl).toBe("https://mint.test");
    expect(storage.getItem("cashu")).toBeNull();
  });

  it("keep an account's own copy when it signs in over a guest", async () => {
    storage.setItem(
      "cashu:carol",
      saved({ proofs: [{ ...proof("c"), eventId: "e1" }] })
    );
    const m = await load();
    m.useCashuStore.getState().addMint("https://guest.test");

    m.bind("carol");

    expect(m.secrets()).toEqual(["c"]);
    expect(m.useCashuStore.getState().mints).toEqual([]);
    expect(stored("cashu").mints).toEqual([{ url: "https://guest.test" }]);
  });

  it("keep a signed-out account's coins for its next sign-in, and never give them to the next key", async () => {
    storage.setItem(
      "cashu:alice",
      saved({ proofs: [{ ...proof("a"), eventId: "e1" }] })
    );
    storage.setItem("pending_send_proofs:alice_1", "{}");
    const m = await load();
    m.bind("alice");
    expect(m.secrets()).toEqual(["a"]);

    // the last account signs out, then a new key is made on this device
    m.bind(null);
    expect(m.secrets()).toEqual([]);
    m.bind("carol");
    expect(m.secrets()).toEqual([]);

    m.bind("alice");
    expect(m.secrets()).toEqual(["a"]);
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

    expect(m.secrets()).toEqual(["a"]);
    expect(storage.getItem("cashu")).not.toBeNull();
    expect(storage.getItem("cashu-history")).not.toBeNull();
  });
});
