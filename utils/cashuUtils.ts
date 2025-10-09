import { Event } from "nostr-tools";
import { GiftWrap, wrapCashuToken, unwrapCashuToken } from "./nip60Utils";
import { CashuMint, CashuWallet, getEncodedTokenV4, getDecodedToken } from "@cashu/cashu-ts";
import { getLocalCashuToken, setLocalCashuToken, removeLocalCashuToken, getLocalCashuTokens, CashuTokenEntry } from '@/utils/storageUtils';


/**
 * Gets both wallet + current Token balance from stored proofs and routstr API
 * @param mintUrl The Cashu mint URL
 * @param baseUrl The API base URL  
 * @param tokenAmount Amount in sats for token creation if needed (defaults to 12)
 * @returns The total balance in mSats
 */
export const MSATS_PER_SAT = 1000;

export const fetchBalances = async (mintUrl: string, baseUrl: string): Promise<{apiBalance:number, proofsBalance:number}> => {
  let apiBalance = 0;
  let proofsBalance = 0;

  try {
    const token = getLocalCashuToken(baseUrl); // Use getLocalCashuToken

    if (token) {
      const response = await fetch(`${baseUrl}v1/wallet/info`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 402) {
          // Invalidate current token since it's out of balance
          invalidateApiToken(baseUrl); // Pass baseUrl
          console.warn('rdlogs: API token invalidated due to insufficient balance.');
        } else {
          console.error(`Failed to fetch wallet balance: ${response.status} ${response.statusText}`);
        }
      } else {
        const data = await response.json();
        apiBalance = data.balance;
        if (apiBalance > 0) {
          // Refund remaining balance, but still report the balance that was found
          await refundRemainingBalance(mintUrl, baseUrl);
          apiBalance = 0;
        }
      }
    }
  } catch (error) {
    console.error("Error fetching API balance:", error);
    // apiBalance remains 0 on error, which is desired fallback behavior
  }

  // Always get proofs balance, regardless of API call success
  proofsBalance = getBalanceFromStoredProofs() * MSATS_PER_SAT;

  return {apiBalance, proofsBalance};
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
    // Check if amount is a decimal and round up if necessary
    if (amount % 1 !== 0) {
      amount = Math.ceil(amount);
    }

    // Get stored proofs
    const storedProofs = localStorage.getItem("cashu_proofs");
    if (!storedProofs) {
      console.warn("No Cashu tokens found for generating API token");
      return null;
    }

    const proofs = JSON.parse(storedProofs);

    // Initialize wallet for this mint
    const mint = new CashuMint(mintUrl);
    const keysets = await mint.getKeySets();
    
    // Get preferred unit: msat over sat if both are active
    const activeKeysets = keysets.keysets.filter(k => k.active);
    const units = [...new Set(activeKeysets.map(k => k.unit))];
    const preferredUnit = units.includes('msat') ? 'msat' : (units.includes('sat') ? 'sat' : 'not supported');
    
    const wallet = new CashuWallet(mint, { unit: preferredUnit });
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
  amount: number,
  baseUrl: string // Add baseUrl parameter
): Promise<string | null | { hasTokens: false }> => {
  try {
    // Try to get existing token for the given baseUrl
    const storedToken = getLocalCashuToken(baseUrl);
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
      setLocalCashuToken(baseUrl, newToken); // Use setLocalCashuToken
      return newToken;
    }

    return null;
  } catch (error) {
    console.error("Error in token management:", error);
    return null;
  }
};

export const fetchRefundToken = async (baseUrl: string, storedToken: string): Promise<{
  success: boolean;
  token?: string;
  requestId?: string;
  error?: string;
}> => {
  if (!baseUrl) {
    return {
      success: false,
      error: 'No base URL configured'
    };
  }

  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  // Create an AbortController for timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 60000); // 1 minute timeout

  try {
    const response = await fetch(`${normalizedBaseUrl}v1/wallet/refund`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${storedToken}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const requestId = response.headers.get('x-routstr-request-id') || undefined;

    if (!response.ok) {
      const errorData = await response.json();
      if (response.status === 400 && errorData?.detail === "No balance to refund") {
        invalidateApiToken(baseUrl);
        return {
          success: false,
          requestId,
          error: 'No balance to refund'
        };
      }
      return {
        success: false,
        requestId,
        error: `Refund request failed with status ${response.status}: ${errorData?.detail || response.statusText}`
      };
    }
    
    const data = await response.json();
    return {
      success: true,
      token: data.token,
      requestId
    };
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Request timed out after 1 minute'
        };
      }
      return {
        success: false,
        error: error.message
      };
    }
    
    return {
      success: false,
      error: 'Unknown error occurred during refund request'
    };
  }
};

export const storeCashuToken = async (mintUrl: string, token: string): Promise<void> => {
  const mint = new CashuMint(mintUrl);
  const keysets = await mint.getKeySets();
  
  // Get preferred unit: msat over sat if both are active
  const activeKeysets = keysets.keysets.filter(k => k.active);
  const units = [...new Set(activeKeysets.map(k => k.unit))];
  const preferredUnit = units.includes('msat') ? 'msat' : (units.includes('sat') ? 'sat' : 'not supported');
  
  const wallet = new CashuWallet(mint, { unit: preferredUnit });
  await wallet.loadMint();

  const result = await wallet.receive(token);
  const proofs = Array.isArray(result) ? result : [];

  if (proofs && proofs.length > 0) {
    const storedProofs = localStorage.getItem('cashu_proofs');
    const existingProofs = storedProofs ? JSON.parse(storedProofs) : [];
    localStorage.setItem('cashu_proofs', JSON.stringify([...existingProofs, ...proofs]));
  }
};

export const refundRemainingBalance = async (mintUrl: string, baseUrl: string, apiKey?: string): Promise<{ success: boolean; message?: string }> => {
  try {
    const storedToken = apiKey || getLocalCashuToken(baseUrl); // Use getLocalCashuToken
    if (!storedToken) {
      return { success: true, message: 'No apiKey to refund' };
    }

    try {
      const refundResult = await fetchRefundToken(baseUrl, storedToken);
      if (refundResult.success && refundResult.token) {
        await storeCashuToken(mintUrl, refundResult.token);
        invalidateApiToken(baseUrl); // Pass baseUrl
        return { success: true, message: 'Refund completed successfully' };
      } else if (refundResult.error === 'No balance to refund') {
        return { success: true, message: 'No balance to refund' };
      } else {
        return { success: false, message: refundResult.error || 'Refund failed' };
      }
    } catch (error) {
      throw error; // Re-throw other errors
    }
  } catch (error) {
    console.error("Error refunding balance:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred during refund'
    };
  }
};

/**
 * Invalidates the current API token
 */
export const invalidateApiToken = (baseUrl: string) => { // Add baseUrl parameter
  removeLocalCashuToken(baseUrl); // Use removeLocalCashuToken
};


export const create60CashuToken = async (
  activeMintUrl: string,
  sendToken: (mintUrl: string, amount: number) => Promise<{ proofs: any[], unit: string }>,
  amount: number
): Promise<string | undefined> => {
  // Check if amount is a decimal and round up if necessary
  if (amount % 1 !== 0) {
    amount = Math.ceil(amount);
  }

  if (!activeMintUrl) {
    console.error(
      "No active mint selected. Please select a mint in your wallet settings."
    );
    return;
  }

  if (!amount || isNaN((amount))) {
    console.error("Please enter a valid amount");
    return;
  }

  try {
    const result = await sendToken(activeMintUrl, amount);
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
    
    return token;
  } catch (error) {
    console.error("Error generating token:", error);
    console.error(error instanceof Error ? error.message : String(error));
  }
};

export type UnifiedRefundResult = {
  success: boolean;
  refundedAmount?: number;
  message?: string;
  requestId?: string;
};

export const unifiedRefund = async (
  mintUrl: string,
  baseUrl: string,
  usingNip60: boolean,
  receiveTokenFn: (token: string) => Promise<any[]>,
  apiKey?: string
): Promise<UnifiedRefundResult> => {
  if (usingNip60) {
    const storedToken = apiKey || getLocalCashuToken(baseUrl); // Use getLocalCashuToken
    if (!storedToken) {
      return { success: true, message: 'No API key to refund' };
    }
    
    try {

      const refundResult = await fetchRefundToken(baseUrl, storedToken);
      
      if (!refundResult.success) {
        return {
          success: false,
          message: refundResult.error || 'Refund failed',
          requestId: refundResult.requestId
        };
      }
      
      if (!refundResult.token) {
        return {
          success: false,
          message: 'No token received from refund',
          requestId: refundResult.requestId
        };
      }
      
      const proofs = await receiveTokenFn(refundResult.token);
      const totalAmount = proofs.reduce((sum: number, p: any) => sum + p.amount, 0);
      if (!apiKey) {
        invalidateApiToken(baseUrl); // Pass baseUrl
      }
      
      return {
        success: true,
        refundedAmount: totalAmount,
        requestId: refundResult.requestId
      };
    } catch (error) {
      if (usingNip60) {
        if (error instanceof Error && error.message.includes("NetworkError when attempting to fetch resource.")) {
          return {
            success: false,
            message: "Failed to connect to the mint: " + ((error as any).mintUrl || mintUrl)
          }
        }
        else if (error instanceof Error && error.message.includes("Wallet not found")) {
          return {
            success: false,
            message: "Wallet couldn't be loaded. Pls save this refunded cashu token: " + ((error as any).token)
          }
        }
      }
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Refund failed'
      };
    }
  } else {
    return await refundRemainingBalance(mintUrl, baseUrl, apiKey);
  }
};

export const getPendingCashuTokenAmount = (): number => {
  const allTokens = getLocalCashuTokens(); // Get all stored tokens
  let totalPendingAmount = 0;

  allTokens.forEach((tokenEntry: CashuTokenEntry) => {
    try {
      const decodedToken = getDecodedToken(tokenEntry.token);
      const msatOrSat = decodedToken.unit === 'msat' ? 1000 : 1;
      decodedToken.proofs.forEach((proof: { amount: number; }) => {
        totalPendingAmount += (proof.amount/msatOrSat);
      });
      if (decodedToken) {
        
      }
    } catch (error) {
      console.error(`Error decoding cashu token for baseUrl ${tokenEntry.baseUrl}:`, error);
    }
  });
  return totalPendingAmount;
};
