import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  // sign out wipes the browser's localStorage, where coins still settling live
  const memory = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size;
    },
    clear: () => memory.clear(),
  };
  Object.assign(globalThis, { localStorage, window: { localStorage } });
  return { memory, removeAccount: vi.fn() };
});

vi.mock("react", () => ({
  useState: () => [false, vi.fn()],
  useEffect: () => undefined,
  useCallback: (fn: unknown) => fn,
}));
vi.mock("applesauce-react/hooks", () => ({ useObservableState: () => [] }));
vi.mock("@/components/ClientProviders", () => ({
  useAccountManager: () => ({
    manager: {
      active$: { value: { pubkey: "alice" } },
      removeAccount: state.removeAccount,
    },
  }),
}));

import { useAuthState } from "@/hooks/useAuthState";
import { listEntries, putEntry, type MeltEntry } from "@/lib/meltJournal";
import { unshelve } from "@/lib/coinShelf";

const entry: MeltEntry = {
  v: 1,
  kind: "melt",
  id: "e1",
  mintUrl: "https://mint.example.com",
  keysetId: "00ad268c4d1f5826",
  createdAt: 0,
  quoteId: "quote-1",
  inputs: [{ id: "00ad268c4d1f5826", amount: 8, secret: "s1", C: "02" }],
  blanks: [],
};
const sendBackup = JSON.stringify({
  mintUrl: entry.mintUrl,
  proofsToSend: entry.inputs,
});

beforeEach(() => {
  state.memory.clear();
  state.removeAccount.mockClear();
  putEntry(entry);
  localStorage.setItem("pending_send_proofs_1", sendBackup);
  localStorage.setItem("pending_receive_proofs_2", sendBackup);
  localStorage.setItem("lightning_invoices", "[]");
});

describe("sign out", () => {
  it("keeps the coins still settling for the account and wipes the rest", async () => {
    const journal = localStorage.getItem("cashu_op_e1");
    await useAuthState().logout();

    expect(state.removeAccount).toHaveBeenCalled();
    expect(localStorage.getItem("lightning_invoices")).toBeNull();
    // the wallet no longer sees them, but they are still on this device
    expect(listEntries()).toEqual([]);
    expect(localStorage.getItem("cashu_op:alice_e1")).toBe(journal);
    expect(localStorage.getItem("pending_send_proofs:alice_1")).toBe(
      sendBackup
    );
    expect(localStorage.getItem("pending_receive_proofs:alice_2")).toBe(
      sendBackup
    );
  });

  it("gives them back only when the same account signs in again", async () => {
    await useAuthState().logout();

    unshelve("bob");
    expect(listEntries()).toEqual([]);
    unshelve("alice");
    expect(listEntries().map((e) => e.inputs)).toEqual([entry.inputs]);
    expect(localStorage.getItem("pending_send_proofs_1")).toBe(sendBackup);
  });

  it("stops, still signed in, when the coins cannot be kept", async () => {
    const setItem = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => {
      if (k.includes(":alice_")) throw new Error("QuotaExceededError");
      setItem(k, v);
    };
    try {
      await expect(useAuthState().logout()).rejects.toThrow(
        "QuotaExceededError"
      );
    } finally {
      localStorage.setItem = setItem;
    }
    expect(listEntries()).toHaveLength(1);
    expect(state.removeAccount).not.toHaveBeenCalled();
  });
});
