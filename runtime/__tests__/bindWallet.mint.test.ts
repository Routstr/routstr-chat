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
