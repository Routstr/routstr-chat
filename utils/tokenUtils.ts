import { getOrCreateApiToken } from '@/utils/cashuUtils';
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import { getLocalCashuToken, setLocalCashuToken, removeLocalCashuToken } from '@/utils/storageUtils';

// Default token amount for models without max_cost defined
export const DEFAULT_TOKEN_AMOUNT = 50;

/**
 * Manages token lifecycle for NIP-60 - reuses existing token or generates new one
 * @param mintUrl The Cashu mint URL
 * @param amount Amount in sats for new token if needed
 * @param sendToken Function to send tokens from the wallet
 * @param activeMintUrl The currently active mint URL
 * @returns Token string, null if failed, or object with hasTokens: false if no tokens available
 */
export const getOrCreate60ApiToken = async (
  mintUrl: string,
  amount: number,
  sendToken: (mintUrl: string, amount: number) => Promise<{ proofs: any[], unit: string }>,
  activeMintUrl: string | null,
  baseUrl: string // Add baseUrl parameter
): Promise<string | null | { hasTokens: false }> => {
  try {
    // Try to get existing token for the given baseUrl
    const storedToken = getLocalCashuToken(baseUrl);
    if (storedToken) {
      return storedToken;
    }

    // Generate new token if none exists
    if (!activeMintUrl) {
      console.error("No active mint selected. Please select a mint in your wallet settings.");
      return null;
    }

    // Check if amount is a decimal and round up if necessary
    let adjustedAmount = amount;
    if (amount % 1 !== 0) {
      adjustedAmount = Math.ceil(amount);
    }

    if (!adjustedAmount || isNaN(adjustedAmount)) {
      console.error("Please enter a valid amount");
      return null;
    }

    try {
      const result = await sendToken(activeMintUrl, adjustedAmount);
      const proofs = result.proofs;
      const token = getEncodedTokenV4({
        mint: activeMintUrl,
        proofs: proofs.map((p) => ({
          id: p.id || "",
          amount: p.amount,
          secret: p.secret || "",
          C: p.C || "",
        })),
        unit: result.unit
      });
      
      // Clean up pending proofs after successful token creation
      if ((proofs as any).pendingProofsKey) {
        localStorage.removeItem((proofs as any).pendingProofsKey);
      }
      
      if (token) {
        setLocalCashuToken(baseUrl, token);
        return token;
      }
    } catch (error) {
      console.error("Error generating token:", error);
      console.error(error instanceof Error ? error.message : String(error));
    }

    return null;
  } catch (error) {
    console.error("Error in token management:", error);
    return null;
  }
};

/**
 * Gets the appropriate token based on the wallet type being used
 * @param usingNip60 Whether using NIP-60 wallet or legacy wallet
 * @param mintUrl The Cashu mint URL
 * @param amount Amount in sats for new token if needed
 * @param sendToken Function to send tokens from NIP-60 wallet
 * @param activeMintUrl The currently active mint URL for NIP-60
 * @returns Token string, null if failed, or object with hasTokens: false if no tokens available
 */
export const getTokenForRequest = async (
  usingNip60: boolean,
  mintUrl: string,
  amount: number,
  baseUrl: string, // Move baseUrl to be a required parameter before optional ones
  sendToken?: (mintUrl: string, amount: number) => Promise<{ proofs: any[], unit: string }>,
  activeMintUrl?: string | null
): Promise<string | null | { hasTokens: false }> => {
  if (usingNip60) {
    if (!sendToken || !activeMintUrl) {
      console.error("Missing required parameters for NIP-60 token creation");
      return null;
    }
    return await getOrCreate60ApiToken(activeMintUrl, amount, sendToken, activeMintUrl, baseUrl); // Pass baseUrl
  } else {
    return await getOrCreateApiToken(mintUrl, amount, baseUrl); // Pass baseUrl
  }
};

/**
 * Invalidates the current API token stored in localStorage for a given base URL
 * @param baseUrl The base URL of the token to invalidate
 */
export const clearCurrentApiToken = (baseUrl: string): void => {
  removeLocalCashuToken(baseUrl);
};

/**
 * Gets the token amount to use for a model, with fallback to default
 * @param selectedModel The currently selected model
 * @returns The token amount in sats
 */
export const getTokenAmountForModel = (selectedModel: any, apiMessages: any[]): number => {
  const approximateTokens = Math.ceil(JSON.stringify(apiMessages, null, 2).length / 2.84);
  if (!selectedModel?.sats_pricing?.max_completion_cost) {
    return selectedModel?.sats_pricing?.max_cost ?? DEFAULT_TOKEN_AMOUNT;
  }
  const promptCosts = selectedModel?.sats_pricing?.prompt * approximateTokens;
  const totalEstimatedCosts = promptCosts + selectedModel?.sats_pricing?.max_completion_cost;
  return (totalEstimatedCosts * 1.05); // Added a 5% margin
};