import { Event } from "nostr-tools";
import { GiftWrap, wrapCashuToken, unwrapCashuToken } from "./nip60Utils";
import { CashuMint, CashuWallet } from "@cashu/cashu-ts";


/**
 * Gets both wallet + current Token balance from stored proofs and routstr API
 * @returns The total balance in mSats
 */
export const fetchBalances = async (mintUrl: string): Promise<{apiBalance:number, proofsBalance:number}> => {
  const makeBalanceRequest = async (retryOnInsufficientBalance: boolean = true): Promise<{apiBalance:number, proofsBalance:number}> => {
    const token = await getOrCreateApiToken(mintUrl, 12);

    if (!token) {
      throw new Error('No token available');
    }

    if (typeof token === 'object' && 'hasTokens' in token && !token.hasTokens) {
      throw new Error('No tokens available for balance check');
    }

    const response = await fetch(`${process.env.NEXT_PUBLIC_ROUTSTR_PROXY_URL || 'https://api.routstr.com'}/v1/wallet/`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      // Handle insufficient balance (402)
      if (response.status === 402 && retryOnInsufficientBalance) {
        // Invalidate current token since it's out of balance
        invalidateApiToken();

        // Try to create a new token and retry once
        const newToken = await getOrCreateApiToken(mintUrl, 12);

        if (!newToken || (typeof newToken === 'object' && 'hasTokens' in newToken && !newToken.hasTokens)) {
          throw new Error('No tokens available for balance check');
        }

        // Recursive call with retry flag set to false to prevent infinite loops
        return makeBalanceRequest(false);
      }

      throw new Error('Failed to fetch wallet balance');
    }

    const data = await response.json();
    const apiBalance = data.balance;
    const proofsBalance = getBalanceFromStoredProofs() * 1000; // to convert it into mSats

    return {apiBalance, proofsBalance};
  };

  try {
    const {apiBalance, proofsBalance} = await makeBalanceRequest();
    return {apiBalance, proofsBalance};
  } catch (error) {
    // Fall back to just proofs balance if API fails
    const proofsBalance = getBalanceFromStoredProofs();
    return {apiBalance: 0, proofsBalance};
  }
};

/**
 * Gets the current balance from stored proofs
 * @returns The total balance in sats
 */
export const getBalanceFromStoredProofs = (): number => {
  try {
    const storedProofs = localStorage.getItem("cashu_proofs");
    if (!storedProofs) return 0;

    const proofs = JSON.parse(storedProofs);
    return proofs.reduce(
      (total: number, proof: any) => total + proof.amount,
      0
    );
  } catch (error) {
    console.error("Error getting balance:", error);
    return 0;
  }
};

/**
 * Store a wrapped Cashu token in local storage
 * @param wrappedToken The NIP-60 wrapped token event
 */
export const storeWrappedToken = (wrappedToken: Event): void => {
  try {
    const storedTokens = localStorage.getItem("wrapped_cashu_tokens") || "[]";
    const tokens = JSON.parse(storedTokens);
    tokens.push(wrappedToken);
    localStorage.setItem("wrapped_cashu_tokens", JSON.stringify(tokens));
  } catch (error) {
    console.error("Error storing wrapped token:", error);
  }
};

/**
 * Get all stored wrapped tokens
 * @returns Array of wrapped token events
 */
export const getStoredWrappedTokens = (): Event[] => {
  try {
    const storedTokens = localStorage.getItem("wrapped_cashu_tokens");
    if (!storedTokens) return [];
    return JSON.parse(storedTokens);
  } catch (error) {
    console.error("Error getting wrapped tokens:", error);
    return [];
  }
};

/**
 * Remove a wrapped token from storage
 * @param tokenId The event ID of the wrapped token to remove
 */
export const removeWrappedToken = (tokenId: string): void => {
  try {
    const tokens = getStoredWrappedTokens();
    const updatedTokens = tokens.filter((token) => token.id !== tokenId);
    localStorage.setItem("wrapped_cashu_tokens", JSON.stringify(updatedTokens));
  } catch (error) {
    console.error("Error removing wrapped token:", error);
  }
};

/**
 * Generates a new Cashu token for API usage
 * @param mintUrl The Cashu mint URL
 * @param amount Amount in sats to generate token for
 * @returns Generated token string or null if failed
 */
export const generateApiToken = async (
  mintUrl: string,
  amount: number
): Promise<string | null> => {
  try {
    // Get stored proofs
    const storedProofs = localStorage.getItem("cashu_proofs");
    if (!storedProofs) {
      console.warn("No Cashu tokens found for generating API token");
      return null;
    }

    const proofs = JSON.parse(storedProofs);

    // Initialize wallet for this mint
    const mint = new CashuMint(mintUrl);
    const wallet = new CashuWallet(mint);
    await wallet.loadMint();

    // Generate the token using the wallet directly
    const { send, keep } = await wallet.send(amount, proofs);

    if (!send || send.length === 0) {
      return null;
    }

    // Update stored proofs with remaining proofs
    localStorage.setItem("cashu_proofs", JSON.stringify(keep));

    // Create a token string in the proper Cashu format
    const tokenObj = {
      token: [{ mint: mintUrl, proofs: send }],
    };

    return `cashuA${btoa(JSON.stringify(tokenObj))}`;
  } catch (error) {
    if (error instanceof Error && error.message.includes('funds')) {
      return null;
    }
    // Only log unexpected errors
    console.error("Failed to generate API token:", error);
    return null;
  }
};

/**
 * Manages token lifecycle - reuses existing token or generates new one
 * @param mintUrl The Cashu mint URL
 * @param amount Amount in sats for new token if needed
 * @returns Token string, null if failed, or object with hasTokens: false if no tokens available
 */
export const getOrCreateApiToken = async (
  mintUrl: string,
  amount: number
): Promise<string | null | { hasTokens: false }> => {
  try {
    // Try to get existing token
    const storedToken = localStorage.getItem("current_cashu_token");
    if (storedToken) {
      return storedToken;
    }

    // Check if any tokens are available
    const storedProofs = localStorage.getItem("cashu_proofs");
    if (!storedProofs) {
      return { hasTokens: false };
    }

    // Generate new token if none exists
    const newToken = await generateApiToken(mintUrl, amount);
    if (newToken) {
      localStorage.setItem("current_cashu_token", newToken);
      return newToken;
    }

    return null;
  } catch (error) {
    console.error("Error in token management:", error);
    return null;
  }
};

/**
 * Invalidates the current API token
 */
export const invalidateApiToken = () => {
  localStorage.removeItem("current_cashu_token");
};
