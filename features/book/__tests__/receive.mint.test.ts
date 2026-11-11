// Receiving a token however it carries its keyset ids, from mints with the old-style ids and the
// new-style "01…" ids (nutshell 0.20, Minibits): what the token says, and what the mint itself
// then holds.
import {
  getEncodedToken,
  getEncodedTokenBinary,
  getTokenMetadata,
  type Proof,
} from "@cashu/cashu-ts";
import { describe, expect, it } from "vitest";
import { getKit } from "@/tests/kit";
import { WalletExecutor } from "../executor";
import { Journal, memoryStorage } from "../journal";

const kit = getKit();
const sum = (proofs: Proof[]) => proofs.reduce((s, p) => s + p.amount, 0);
const bare = (proofs: Proof[]) =>
  proofs.map(({ id, amount, secret, C }) => ({ id, amount, secret, C }));
const base64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64url");

// cashu-ts writes short ids into both formats; other wallets write the full ones
const styles: Record<string, (mint: string, proofs: Proof[]) => string> = {
  "cashuB, short ids": (mint, proofs) =>
    getEncodedToken({ mint, proofs, unit: "sat" }),
  "cashuB, full ids": (mint, proofs) =>
    "cashuB" +
    base64url(getEncodedTokenBinary({ mint, proofs, unit: "sat" }).slice(5)),
  "cashuA, short ids": (mint, proofs) =>
    getEncodedToken({ mint, proofs, unit: "sat" }, { version: 3 }),
  "cashuA, full ids": (mint, proofs) =>
    "cashuA" +
    base64url(
      new TextEncoder().encode(
        JSON.stringify({ token: [{ mint, proofs }], unit: "sat" })
      )
    ),
};

// the kit's main mint has old-style ids, or new-style ones under KIT_KEYSETS=v2;
// its second mint always has new-style ones
describe.each([
  ["the kit's main mint", () => kit.env.mintUrl],
  ["the kit's second mint", () => kit.env.invoiceMintUrl],
])("receiving from %s", (_, mintUrl) => {
  it.each(Object.keys(styles))("reads and receives %s", async (style) => {
    const mint = mintUrl();
    const sent = bare(await kit.mintProofs(16, mint));
    const token = styles[style](mint, sent);

    // the amount and mint are read without the mint's keysets
    const meta = getTokenMetadata(token);
    expect([meta.mint, meta.amount, meta.unit]).toEqual([mint, 16, "sat"]);
    let stored: Proof[] = [];
    const executor = new WalletExecutor({
      owner: "alice",
      journal: new Journal(memoryStorage()),
      commitFor: () => async (add) => void (stored = [...stored, ...add]),
      locks: navigator.locks,
    });
    const received = await executor.receive(token);

    expect(sum(received)).toBe(16);
    // fresh coins, signed with the mint's active keyset
    const active = (await kit.walletAt(mint)).keysetId;
    expect(new Set(received.map((p) => p.id))).toEqual(new Set([active]));
    expect(stored).toEqual(received);
    expect(await kit.coinStates(received, mint)).toEqual(
      received.map(() => "UNSPENT")
    );
    expect(await kit.coinStates(sent, mint)).toEqual(sent.map(() => "SPENT"));
  });
});

it("lands a token the background retry meets while its take waits for the mint, and the take says so", async () => {
  const mint = kit.env.mintUrl;
  const token = getEncodedToken({
    mint,
    proofs: bare(await kit.mintProofs(16, mint)),
    unit: "sat",
  });
  let stored: Proof[] = [];
  const executor = new WalletExecutor({
    owner: "alice",
    journal: new Journal(memoryStorage()),
    commitFor: () => async (add) => void (stored = [...stored, ...add]),
    locks: navigator.locks,
  });
  // the mint answers the take's first question slowly, as a first connection on a phone can
  const fetch = globalThis.fetch;
  let asked: (() => void) | undefined;
  const asking = new Promise<void>((resolve) => (asked = resolve));
  globalThis.fetch = async (input, init) => {
    if (asked && String(input).endsWith("/v1/info")) {
      asked();
      asked = undefined;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return fetch(input, init);
  };
  try {
    const taking = executor.take(token);
    await asking;
    const retried = executor.retryReceives();
    const took = await taking;
    expect([took.pending, sum(took.proofs)]).toEqual([false, 16]);
    expect(await retried).toEqual([]);
  } finally {
    globalThis.fetch = fetch;
  }
  expect(sum(stored)).toBe(16);
});
