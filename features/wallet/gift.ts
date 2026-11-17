import { Mint, Wallet, getEncodedTokenV4 } from "@cashu/cashu-ts";

/* A gift sent as a short link: the link holds only the gift's seed (and its mint and message);
   its coins were made from the seed (the executor's `seed` send option), so the mint can sign
   them again on request (NUT-09) and they come back as a token. Asking spends nothing: the token
   is then taken as any other, and a gift already opened says so then. */

/** A fresh seed for a gift: 16 random bytes, never this account's own. */
export const giftSeed = () => crypto.getRandomValues(new Uint8Array(16));

/** The gift a seed made at a mint, as a token, or null if the mint has no coins for that seed. */
export async function giftFromSeed(mintUrl: string, seed: Uint8Array): Promise<string | null> {
  const mint = new Mint(mintUrl);
  const { keysets } = await mint.getKeySets();
  // the keyset it was made in may have been rotated since: active ones first
  const ordered = [...keysets].sort((a, b) => Number(b.active) - Number(a.active));
  for (const keyset of ordered) {
    const wallet = new Wallet(mint, { unit: keyset.unit, keysetId: keyset.id, bip39seed: seed });
    await wallet.loadMint();
    const { proofs } = await wallet.restore(0, 64, { keysetId: keyset.id });
    if (proofs.length) return getEncodedTokenV4({ mint: mintUrl, proofs, unit: keyset.unit });
  }
  return null;
}
