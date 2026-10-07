import type { Account } from "@/features/session/service";
import type { WalletSigner } from "./ports";

/** An account's signer for its own wallet: NIP-44 to itself, and its events. */
export const signerOf = (account: Account): WalletSigner => {
  const nip44 = () => {
    if (!account.nip44) throw new Error("Your signer cannot encrypt (NIP-44)");
    return account.nip44;
  };
  return {
    encrypt: (text) => nip44().encrypt(account.pubkey, text),
    decrypt: (text) => nip44().decrypt(account.pubkey, text),
    sign: (template) => account.signEvent(template),
  };
};
