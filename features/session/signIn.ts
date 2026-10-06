import { nip19 } from "nostr-tools";
import { normalizeToSecretKey } from "applesauce-core/helpers";
import {
  NostrConnectAccount,
  PrivateKeyAccount,
} from "applesauce-accounts/accounts";
import { NostrConnectSigner } from "applesauce-signers";
import type { Account, AccountMetadata } from "./service";

/* The ways to bring a Nostr key to this device. Each one ends in an account
   for the session to add; nothing here touches storage or the screen. */

/** What a pasted secret turned out to be. */
export type SecretRead =
  | { key: Uint8Array }
  | { problem: "public" | "invalid" };

export function readSecret(text: string): SecretRead {
  const value = text.trim();
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

/** The nsec of a key kept in this browser; null when another app holds it. */
export const secretOf = (account: Account): string | null =>
  account instanceof PrivateKeyAccount
    ? nip19.nsecEncode(account.signer.key)
    : null;
