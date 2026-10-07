import { verifyEvent, type NostrEvent } from "nostr-tools";
import { z } from "zod";
import { defaultMints } from "./core/services/MintService";
import type { WalletRelays, WalletSigner } from "./ports";

// NIP-60's wallet event: the key nutzaps are locked to, and the wallet's mints
const WALLET = 17375;

export interface WalletEvent {
  id: string;
  privkey: string;
  mints: string[];
  createdAt: number;
}

interface Deps {
  signer: WalletSigner;
  relays: WalletRelays;
}

const tidy = (mints: string[]) => [
  ...new Set(mints.map((mint) => mint.replace(/\/$/, ""))),
];

/** The account's latest wallet event on its relays (its own too, NIP-65),
 *  the default mints added; null when no relay has one. Throws when it cannot
 *  be read. */
export async function readWallet(
  owner: string,
  { signer, relays }: Deps
): Promise<WalletEvent | null> {
  await relays.ready();
  const { events } = await relays.fetch({ kinds: [WALLET], authors: [owner] });
  const [event] = events
    .filter((e) => e.kind === WALLET && e.pubkey === owner && verifyEvent(e))
    .sort((a, b) => b.created_at - a.created_at);
  if (!event) return null;
  const tags = z
    .string()
    .array()
    .array()
    .parse(JSON.parse(await signer.decrypt(event.content)));
  const privkey = tags.find(([key]) => key === "privkey")?.[1];
  if (!privkey) throw new Error("Private key not found in wallet data");
  return {
    id: event.id,
    privkey,
    mints: tidy([
      ...tags.filter(([key]) => key === "mint").map(([, mint]) => mint),
      ...defaultMints,
    ]),
    createdAt: event.created_at,
  };
}

/** Publishes the account's wallet event, encrypted to itself; resolves once
 *  a relay took it. */
export async function publishWallet(
  { signer, relays }: Deps,
  wallet: { privkey: string; mints: string[] }
): Promise<NostrEvent> {
  const tags = [
    ["privkey", wallet.privkey],
    ...tidy(wallet.mints).map((mint) => ["mint", mint]),
  ];
  const event = await signer.sign({
    kind: WALLET,
    content: await signer.encrypt(JSON.stringify(tags)),
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
  });
  await relays.publish(event);
  return event;
}
