import { getEncodedTokenV4 } from "@cashu/cashu-ts";
import { beforeEach, describe, expect, it } from "vitest";
import { Journal, memoryStorage, PREFIX, storedKeys } from "../journal";
import { adoptLegacy } from "../legacy";
import type { BookRecord } from "../records";

const proof = (secret: string, amount: number) => ({
  id: "00ad268c4d1f5826",
  amount,
  secret,
  C: "02",
});
const mintUrl = "https://mint.example.com";
const melt = {
  v: 1,
  kind: "melt",
  id: "m1",
  mintUrl,
  keysetId: "00ad268c4d1f5826",
  createdAt: 1,
  quoteId: "q1",
  inputs: [proof("s1", 8)],
  blanks: [],
};
const backup = (secret: string, amount: number) =>
  JSON.stringify({
    mintUrl,
    proofsToSend: [proof(secret, amount)],
    timestamp: 5,
  });
const oldToken = (id: string, amount: number) => ({
  id,
  token: `cashuB${id}`,
  amount,
  unit: "sat",
  mintUrl,
  createdAt: 7,
});
// what the records hold, in sats, whatever their kind
const sats = (records: BookRecord[]) =>
  records.reduce((sum, r) => {
    if (r.kind === "token" || r.kind === "receive") return sum + r.amount;
    if (r.kind === "mint" || r.kind === "quote") return sum;
    const proofs = r.kind === "melt" || r.kind === "swap" ? r.inputs : r.proofs;
    return sum + proofs.reduce((s, p) => s + p.amount, 0);
  }, 0);

let storage: ReturnType<typeof memoryStorage>;
let journal: Journal;

beforeEach(() => {
  storage = memoryStorage();
  journal = new Journal(storage);
});

describe("adoptLegacy", () => {
  it("gives an account everything main left under its name, sats for sats", () => {
    storage.setItem("cashu_op_m1", JSON.stringify(melt)); // main's live entry, no owner
    storage.setItem("cashu_op:alice_m2", JSON.stringify({ ...melt, id: "m2" })); // coin shelf
    storage.setItem("pending_send_proofs:alice_10", backup("s3", 2));
    storage.setItem("pending_receive_proofs:alice_11", backup("s4", 4));
    storage.setItem(
      "cashu-unclaimed-tokens:alice",
      JSON.stringify({
        state: { unclaimedTokens: [oldToken("t1", 21)] },
        version: 0,
      })
    );

    adoptLegacy("alice", storage, journal, true);

    const alices = journal.list("alice");
    expect(alices.map((r) => r.kind).sort()).toEqual([
      "landed",
      "landed",
      "melt",
      "melt",
      "token",
    ]);
    expect(sats(alices)).toBe(8 + 8 + 2 + 4 + 21);
    // main removed a send's backup before handing the token out: a backup left
    // is coins that never left, stored by recovery like a receive's
    expect(alices.find((r) => r.id.includes("send"))?.kind).toBe("landed");
    // all of it now under the book's own names, none left where main looks
    expect(storedKeys(storage).every((k) => k.startsWith(PREFIX))).toBe(true);
  });

  it("leaves a main tab's payment alone while it may still be in flight", () => {
    const now = JSON.stringify({ ...melt, id: "m3", createdAt: Date.now() });
    storage.setItem("cashu_op_m3", now);

    adoptLegacy("alice", storage, journal, true);

    expect(journal.list("alice")).toEqual([]);
    expect(storage.getItem("cashu_op_m3")).toBe(now);
  });

  it("takes main's live entries only for main's account", () => {
    storage.setItem("cashu_op_m1", JSON.stringify(melt));

    adoptLegacy("bob", storage, journal, false);
    expect(journal.list("bob")).toEqual([]);

    adoptLegacy("alice", storage, journal, true);
    expect(journal.list("alice").map((r) => r.id)).toEqual(["m1"]);
    expect(storage.getItem("cashu_op_m1")).toBeNull();
  });

  it("leaves another account's shelf and backups where they are", () => {
    storage.setItem("cashu_op:bob_m2", JSON.stringify({ ...melt, id: "m2" }));
    storage.setItem("pending_send_proofs:bob_10", backup("s3", 2));
    storage.setItem(
      "cashu-unclaimed-tokens:bob",
      JSON.stringify({ state: { unclaimedTokens: [oldToken("t1", 21)] } })
    );

    adoptLegacy("alice", storage, journal, true);

    expect(journal.list("alice")).toEqual([]);
    expect(storage.length).toBe(3);
    adoptLegacy("bob", storage, journal, true);
    expect(sats(journal.list("bob"))).toBe(8 + 2 + 21);
  });

  it("writes the same records again when a cut-short run is repeated", () => {
    storage.setItem("pending_receive_proofs:alice_10", backup("s3", 2));
    const copy = storage.getItem("pending_receive_proofs:alice_10")!;
    adoptLegacy("alice", storage, journal, true);
    // the old key came back, as if the tab closed before it was removed
    storage.setItem("pending_receive_proofs:alice_10", copy);
    adoptLegacy("alice", storage, journal, true);

    expect(journal.list("alice")).toHaveLength(1);
  });

  it("keeps the old key when the new record cannot be written", () => {
    storage.setItem("pending_receive_proofs:alice_10", backup("s3", 2));
    const setItem = storage.setItem;
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => adoptLegacy("alice", storage, journal, true)).toThrow("Quota");
    storage.setItem = setItem;

    expect(storage.getItem("pending_receive_proofs:alice_10")).not.toBeNull();
  });

  it("leaves an unreadable key in place and adopts the rest", () => {
    storage.setItem("pending_receive_proofs:alice_9", "{not json");
    storage.setItem("pending_receive_proofs:alice_10", backup("s3", 2));

    adoptLegacy("alice", storage, journal, true);

    expect(storage.getItem("pending_receive_proofs:alice_9")).toBe("{not json");
    expect(journal.list("alice")).toHaveLength(1);
  });

  it("turns main's paid, unclaimed invoice into a quote record once, and leaves the list", () => {
    const invoice = (quoteId: string, type: string, state: string) => ({
      id: `i-${quoteId}`,
      type,
      state,
      quoteId,
      mintUrl: `${mintUrl}/`,
      amount: 21,
      createdAt: 3,
    });
    const list = JSON.stringify({
      invoices: [
        invoice("paid", "mint", "PAID"),
        invoice("unpaid", "mint", "UNPAID"),
        invoice("issued", "mint", "ISSUED"),
        invoice("melt", "melt", "PAID"),
      ],
    });
    storage.setItem("lightning_invoices:alice", list);

    adoptLegacy("alice", storage, journal, true);
    expect(journal.list("alice")).toEqual([
      {
        v: 1,
        kind: "quote",
        id: "legacy-quote-paid",
        owner: "alice",
        mintUrl,
        createdAt: 3,
        quoteId: "paid",
        amount: 21,
      },
    ]);
    expect(storage.getItem("lightning_invoices:alice")).toBe(list);

    // recovery claimed it; the next sign-in does not write it again
    journal.remove("legacy-quote-paid");
    adoptLegacy("alice", storage, journal, true);
    expect(journal.list("alice")).toEqual([]);
    // nor does another account take it
    adoptLegacy("bob", storage, journal, true);
    expect(journal.list("bob")).toEqual([]);
  });

  it("lists the tokens main kept for providers as tokens the person made, to take back", () => {
    const token = getEncodedTokenV4({
      mint: `${mintUrl}/`,
      unit: "sat",
      proofs: [proof("s9", 8)],
    });
    storage.setItem(
      "local_cashu_tokens:alice",
      JSON.stringify([{ baseUrl: "https://p/", token }])
    );

    adoptLegacy("alice", storage, journal, true);
    expect(journal.list("alice")).toEqual([
      {
        v: 1,
        kind: "token",
        id: "legacy-local_cashu_tokens:alice-0",
        owner: "alice",
        mintUrl,
        unit: "sat",
        createdAt: 0,
        token,
        amount: 8,
        baseUrl: "https://p/",
      },
    ]);
    // no longer counted as pending beside it
    expect(storage.getItem("local_cashu_tokens:alice")).toBeNull();
  });
});
