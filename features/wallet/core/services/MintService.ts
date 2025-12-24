import {
  Mint as CashuMint,
  Wallet,
  GetInfoResponse,
  Keyset,
  MintKeys,
} from "@cashu/cashu-ts";
import { Mint } from "../domain/Mint";
import { normalizeMintUrl } from "../utils/formatting";

/**
 * MintService
 * Handles all mint-related operations
 */
export class MintService {
  /**
   * Activate a mint by fetching its info and keysets
   */
  async activateMint(mintUrl: string): Promise<{
    mintInfo: GetInfoResponse;
    keysets: Keyset[];
    keys: Record<string, MintKeys>[];
  }> {
    try {
      const normalizedUrl = normalizeMintUrl(mintUrl);
      const mint = new CashuMint(normalizedUrl);
      const keysets = await mint.getKeySets();
      const activeKeysets = keysets.keysets.filter((k) => k.active);
      const units = [...new Set(activeKeysets.map((k) => k.unit))];

      // Create wallets for all unique units
      const wallets = await Promise.all(
        units.map(async (unit) => {
          const wallet = new Wallet(mint, unit === "sat" ? {} : { unit });
          await wallet.loadMint();
          return { unit, wallet };
        })
      );

      // Get mint info from the first wallet
      const mintInfo = wallets[0].wallet.getMintInfo();

      // Collect all keysets from all wallets
      const allKeysets = wallets.map(({ wallet }) =>
        wallet.keyChain.getKeyset()
      );

      // Some mints or clients may return malformed keyset ids. Filter to valid hex ids to avoid downstream fromHex errors.
      const isValidHexId = (id: string) =>
        typeof id === "string" &&
        /^[0-9a-fA-F]+$/.test(id) &&
        id.length % 2 === 0;
      const filteredKeysets = allKeysets.filter(
        (ks) => isValidHexId(ks.id) && ks.active
      );

      // Use wallets to fetch keys for each keyset
      const keys = await Promise.all(
        filteredKeysets.map(async (keyset) => {
          // Find the wallet that matches this keyset's unit
          const walletEntry = wallets.find(
            ({ wallet }) => wallet.keyChain.getKeyset().id === keyset.id
          );
          const walletToUse = walletEntry?.wallet || wallets[0].wallet;
          return { [keyset.id]: walletToUse.keyChain.getKeyset(keyset.id) };
        })
      );

      return { mintInfo, keysets: filteredKeysets, keys: keys };
    } catch (error) {
      throw new Error(
        `Failed to activate mint ${mintUrl}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get preferred unit for a mint (prefer msat over sat)
   */
  async getPreferredUnit(
    mintUrl: string
  ): Promise<"sat" | "msat" | "not supported"> {
    const normalizedUrl = normalizeMintUrl(mintUrl);
    const mint = new CashuMint(normalizedUrl);
    const keysets = await mint.getKeySets();

    const activeKeysets = keysets.keysets.filter((k) => k.active);
    const units = [...new Set(activeKeysets.map((k) => k.unit))];

    return units.includes("msat")
      ? "msat"
      : units.includes("sat")
        ? "sat"
        : "not supported";
  }

  /**
   * Validate mint URL
   */
  validateMintUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

export const defaultMints = ["https://mint.minibits.cash/Bitcoin"];
