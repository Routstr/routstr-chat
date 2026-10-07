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

/** The book moves coins only at a mint that can say what became of a lost
 *  request (NUT-07 and NUT-09). */
export function assertRecoverable(wallet: Wallet, mintUrl: string): void {
  const info = wallet.getMintInfo();
  if (!info.isSupported(7).supported || !info.isSupported(9).supported) {
    throw new Error(
      `${mintUrl} cannot report what happened to a lost payment (NUT-07 and NUT-09), so the wallet does not move coins there.`
    );
  }
}

export const normalizeMintUrl = (url: string) => url.replace(/\/+$/, "");
