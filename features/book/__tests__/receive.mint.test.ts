// Receiving a token however it carries its keyset ids, from a mint with the old-style ids and from
// one with the new-style "01…" ids (nutshell 0.20, Minibits): what the token says, and what the
// mint itself then holds.
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

describe.each([
  ["a mint with old-style keyset ids", () => kit.env.mintUrl, "00"],
  ["a mint with new-style keyset ids", () => kit.env.invoiceMintUrl, "01"],
])("receiving from %s", (_, mintUrl, idStyle) => {
  it.each(Object.keys(styles))("reads and receives %s", async (style) => {
    const mint = mintUrl();
    const sent = bare(await kit.mintProofs(16, mint));
    expect(sent[0].id.slice(0, 2)).toBe(idStyle);
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
    expect(stored).toEqual(received);
    expect(await kit.coinStates(received, mint)).toEqual(
      received.map(() => "UNSPENT")
    );
    expect(await kit.coinStates(sent, mint)).toEqual(sent.map(() => "SPENT"));
  });
});
