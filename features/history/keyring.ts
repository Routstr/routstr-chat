import {
  generateSecretKey,
  nip19,
  type EventTemplate,
  type NostrEvent,
} from "nostr-tools";
import { derivePnsKeys, type PnsKeys } from "@/lib/pns";
import { decodePrivateKey } from "@/lib/nostr";

export const KIND_KEYRING = 1081;

/** What history needs from the account's signer. */
export interface HistorySigner {
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  signEvent(template: EventTemplate): Promise<NostrEvent>;
}

/**
 * The history key one kind 1081 holds, encrypted by the person to themselves.
 * Null when the signer refuses or cannot decrypt (some extensions), or the
 * content is not a keyring. An extension or remote signer can take seconds.
 */
export async function openKeyring(
  event: NostrEvent,
  owner: string,
  signer: HistorySigner
): Promise<PnsKeys | null> {
  let content: { nsec?: unknown; salt?: unknown };
  try {
    if (!signer.nip44) return null;
    content = JSON.parse(await signer.nip44.decrypt(owner, event.content));
  } catch {
    return null;
  }
  const secret =
    typeof content?.nsec === "string" ? decodePrivateKey(content.nsec) : null;
  if (!secret) return null;
  // main stores the default salt as ""
  const salt =
    typeof content.salt === "string" && content.salt ? content.salt : undefined;
  return derivePnsKeys(secret, salt);
}

/** A first keyring, written the way main writes it, and the keys it holds. */
export async function createKeyring(
  owner: string,
  signer: HistorySigner,
  createdAt: number
): Promise<{ event: NostrEvent; keys: PnsKeys }> {
  if (!signer.nip44) throw new Error("This signer cannot encrypt");
  const secret = generateSecretKey();
  const content = JSON.stringify({ nsec: nip19.nsecEncode(secret), salt: "" });
  const event = await signer.signEvent({
    kind: KIND_KEYRING,
    created_at: createdAt,
    tags: [],
    content: await signer.nip44.encrypt(owner, content),
  });
  return { event, keys: derivePnsKeys(secret) };
}
