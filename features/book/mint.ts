import { Mint, Wallet } from "@cashu/cashu-ts";

// opening a wallet asks the mint four times, two rounds one after the other:
// each mint and unit's is kept this long, and asked again after any failure
const KEEP_MS = 10 * 60_000;
const opened = new Map<string, { at: number; wallet: Promise<Wallet> }>();

/** A cashu-ts wallet for this mint in `unit`, or by default in msat when the
 *  mint offers it, else sat. One opened lately is given again (one being
 *  opened too); forgetWallets makes the next open ask the mint again. */
export function openWallet(mintUrl: string, unit?: string): Promise<Wallet> {
  const key = `${normalizeMintUrl(mintUrl)} ${unit ?? ""}`;
  const kept = opened.get(key);
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.wallet;
  const wallet = load(mintUrl, unit);
  opened.set(key, { at: Date.now(), wallet });
  wallet.catch(() => forgetWallets(mintUrl));
  return wallet;
}

/** The mint failed a request or changed: its wallets are opened anew. */
export function forgetWallets(mintUrl: string): void {
  const url = normalizeMintUrl(mintUrl);
  for (const key of opened.keys()) {
    if (key.startsWith(`${url} `)) opened.delete(key);
  }
}

async function load(mintUrl: string, unit?: string): Promise<Wallet> {
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
