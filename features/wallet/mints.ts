import { Mint, type MintKeyset } from "@cashu/cashu-ts";

const FRESH_MS = 10 * 60_000;

/**
 * Each mint's keysets, to tell a coin's unit from its keyset id (full or the
 * short form a token carries). Loaded once per mint and again after a while;
 * a failed load is not kept, and a keyset id not yet known loads again (the
 * mint may have rotated its keys).
 */
export class MintKeysets {
  private readonly loaded = new Map<
    string,
    { at: number; keysets: Promise<MintKeyset[]> }
  >();

  constructor(
    private readonly fetchKeysets = async (mintUrl: string) =>
      (await new Mint(mintUrl).getKeySets()).keysets
  ) {}

  /** The unit of a coin with this keyset id at this mint. */
  async unitOf(mintUrl: string, keysetId: string): Promise<string> {
    const find = (keysets: MintKeyset[]) =>
      keysets.find((k) => k.id.startsWith(keysetId))?.unit;
    const unit = find(await this.keysets(mintUrl));
    if (unit) return unit;
    this.loaded.delete(mintUrl);
    const again = find(await this.keysets(mintUrl));
    if (!again) throw new Error(`${mintUrl} has no keyset ${keysetId}`);
    return again;
  }

  private keysets(mintUrl: string): Promise<MintKeyset[]> {
    const hit = this.loaded.get(mintUrl);
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.keysets;
    const keysets = this.fetchKeysets(mintUrl);
    this.loaded.set(mintUrl, { at: Date.now(), keysets });
    keysets.catch(() => {
      if (this.loaded.get(mintUrl)?.keysets === keysets)
        this.loaded.delete(mintUrl);
    });
    return keysets;
  }
}
