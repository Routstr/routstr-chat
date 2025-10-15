import { getDecodedToken, getEncodedTokenV4, Proof as CashuProof } from '@cashu/cashu-ts';
import { CashuToken, EncodedToken } from '../domain/Token';
import { Proof } from '../domain/Proof';

/**
 * TokenService
 * Handles token encoding/decoding and parsing
 */
export class TokenService {
  /**
   * Decode a Cashu token string
   */
  decodeToken(token: EncodedToken): CashuToken | null {
    try {
      const decoded = getDecodedToken(token);
      return {
        mint: decoded.mint,
        proofs: decoded.proofs as Proof[],
        unit: decoded.unit
      };
    } catch (error) {
      console.error('Failed to decode token:', error);
      return null;
    }
  }

  /**
   * Encode proofs into a Cashu token string (V4 format)
   */
  encodeToken(mintUrl: string, proofs: Proof[], unit: string = 'sat'): EncodedToken {
    return getEncodedTokenV4({
      mint: mintUrl,
      proofs: proofs.map(p => ({
        id: p.id || '',
        amount: p.amount,
        secret: p.secret || '',
        C: p.C || '',
      })),
      unit
    });
  }

  /**
   * Get total amount from a token
   */
  getTokenAmount(token: EncodedToken): number {
    const decoded = this.decodeToken(token);
    if (!decoded) return 0;
    return decoded.proofs.reduce((acc, proof) => acc + proof.amount, 0);
  }

  /**
   * Get total amount from proofs
   */
  getProofsAmount(proofs: Proof[]): number {
    return proofs.reduce((total, proof) => total + proof.amount, 0);
  }

  /**
   * Validate token format
   */
  isValidToken(token: string): boolean {
    try {
      const decoded = getDecodedToken(token);
      return !!decoded && decoded.proofs.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Create a legacy token format (cashuAxxxxx)
   */
  createLegacyToken(mintUrl: string, proofs: Proof[]): EncodedToken {
    const tokenObj = {
      token: [{ mint: mintUrl, proofs }]
    };
    return `cashuA${btoa(JSON.stringify(tokenObj))}`;
  }
}

