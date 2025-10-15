import { Proof } from '../domain/Proof';
import { MintKeyset } from '@cashu/cashu-ts';

/**
 * Calculate fees for proofs using the Python reference implementation
 * @param inputProofs The proofs to calculate fees for
 * @param activeKeysets The active keysets from the mint
 * @returns The calculated fees in satoshis
 */
export function calculateFees(inputProofs: Proof[], activeKeysets: MintKeyset[]): number {
  let sumFees = 0;
  
  for (const proof of inputProofs) {
    const keyset = activeKeysets.find(k => k.id === proof.id);
    if (keyset && keyset.input_fee_ppk !== undefined) {
      sumFees += keyset.input_fee_ppk;
    }
  }
  
  return Math.floor((sumFees + 999) / 1000);
}

/**
 * Calculate per-proof average fee
 */
export function calculateAverageFeePerProof(
  proofs: Proof[],
  activeKeysets: MintKeyset[]
): number {
  const totalFee = calculateFees(proofs, activeKeysets);
  return proofs.length > 0 ? totalFee / proofs.length : 0;
}

