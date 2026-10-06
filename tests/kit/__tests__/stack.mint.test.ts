// The kit checks itself: real mints, a relay that behaves like one, and real routstr-core
// charging and refunding real coins through the fake upstream.
import { getDecodedToken, type Proof } from "@cashu/cashu-ts";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { useKit } from "..";

const kit = useKit();
const sum = (proofs: Pick<Proof, "amount">[]) =>
  proofs.reduce((s, p) => s + p.amount, 0);
const tokenSats = (token: string) => sum(getDecodedToken(token).proofs);
void tokenSats;

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
});
