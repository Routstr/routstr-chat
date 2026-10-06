// The kit checks itself: real mints, a relay that behaves like one, and real routstr-core
// charging and refunding real coins through the fake upstream.
import { getEncodedToken, type Proof } from "@cashu/cashu-ts";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { Relay } from "applesauce-relay";
import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { getKit } from "..";

const kit = getKit();
const sum = (proofs: Pick<Proof, "amount">[]) =>
  proofs.reduce((s, p) => s + p.amount, 0);

describe("mints", () => {
  it("mints coins the mint calls unspent, and pays an invoice from the other mint", async () => {
    const proofs = await kit.mintProofs(64);
    expect(sum(proofs)).toBe(64);
    expect(await kit.coinStates(proofs)).toEqual(proofs.map(() => "UNSPENT"));

    const wallet = await kit.walletAt(kit.env.mintUrl);
    const quote = await wallet.createMeltQuote(await kit.invoice(10));
    const { quote: paid, change } = await wallet.meltProofs(quote, proofs);
    expect(paid.state).toBe("PAID");
    expect(await kit.coinStates(proofs)).toEqual(proofs.map(() => "SPENT"));
    // what went in = invoice + Lightning fee + change, and the fee stays within the reserve
    const fee = 64 - 10 - sum(change);
    expect(fee).toBeGreaterThanOrEqual(0);
    expect(fee).toBeLessThanOrEqual(quote.fee_reserve);
  });

  it("redeems a real token and refuses one whose amounts were changed", async () => {
    expect(await kit.redeem(await kit.mintToken(16))).toBe(16);
    const proofs = await kit.mintProofs(8);
    const forged = getEncodedToken({
      mint: kit.env.mintUrl,
      unit: "sat",
      proofs: proofs.map((p) => ({ ...p, amount: p.amount * 64 })),
    });
    expect(kit.tokenSats(forged)).toBe(512); // what the token claims
    await expect(kit.redeem(forged)).rejects.toThrow(); // what the mint says
  });
});

describe("relay", () => {
  const send = (msgs: unknown[][], until: (m: unknown[]) => boolean) =>
    new Promise<unknown[][]>((resolve, reject) => {
      const ws = new WebSocket(kit.env.relayUrl);
      const got: unknown[][] = [];
      ws.on("open", () => msgs.forEach((m) => ws.send(JSON.stringify(m))));
      ws.on("message", (raw) => {
        const m = JSON.parse(String(raw)) as unknown[];
        got.push(m);
        if (!until(m)) return;
        ws.close();
        resolve(got);
      });
      ws.on("error", reject);
      ws.on("close", () => reject(new Error("closed"))); // no-op once resolved
    });

  it("keeps only the newest replaceable event and rejects a bad signature", async () => {
    await kit.relay.reset();
    const sk = generateSecretKey();
    const older = finalizeEvent(
      { kind: 10002, created_at: 100, tags: [], content: "old" },
      sk
    );
    const newer = finalizeEvent(
      { kind: 10002, created_at: 200, tags: [], content: "new" },
      sk
    );
    const forged = {
      ...finalizeEvent(
        { kind: 1, created_at: 300, tags: [], content: "x" },
        sk
      ),
      content: "changed",
    };
    const replies = await send(
      [
        ["EVENT", newer],
        ["EVENT", older],
        ["EVENT", forged],
        ["REQ", "s", { kinds: [10002, 1] }],
      ],
      (m) => m[0] === "EOSE"
    );
    const ok = replies.filter((m) => m[0] === "OK");
    expect(ok.map((m) => m[2])).toEqual([true, false, false]);
    expect(
      replies
        .filter((m) => m[0] === "EVENT")
        .map((m) => (m[2] as { content: string }).content)
    ).toEqual(["new"]);
    expect((await kit.relay.events()).map((e) => e.content)).toEqual(["new"]);
  });

  it("takes nothing while it is down, from readers or writers", async () => {
    await kit.relay.reset();
    const sk = generateSecretKey();
    const ws = new WebSocket(kit.env.relayUrl);
    await new Promise((r) => ws.on("open", r));
    const cut = new Promise((r) => ws.on("close", r));
    await kit.relay.down(true);
    try {
      await cut; // an open publisher is cut too
      const event = finalizeEvent(
        { kind: 1, created_at: 100, tags: [], content: "x" },
        sk
      );
      await expect(send([["EVENT", event]], () => true)).rejects.toThrow();
    } finally {
      await kit.relay.down(false);
    }
    expect(await kit.relay.events()).toEqual([]);
  });

  it("tells a negentropy (NIP-77) client exactly which events it is missing", async () => {
    await kit.relay.reset();
    const sk = generateSecretKey();
    const notes = [1, 2, 3].map((n) =>
      finalizeEvent(
        { kind: 1080, created_at: 100 + n, tags: [], content: `n${n}` },
        sk
      )
    );
    await kit.relay.seed(notes);
    const relay = new Relay(kit.env.relayUrl);
    let need: string[] = [];
    await relay.negentropy(
      [notes[0]],
      { kinds: [1080] },
      async (_have, missing) => void (need = missing)
    );
    relay.close();
    expect(need.sort()).toEqual([notes[1].id, notes[2].id].sort());
  });

  it("forgets what its author deleted, and refuses it back", async () => {
    await kit.relay.reset();
    const sk = generateSecretKey();
    const other = generateSecretKey();
    const note = finalizeEvent(
      { kind: 1, created_at: 100, tags: [], content: "note" },
      sk
    );
    const chat = finalizeEvent(
      { kind: 30078, created_at: 100, tags: [["d", "c"]], content: "v1" },
      sk
    );
    const del = finalizeEvent(
      {
        kind: 5,
        created_at: 150,
        tags: [
          ["e", note.id],
          ["a", `30078:${note.pubkey}:c`],
        ],
        content: "",
      },
      sk
    );
    const foreign = finalizeEvent(
      { kind: 5, created_at: 150, tags: [["e", note.id]], content: "" },
      other
    );
    const later = finalizeEvent(
      { kind: 30078, created_at: 200, tags: [["d", "c"]], content: "v2" },
      sk
    );
    const replies = await send(
      [
        ["EVENT", note],
        ["EVENT", chat],
        ["EVENT", foreign],
        ["REQ", "a", { kinds: [1] }],
      ],
      (m) => m[0] === "EOSE"
    );
    expect(replies.filter((m) => m[0] === "EVENT")).toHaveLength(1); // a stranger cannot delete it
    const after = await send(
      [
        ["EVENT", del],
        ["EVENT", note],
        ["EVENT", later],
        ["REQ", "b", { kinds: [1, 30078] }],
      ],
      (m) => m[0] === "EOSE"
    );
    expect(after.filter((m) => m[0] === "OK").map((m) => m[2])).toEqual([
      true,
      false,
      true,
    ]);
    expect(
      after
        .filter((m) => m[0] === "EVENT")
        .map((m) => (m[2] as { content: string }).content)
    ).toEqual(["v2"]);
  });
});
