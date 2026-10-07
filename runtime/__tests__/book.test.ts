import { beforeEach, expect, it, vi } from "vitest";
import type { BookRecord } from "@/features/book/records";
import { memoryStorage, PREFIX } from "@/features/book/journal";

const proof = (secret: string, amount: number) => ({
  id: "00ad268c4d1f5826",
  amount,
  secret,
  C: "02",
});
const mintUrl = "https://mint.example.com";
const melt = (id: string, amount: number) =>
  JSON.stringify({
    v: 1,
    kind: "melt",
    id,
    mintUrl,
    keysetId: "00ad268c4d1f5826",
    createdAt: 1,
    quoteId: "q1",
    inputs: [proof(`m-${id}`, amount)],
    blanks: [],
  });
const backup = (secret: string, amount: number) =>
  JSON.stringify({
    mintUrl,
    proofsToSend: [proof(secret, amount)],
    timestamp: 5,
  });
const sats = (records: BookRecord[]) =>
  records.reduce((sum, r) => {
    if (r.kind === "token" || r.kind === "receive") return sum + r.amount;
    if (r.kind === "mint") return sum;
    const proofs = r.kind === "landed" ? r.proofs : r.inputs;
    return sum + proofs.reduce((s, p) => s + p.amount, 0);
  }, 0);

let storage: ReturnType<typeof memoryStorage>;
beforeEach(() => {
  storage = memoryStorage();
  vi.resetModules();
  vi.stubGlobal("window", { localStorage: storage, addEventListener: vi.fn() });
});

it("gives the account that opens v2 every coin main left for it, once", async () => {
  // main's live keys (the account signed in on main) and bob's shelf from his sign out
  storage.setItem("cashu_op_m1", melt("m1", 8));
  storage.setItem("pending_send_proofs_10", backup("s1", 2));
  storage.setItem("pending_receive_proofs_11", backup("s2", 4));
  storage.setItem(
    "cashu-unclaimed-tokens",
    JSON.stringify({
      state: {
        unclaimedTokens: [
          {
            id: "t1",
            token: "cashuBt1",
            amount: 21,
            unit: "sat",
            mintUrl,
            createdAt: 7,
          },
        ],
      },
      version: 0,
    })
  );
  storage.setItem("cashu_op:bob_m2", melt("m2", 16));
  storage.setItem("pending_receive_proofs:bob_12", backup("s3", 32));

  const { bindOwner } = await import("../owner");
  const { bindBook, journal } = await import("../book");
  // what the composition root does on every change of account
  const bind = (pubkey: string | null) => {
    bindOwner(pubkey, storage);
    bindBook(pubkey);
  };

  bind("alice");
  bind("alice");
  expect(sats(journal.list("alice"))).toBe(8 + 2 + 4 + 21);
  expect(journal.list("alice")).toHaveLength(4);
  expect(journal.list("bob")).toEqual([]);

  bind(null);
  bind("bob");
  expect(sats(journal.list("bob"))).toBe(16 + 32);
  expect(sats(journal.list("alice"))).toBe(8 + 2 + 4 + 21);
  // nothing old is left for anyone else to read
  const keys = Array.from(
    { length: storage.length },
    (_, i) => storage.key(i)!
  );
  // and the note of whose main's entries are
  expect(keys.filter((k) => !k.startsWith(PREFIX))).toEqual([
    "cashu_op:main-owner",
  ]);
});

/** a tab: the runtime as it is built at page load, over this device's storage */
async function tab() {
  vi.resetModules();
  const { bindOwner } = await import("../owner");
  const { bindBook, journal } = await import("../book");
  const { useUnclaimedTokensStore } =
    await import("@/features/wallet/state/unclaimedTokensStore");
  const bind = (pubkey: string | null) => {
    bindOwner(pubkey, storage);
    bindBook(pubkey);
  };
  const tokens = () =>
    useUnclaimedTokensStore.getState().unclaimedTokens.map((t) => t.id);
  return { bind, journal, tokens };
}

it("keeps main's own entries for main's account, across switches and restarts", async () => {
  storage.setItem("cashu_op_m1", melt("m1", 8));
  const first = await tab();
  first.bind("alice"); // the account main had signed in
  first.bind("bob");
  expect(first.journal.list("alice").map((r) => r.id)).toEqual(["m1"]);

  // main writes another entry, and v2 later starts as bob
  storage.setItem("cashu_op_m2", melt("m2", 16));
  const later = await tab();
  later.bind("bob");
  expect(later.journal.list("bob")).toEqual([]);
  later.bind("alice");
  expect(
    later.journal
      .list("alice")
      .map((r) => r.id)
      .sort()
  ).toEqual(["m1", "m2"]);
});

it("lists each account's own unclaimed tokens only", async () => {
  storage.setItem(
    "cashu-unclaimed-tokens:alice",
    JSON.stringify({
      state: {
        unclaimedTokens: [
          {
            id: "t1",
            token: "cashuBt1",
            amount: 21,
            unit: "sat",
            mintUrl,
            createdAt: 7,
          },
        ],
      },
    })
  );
  const { bind, tokens } = await tab();
  bind("alice");
  expect(tokens()).toEqual(["legacy-t1"]);
  bind("bob");
  expect(tokens()).toEqual([]);
  bind("alice");
  expect(tokens()).toEqual(["legacy-t1"]);
});
