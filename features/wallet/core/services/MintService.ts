import { CashuMint, CashuWallet, GetInfoResponse, MintKeyset, MintKeys } from '@cashu/cashu-ts';
import { Mint } from '../domain/Mint';
import { normalizeMintUrl } from '../utils/formatting';

/**
 * MintService
 * Handles all mint-related operations
 */
export class MintService {
  /**
   * Activate a mint by fetching its info and keysets
   */
  async activateMint(mintUrl: string): Promise<{ mintInfo: GetInfoResponse; keysets: MintKeyset[] }> {
    const normalizedUrl = normalizeMintUrl(mintUrl);
    const mint = new CashuMint(normalizedUrl);
    const wallet = new CashuWallet(mint);
    const msatWallet = new CashuWallet(mint, { unit: 'msat' });
    
    const mintInfo = await wallet.getMintInfo();
    const walletKeysets = await wallet.getKeySets();
    const msatKeysets = await msatWallet.getKeySets();
    const allKeysets = Array.from(new Set([...walletKeysets, ...msatKeysets]));
    
    // Some mints or clients may return malformed keyset ids. Filter to valid hex ids to avoid downstream fromHex errors.
    const isValidHexId = (id: string) => typeof id === 'string' && /^[0-9a-fA-F]+$/.test(id) && id.length % 2 === 0;
    const filteredKeysets = allKeysets.filter(ks => isValidHexId(ks.id));
    
    return { mintInfo, keysets: filteredKeysets };
  }

  /**
   * Update mint keys for given keysets
   */
  async updateMintKeys(
    mintUrl: string,
    keysets: MintKeyset[]
  ): Promise<{ keys: Record<string, MintKeys>[] }> {
    const normalizedUrl = normalizeMintUrl(mintUrl);
    const mint = new CashuMint(normalizedUrl);
    const wallet = new CashuWallet(mint);
    const msatWallet = new CashuWallet(mint, { unit: 'msat' });
    
    const walletKeysets = await wallet.getKeySets();
    const msatKeysets = await msatWallet.getKeySets();

    const isValidHexId = (id: string) => typeof id === 'string' && /^[0-9a-fA-F]+$/.test(id) && id.length % 2 === 0;
    const safeKeysets = keysets.filter(ks => isValidHexId(ks.id));
    
    const keys = await Promise.all(
      safeKeysets.map(async (keyset) => {
        // Use the appropriate wallet based on which keyset list contains this keyset.id
        const isInWalletKeysets = walletKeysets.some(k => k.id === keyset.id);
        const walletToUse = isInWalletKeysets ? wallet : msatWallet;
        return { [keyset.id]: await walletToUse.getKeys(keyset.id) };
      })
    );

    return { keys };
  }

  /**
   * Get preferred unit for a mint (prefer msat over sat)
   */
  async getPreferredUnit(mintUrl: string): Promise<'sat' | 'msat' | 'not supported'> {
    const normalizedUrl = normalizeMintUrl(mintUrl);
    const mint = new CashuMint(normalizedUrl);
    const keysets = await mint.getKeySets();
    
    const activeKeysets = keysets.keysets.filter(k => k.active);
    const units = [...new Set(activeKeysets.map(k => k.unit))];
    
    return units.includes('msat') ? 'msat' : (units.includes('sat') ? 'sat' : 'not supported');
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

export const defaultMints = [
  'https://mint.minibits.cash/Bitcoin',
];

