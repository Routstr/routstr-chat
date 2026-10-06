import { Mint, Wallet } from "@cashu/cashu-ts";

/** A cashu-ts wallet for this mint in `unit`, or by default in msat when the
 *  mint offers it, else sat. */
export async function openWallet(
  mintUrl: string,
  unit?: string
): Promise<Wallet> {
  const mint = new Mint(mintUrl);
  const { keysets } = await mint.getKeySets();
  const active = new Set(keysets.filter((k) => k.active).map((k) => k.unit));
  unit ??= active.has("msat") ? "msat" : "sat";
  if (!keysets.some((k) => k.unit === unit)) {
    throw new Error(`${mintUrl} has no ${unit} keyset`);
  }
  const wallet = new Wallet(mint, { unit });
  await wallet.loadMint();
  return wallet;
}

export const normalizeMintUrl = (url: string) => url.replace(/\/+$/, "");
