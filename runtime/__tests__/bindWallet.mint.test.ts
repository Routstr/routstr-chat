// The wallet's relay copy follows the active account: on a switch nothing of the account left
// behind goes out under the new one's signer, and its waiting outbox entry lands once it is
// active again (kit mint and relay, one browser tab stood in for).
import { IDBFactory } from "fake-indexeddb";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
  type NostrEvent,
} from "nostr-tools";
import { createServer } from "node:net";
import { expect, it, vi } from "vitest";
import { getKit } from "@/tests/kit";
import "@/tests/kit/idb";
import { memoryStorage } from "@/features/book/journal";
import type { Account } from "@/features/session/service";

const kit = getKit();
globalThis.indexedDB = new IDBFactory();
vi.stubGlobal("window", {
  localStorage: memoryStorage(),
  location: { search: `?relays=${kit.env.relayUrl}` },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});
const { bindWallet, walletPurseFor } = await import("../wallet");
const { walletCoins } = await import("@/features/wallet/hooks/purseBridge");

function account() {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const key = nip44.getConversationKey(secret, pubkey);
  return {
    pubkey,
    key,
    account: {
      pubkey,
      nip44: {
        encrypt: async (_: string, text: string) => nip44.encrypt(text, key),
        decrypt: async (_: string, text: string) => nip44.decrypt(text, key),
      },
      signEvent: async (template: Parameters<typeof finalizeEvent>[0]) =>
        finalizeEvent(template, secret),
    } as unknown as Account,
  };
}

/** the secrets each of `pubkey`'s token events on the relay lists */
async function listed(pubkey: string, key: Uint8Array) {
  const events = (await kit.relay.events()) as NostrEvent[];
  return events
    .filter((e) => e.kind === 7375 && e.pubkey === pubkey)
    .flatMap(
      (e) =>
        JSON.parse(nip44.decrypt(e.content, key)).proofs as { secret: string }[]
    )
    .map((p) => p.secret);
}

it("never publishes an account's coins under another's signer, and publishes them once it is back", async () => {
  const a = account();
  const b = account();

  await kit.relay.down(true);
  try {
    bindWallet(a.account);
    await walletPurseFor(a.pubkey).receive(await kit.mintToken(16));
    // A's push fails while the relay is down: its outbox keeps the mint
    await new Promise((r) => setTimeout(r, 8000));
    bindWallet(b.account);
  } finally {
    await kit.relay.down(false);
  }

  // B is active: its own coins go out, none of A's, and nothing under A's key
  await walletPurseFor(b.pubkey).receive(await kit.mintToken(8));
  await vi.waitFor(
    async () => expect(await listed(b.pubkey, b.key)).not.toEqual([]),
    {
      timeout: 45_000,
    }
  );
  const aSecrets = (await walletCoins().coins(a.pubkey)).map((c) => c.secret);
  expect(aSecrets).not.toEqual([]);
  expect(
    (await listed(b.pubkey, b.key)).filter((s) => aSecrets.includes(s))
  ).toEqual([]);
  expect(await listed(a.pubkey, a.key)).toEqual([]);

  // A again: its waiting entry lands, listing its 16 sats
  bindWallet(a.account);
  await vi.waitFor(
    async () =>
      expect((await listed(a.pubkey, a.key)).sort()).toEqual(aSecrets.sort()),
    { timeout: 45_000 }
  );
  bindWallet(undefined);
}, 120_000);

it("brings another key's old coins in too, so its money counts before it is active", async () => {
  const active = account();
  const other = account();
  const mint = kit.env.mintUrl;
  const proofs = await kit.mintProofs(12, mint);
  const { keysets } = await (await kit.walletAt(mint)).mint.getKeySets();
  window.localStorage.setItem(
    `cashu:${other.pubkey}`,
    JSON.stringify({
      state: {
        proofs,
        mints: [{ url: mint, keysets: keysets.map((k) => ({ _id: k.id })) }],
      },
      version: 0,
    })
  );
  bindWallet(active.account);
  await vi.waitFor(
    async () =>
      expect((await walletPurseFor(other.pubkey).balances())[mint]).toBe(12),
    { timeout: 20_000 }
  );
  // and nothing of it goes out under the active key
  expect(await listed(other.pubkey, other.key)).toEqual([]);
  bindWallet(undefined);
}, 60_000);

it("binds the account, not its key: of one key added twice, the copy that is active signs", async () => {
  const a = account();
  const broken = {
    ...a.account,
    signEvent: async () => {
      throw new Error("this copy cannot sign");
    },
  } as unknown as Account;
  bindWallet(broken);
  await walletPurseFor(a.pubkey).receive(await kit.mintToken(8));
  await new Promise((r) => setTimeout(r, 1500));
  expect(await listed(a.pubkey, a.key)).toEqual([]);

  bindWallet(a.account); // the same key, the copy that can sign
  await vi.waitFor(
    async () =>
      expect((await listed(a.pubkey, a.key)).length).toBeGreaterThan(0),
    { timeout: 20_000 }
  );
  bindWallet(undefined);
}, 60_000);

it("reads nothing more for an account switched away from while its old list was swept", async () => {
  // a mint that takes the connection and never answers
  const blackhole = createServer(() => undefined);
  await new Promise<void>((r) => blackhole.listen(0, "127.0.0.1", r));
  const port = (blackhole.address() as { port: number }).port;
  try {
    const a = account();
    const b = account();
    // a's copy on relays: reading it would decrypt with a's signer
    await kit.relay.seed([
      await a.account.signEvent({
        kind: 7375,
        content: nip44.encrypt(
          JSON.stringify({ mint: "https://m", proofs: [] }),
          a.key
        ),
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      }),
    ]);
    const decrypt = vi.spyOn(a.account.nip44!, "decrypt");
    window.localStorage.setItem(
      `cashu:${a.pubkey}`,
      JSON.stringify({
        state: {
          proofs: [{ id: "00aa", amount: 8, secret: "s1", C: "02" }],
          mints: [
            { url: `http://127.0.0.1:${port}`, keysets: [{ id: "00aa" }] },
          ],
        },
        version: 0,
      })
    );
    bindWallet(a.account); // its sweep waits on the silent mint
    bindWallet(b.account);
    await new Promise((r) => setTimeout(r, 12_000));
    expect(decrypt).not.toHaveBeenCalled();
    bindWallet(undefined);
  } finally {
    blackhole.close();
  }
}, 60_000);
