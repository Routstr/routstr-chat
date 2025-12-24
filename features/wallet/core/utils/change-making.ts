import { Proof } from "../domain/Proof";
import { Wallet, Keyset } from "@cashu/cashu-ts";
import { calculateFees } from "./fees";

/**
 * Check if we can make exact change using available denominations
 * Uses a greedy approach with backtracking for optimal denomination selection
 * @param targetAmount The amount we need to make
 * @param denomCounts A map of denomination values to their counts
 * @param availableProofs The actual proof objects available
 * @param fees Optional fees to account for
 * @param errorTolerance Optional tolerance for overpayment (0-1, e.g., 0.05 = 5%)
 * @returns Object indicating if exact change can be made and the selected proofs if possible
 */
export function canMakeExactChange(
  targetAmount: number,
  denomCounts: Record<number, number>,
  availableProofs: Proof[],
  fees?: number,
  errorTolerance?: number
): { canMake: boolean; selectedProofs?: Proof[]; actualAmount?: number } {
  // Default error tolerance to 0 (exact change) if not specified
  const tolerance = errorTolerance || 0;

  // If fees are defined, we need to account for them
  if (fees !== undefined && fees > 0) {
    // We need to iteratively calculate the total amount needed including fees
    // Start with the target amount and keep adding fees until we converge
    let totalNeeded = targetAmount;
    let previousProofCount = 0;
    let iterations = 0;
    const maxIterations = 100; // Prevent infinite loops

    while (iterations < maxIterations) {
      iterations++;

      // Try to find a combination for the current totalNeeded, allowing for error tolerance
      const maxAcceptableAmount = Math.ceil(totalNeeded * (1 + tolerance));
      const result = findCombinationWithTolerance(
        totalNeeded,
        maxAcceptableAmount,
        denomCounts,
        availableProofs
      );

      if (!result.canMake) {
        return { canMake: false };
      }

      // Count the number of proofs in the solution
      const currentProofCount = result.selectedProofs!.length;

      // Calculate the fee for this number of proofs
      const requiredFee = Math.ceil(currentProofCount * fees);

      // Check if we've converged (total amount covers both target and fees)
      const currentTotal = result.selectedProofs!.reduce(
        (sum, p) => sum + p.amount,
        0
      );
      const minimumRequired = targetAmount + requiredFee;
      const maximumAcceptable = Math.ceil(minimumRequired * (1 + tolerance));

      if (
        currentTotal >= minimumRequired &&
        currentTotal <= maximumAcceptable
      ) {
        // We found an acceptable solution within tolerance
        return {
          canMake: true,
          selectedProofs: result.selectedProofs,
          actualAmount: currentTotal,
        };
      }

      // Update totalNeeded for next iteration
      totalNeeded = minimumRequired;

      // Check if we're stuck in a loop
      if (
        currentProofCount === previousProofCount &&
        currentTotal < minimumRequired
      ) {
        // We're not making progress, can't satisfy the fee requirement
        return { canMake: false };
      }

      previousProofCount = currentProofCount;
    }

    // If we hit max iterations, we couldn't find a solution
    return { canMake: false };
  }

  // No fees, but still apply error tolerance
  const maxAcceptableAmount = Math.ceil(targetAmount * (1 + tolerance));
  const result = findCombinationWithTolerance(
    targetAmount,
    maxAcceptableAmount,
    denomCounts,
    availableProofs
  );

  if (result.canMake && result.selectedProofs) {
    const actualAmount = result.selectedProofs.reduce(
      (sum, p) => sum + p.amount,
      0
    );
    return {
      canMake: true,
      selectedProofs: result.selectedProofs,
      actualAmount,
    };
  }

  return { canMake: false };
}

/**
 * Helper function to find combination with error tolerance
 */
function findCombinationWithTolerance(
  targetAmount: number,
  maxAmount: number,
  denomCounts: Record<number, number>,
  availableProofs: Proof[]
): { canMake: boolean; selectedProofs?: Proof[] } {
  // First try exact amount
  let result = findExactCombination(targetAmount, denomCounts, availableProofs);
  if (result.canMake) {
    return result;
  }

  // If exact amount doesn't work, try amounts within tolerance
  for (let amount = targetAmount + 1; amount <= maxAmount; amount++) {
    result = findExactCombination(amount, denomCounts, availableProofs);
    if (result.canMake) {
      return result;
    }
  }

  return { canMake: false };
}

/**
 * Helper function to find exact combination using dynamic programming
 */
function findExactCombination(
  targetAmount: number,
  denomCounts: Record<number, number>,
  availableProofs: Proof[]
): { canMake: boolean; selectedProofs?: Proof[] } {
  // Use dynamic programming with proper denomination counting
  const denominations = Object.keys(denomCounts)
    .map(Number)
    .sort((a, b) => a - b); // Sort ascending for DP

  // Create a map to track which denominations are used to reach each amount
  const dp: Map<number, Record<number, number>> = new Map();
  dp.set(0, {}); // Base case: 0 can be made with no coins

  for (let amount = 1; amount <= targetAmount; amount++) {
    for (const denom of denominations) {
      if (amount >= denom) {
        const prevAmount = amount - denom;
        const prevSolution = dp.get(prevAmount);

        if (prevSolution !== undefined) {
          const prevDenomCount = prevSolution[denom] || 0;

          // Check if we can use another coin of this denomination
          if (prevDenomCount < denomCounts[denom]) {
            const newSolution = { ...prevSolution };
            newSolution[denom] = prevDenomCount + 1;

            // Only update if we haven't found a solution for this amount yet
            // or if this solution uses fewer total coins
            const currentSolution = dp.get(amount);
            if (!currentSolution) {
              dp.set(amount, newSolution);
            }
          }
        }
      }
    }
  }

  const finalSolution = dp.get(targetAmount);
  if (finalSolution) {
    // We found a solution! Now select the actual proofs
    const selectedProofs: Proof[] = [];

    for (const [denomStr, count] of Object.entries(finalSolution)) {
      const denom = Number(denomStr);
      const proofsOfDenom = availableProofs.filter((p) => p.amount === denom);

      // Make sure we have enough proofs of this denomination
      if (proofsOfDenom.length < count) {
        console.error(
          `Not enough proofs of denomination ${denom}: need ${count}, have ${proofsOfDenom.length}`
        );
        return { canMake: false };
      }

      selectedProofs.push(...proofsOfDenom.slice(0, count));
    }

    // Verify the sum is correct
    const totalSum = selectedProofs.reduce((sum, p) => sum + p.amount, 0);
    if (totalSum !== targetAmount) {
      console.error(`Sum mismatch: expected ${targetAmount}, got ${totalSum}`);
      return { canMake: false };
    }

    return { canMake: true, selectedProofs };
  }

  return { canMake: false };
}

/**
 * Advanced proof selection with tolerance fallback
 * This function implements the logic for selecting proofs when wallet.send() fails
 * @param amount The target amount to send
 * @param proofs Available proofs
 * @param activeKeysets Active keysets for fee calculation
 * @param mintUrl Mint URL for error messages
 * @returns Object with proofs to send and keep
 */
export function selectProofsAdvanced(
  amount: number,
  proofs: Proof[],
  activeKeysets: Keyset[],
  mintUrl: string
): {
  proofsToSend: Proof[];
  proofsToKeep: Proof[];
  actualAmount?: number;
  overpayment?: number;
  overpaymentPercent?: number;
} {
  // Check if we have enough funds
  const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0);
  if (totalAmount < amount) {
    throw new Error(
      `Not enough funds on mint ${mintUrl}: have ${totalAmount}, need ${amount}`
    );
  }

  // Get denomination counts
  const denominationCounts = proofs.reduce(
    (acc, p) => {
      acc[p.amount] = (acc[p.amount] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>
  );

  // Try with 0% tolerance first
  let toleranceResult = canMakeExactChange(amount, denominationCounts, proofs);
  let proofsToKeep: Proof[], proofsToSend: Proof[];

  // If 0% fails, try with 5% tolerance
  if (!toleranceResult.canMake || !toleranceResult.selectedProofs) {
    console.log(
      "rdlogs: Cannot make exact change with 0% tolerance, trying with 5% tolerance"
    );
    const fees = calculateFees(proofs, activeKeysets);
    toleranceResult = canMakeExactChange(
      amount,
      denominationCounts,
      proofs,
      fees,
      0.05
    );
  }

  if (toleranceResult.canMake && toleranceResult.selectedProofs) {
    const selectedDenominations = toleranceResult.selectedProofs
      .map((p) => p.amount)
      .sort((a, b) => b - a);
    const denominationBreakdown = selectedDenominations.reduce(
      (acc, denom) => {
        acc[denom] = (acc[denom] || 0) + 1;
        return acc;
      },
      {} as Record<number, number>
    );

    const actualAmount = toleranceResult.actualAmount || 0;
    const overpayment = actualAmount - amount;
    const overpaymentPercent = (overpayment / amount) * 100;

    console.log(
      "rdlogs: Can make change within tolerance after wallet.send() failure"
    );
    console.log("rdlogs: Target amount:", amount);
    console.log("rdlogs: Actual amount:", actualAmount);
    console.log(
      "rdlogs: Overpayment:",
      overpayment,
      `(${overpaymentPercent.toFixed(2)}%)`
    );
    console.log("rdlogs: Selected denominations:", selectedDenominations);
    console.log("rdlogs: Denomination breakdown:", denominationBreakdown);

    proofsToSend = toleranceResult.selectedProofs;
    proofsToKeep = proofs.filter((p) => !proofsToSend.includes(p));

    return {
      proofsToSend,
      proofsToKeep,
      actualAmount,
      overpayment,
      overpaymentPercent,
    };
  } else {
    throw new Error(
      `Cannot make change for amount ${amount} within tolerance on mint ${mintUrl}`
    );
  }
}
