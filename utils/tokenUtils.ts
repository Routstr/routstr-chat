import { create60CashuToken, getOrCreateApiToken } from '@/utils/cashuUtils';
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
      console.error("No active mint selected");
      return null;
    }
    
    const newToken = await create60CashuToken(activeMintUrl, sendToken, amount);
    if (newToken) {
      setLocalCashuToken(baseUrl, newToken); // Use baseUrl here
      return newToken;
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
export const getTokenAmountForModel = (selectedModel: any, approximateTokens: number): number => {
  if (!selectedModel?.sats_pricing?.max_completion_cost) {
    return selectedModel?.sats_pricing?.max_cost ?? DEFAULT_TOKEN_AMOUNT;
  }
  const promptCosts = selectedModel?.sats_pricing?.prompt * approximateTokens;
  const totalEstimatedCosts = promptCosts + selectedModel?.sats_pricing?.max_completion_cost;
  console.log("rdlogs: totalEstimatedCosts", totalEstimatedCosts)
  return totalEstimatedCosts ?? DEFAULT_TOKEN_AMOUNT;
};