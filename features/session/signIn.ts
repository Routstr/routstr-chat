import { nip19 } from "nostr-tools";
import * as nip49 from "nostr-tools/nip49";
import { normalizeToSecretKey } from "applesauce-core/helpers";
import {
  NostrConnectAccount,
  PrivateKeyAccount,
} from "applesauce-accounts/accounts";
import { NostrConnectSigner } from "applesauce-signers";
import type { Account, AccountMetadata } from "./service";

/* The ways to bring a Nostr key to this device. Each one ends in an account
   for the session to add; nothing here touches storage or the screen. */

/** What a pasted secret turned out to be: a key, a key locked with a
 *  password (NIP-49, a backup file's text), or neither. */
export type SecretRead =
  | { key: Uint8Array }
  | { locked: string }
  | { problem: "public" | "invalid" };

export function readSecret(text: string): SecretRead {
  const value = text.trim();
  const locked = value.match(/ncryptsec1[02-9ac-hj-np-z]+/)?.[0];
  if (locked) return { locked };
  const key = normalizeToSecretKey(value);
  if (key) return { key };
  return { problem: /^(npub|nprofile)1/.test(value) ? "public" : "invalid" };
}

/** A remote signer reached through its bunker:// link. */
export async function fromBunkerLink(link: string): Promise<Account> {
  const signer = await NostrConnectSigner.fromBunkerURI(link);
  return new NostrConnectAccount<AccountMetadata>(
    await signer.getPublicKey(),
    signer
  );
}

/** A remote signer that scans a nostrconnect:// code: show `uri`, then
 *  `account()` resolves once the signer app answers. */
export function signerByCode(relays: string[], name: string) {
  const signer = new NostrConnectSigner({ relays });
  return {
    uri: signer.getNostrConnectURI({ name }),
    async account(abort: AbortSignal): Promise<Account> {
      await signer.waitForSigner(abort);
      return new NostrConnectAccount<AccountMetadata>(
        await signer.getPublicKey(),
        signer
      );
    },
  };
}

/** The key a locked copy holds; null when the password does not open it. */
export function unlockSecret(locked: string, password: string): Uint8Array | null {
  try {
    return nip49.decrypt(locked, password);
  } catch {
    return null;
  }
}

/** A copy of a key kept in this browser, locked with a password, for a file
 *  the person keeps. Never for relays: NIP-49 warns they get cracked in bulk. */
export const lockedSecret = (account: Account, password: string): string | null =>
  account instanceof PrivateKeyAccount ? nip49.encrypt(account.signer.key, password) : null;

/** The nsec of a key kept in this browser; null when another app holds it. */
export const secretOf = (account: Account): string | null =>
  account instanceof PrivateKeyAccount
    ? nip19.nsecEncode(account.signer.key)
    : null;
