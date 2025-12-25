import { Proof } from "../domain/Proof";
import { Keyset } from "@cashu/cashu-ts";

/**
 * Calculate total balance from an array of proofs
 */
export function calculateProofsBalance(proofs: Proof[]): number {
  return proofs.reduce((total, proof) => total + proof.amount, 0);
}

/**
 * Calculate balance per mint from proofs
 * Returns a map of mint URL to balance and unit
 */
export function calculateBalanceByMint(
  proofs: Proof[],
  mints: Array<{ url: string; keysets?: Keyset[] }>
): { balances: Record<string, number>; units: Record<string, string> } {
  const balances: Record<string, number> = {};
  const units: Record<string, string> = {};

  for (const mint of mints) {
    balances[mint.url] = 0;
    units[mint.url] = "sat";

    const keysets = mint.keysets;
    if (!keysets) {
      continue;
    }
    for (const keyset of keysets) {
      // Select all proofs with id == keyset.id or keyset._id
      const keysetId = keyset.id ?? (keyset as any)._id;
      const proofsForKeyset = proofs.filter((proof) => proof.id === keysetId);
      if (proofsForKeyset.length) {
        balances[mint.url] += proofsForKeyset.reduce(
          (acc, proof) => acc + proof.amount,
          0
        );
        units[mint.url] = keyset.unit;
      }
    }
  }
  // Check if sum of all balances is 0
  // const totalBalance = Object.values(balances).reduce(
  //   (sum, balance) => sum + balance,
  //   0
  // );
  // if (totalBalance === 0) {
  //   console.log("[Balance Check] Total balance is 0. Debug info:");
  //   mints.forEach((mint, index) => {
  //     console.log(
  //       `[Balance Check] Mint ${index + 1} (${mint.url}) keysets:`,
  //       mint.keysets
  //     );
  //   });
  //   console.log("[Balance Check] Proofs:", proofs);
  // }

  return { balances, units };
}

/**
 * Compute total balance across mints in sats, converting msats -> sats
 */
export function computeTotalBalanceSats(
  mintBalances: Record<string, number>,
  mintUnits: Record<string, string>
): number {
  let total = 0;

  for (const mintUrl of Object.keys(mintBalances)) {
    const amount = mintBalances[mintUrl] || 0;
    const unit = mintUnits[mintUrl] || "sat";
    total += unit === "msat" ? amount / 1000 : amount;
  }

  return total;
}

/**
 * Get balance for a specific mint
 */
export function getMintBalance(
  mintUrl: string,
  mintBalances: Record<string, number>
): number {
  return mintBalances[mintUrl] || 0;
}
