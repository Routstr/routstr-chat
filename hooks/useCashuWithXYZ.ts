import { useState, useEffect, useCallback, useRef } from 'react';
import { useCashuToken } from '@/features/wallet/hooks/useCashuToken';
import { useCashuStore, useCashuWallet, useCreateCashuWallet } from '@/features/wallet';
import { calculateBalanceByMint } from '@/features/wallet';
import { getBalanceFromStoredProofs, getPendingCashuTokenAmount, fetchBalances, getPendingCashuTokenDistribution } from '@/utils/cashuUtils';
import { useWalletOperations } from '@/features/wallet/hooks/useWalletOperations';
import { getLocalCashuToken, setLocalCashuToken } from '@/utils/storageUtils';
import { loadTransactionHistory, saveTransactionHistory } from '@/utils/storageUtils';
import { DEFAULT_MINT_URL } from '@/lib/utils';
import { TransactionHistory } from '@/types/chat';
import { Proof } from '@cashu/cashu-ts';
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import { useAuth } from '@/context/AuthProvider';
import React from 'react';

/**
 * Hook that manages Cashu wallet operations, balance tracking, and token spending/storing
 * Moved from useChatActions to separate balance/spend concerns from chat logic
 */
export function useCashuWithXYZ() {
  // Balance and wallet state
  const [balance, setBalance] = useState(0);
  const [currentMintUnit, setCurrentMintUnit] = useState('sat');
  const [isBalanceLoading, setIsBalanceLoading] = useState(true);
  const [pendingCashuAmountState, setPendingCashuAmountState] = useState(0);
  const [transactionHistory, setTransactionHistoryState] = useState<TransactionHistory[]>([]);
  const [hotTokenBalance, setHotTokenBalance] = useState<number>(0);

  // Cashu wallet hooks
  const { isAuthenticated } = useAuth();
  const { wallet, isLoading: isWalletLoading, didRelaysTimeout } = useCashuWallet();
  const cashuStore = useCashuStore();
  const usingNip60 = cashuStore.getUsingNip60();
  const { sendToken, receiveToken, cleanSpentProofs } = useCashuToken();
  const { logins } = useAuth();
  const { mutate: handleCreateWallet, isPending: isCreatingWallet, error: createWalletError } = useCreateCashuWallet();

  // Load transaction history on mount
  useEffect(() => {
    const history = loadTransactionHistory();
    setTransactionHistoryState(history);
  }, []);

  // Calculate mint balances
  const { balances: mintBalances, units: mintUnits } = React.useMemo(() => {
    if (!cashuStore.proofs) return { balances: {}, units: {} };
    return calculateBalanceByMint(cashuStore.proofs, cashuStore.mints);
  }, [cashuStore.proofs, cashuStore.mints]);

  useEffect(() => {
    setCurrentMintUnit(mintUnits[cashuStore.activeMintUrl??'']);
  }, [mintUnits, cashuStore.activeMintUrl]);

  // Update balance based on wallet type
  useEffect(() => {
    const fetchAndSetBalances = async () => {
      if (usingNip60) {
        if (isWalletLoading) {
          setIsBalanceLoading(true);
          setBalance(0);
        } else {
          setIsBalanceLoading(false);
          let totalBalance = 0;
          for (const mintUrl in mintBalances) {
            const balance = mintBalances[mintUrl];
            const unit = mintUnits[mintUrl];
            if (unit === 'msat') {
              totalBalance += (balance / 1000);
            } else {
              totalBalance += balance;
            }
          }
          setBalance(Math.round((totalBalance + pendingCashuAmountState)*100)/100);
        }
      } else {
        // Legacy wallet balance calculation would go here
        setIsBalanceLoading(false);
        setBalance(getBalanceFromStoredProofs() + pendingCashuAmountState);
      }
    };
    fetchAndSetBalances();
  }, [mintBalances, mintUnits, usingNip60, isWalletLoading, pendingCashuAmountState]);

  // Effect to listen for changes in localStorage for 'current_cashu_token'
  useEffect(() => {
    const updatePendingAmount = () => {
      console.log('rdlogs: pendigl', getPendingCashuTokenAmount())
      setPendingCashuAmountState(getPendingCashuTokenAmount());
    };

    // Initial update
    updatePendingAmount();

    // Listen for storage events
    window.addEventListener('storage', updatePendingAmount);

    // Cleanup
    return () => {
      window.removeEventListener('storage', updatePendingAmount);
    };
  }, [pendingCashuAmountState]);

  // Set active mint URL based on wallet and current mint URL
  useEffect(() => {
    if (logins.length > 0) {
      if (wallet) {
        const currentActiveMintUrl = cashuStore.getActiveMintUrl();
        
        // Only set active mint URL if it's not already set or if current one is not in wallet mints
        if (!currentActiveMintUrl || !wallet.mints?.includes(currentActiveMintUrl)) {
          if (wallet.mints?.includes(DEFAULT_MINT_URL)) {
            cashuStore.setActiveMintUrl(DEFAULT_MINT_URL);
          } else if (wallet.mints && wallet.mints.length > 0) {
            cashuStore.setActiveMintUrl(wallet.mints[0]);
          }
        }
      }

      if (!isWalletLoading) {
        
        if (didRelaysTimeout) {
          console.log('rdlogs: Skipping wallet creation due to relay timeout');
          return;
        }
        
        if (wallet) {
          console.log('rdlogs: Wallet found: ', wallet);
          // Call cleanSpentProofs for each mint in the wallet
          wallet.mints?.forEach(mint => {
            cleanSpentProofs(mint);
          });
        } else {
          console.log('rdlogs: No wallet found, creating new wallet');
          handleCreateWallet();
        }
      } else {
        console.log('rdlogs: Wallet still loading, skipping actions');
      }
    }
  }, [wallet, isWalletLoading, logins, handleCreateWallet, didRelaysTimeout]);

  // Auto-switch active mint to one that has balance if current has zero (NIP-60 only)
  useEffect(() => {
    if (!usingNip60) return;

    const activeUrl = cashuStore.getActiveMintUrl?.() ?? cashuStore.activeMintUrl;
    const activeBalance = activeUrl ? (mintBalances[activeUrl] ?? 0) : 0;

    // Respect user manual selection, even if empty
    if (cashuStore.userSelectedMintUrl && cashuStore.userSelectedMintUrl === activeUrl) {
      return;
    }

    // If current active has balance, keep it
    if (activeBalance > 0) return;

    // Find mint with highest non-zero balance
    const candidates = Object.entries(mintBalances).filter(([, balance]) => (balance ?? 0) > 0);
    if (candidates.length === 0) return;
    const [bestMint] = candidates.sort((a, b) => (b[1] as number) - (a[1] as number))[0];

    if (bestMint && bestMint !== activeUrl) {
      cashuStore.setActiveMintUrl(bestMint);
    }
  }, [usingNip60, mintBalances, cashuStore.activeMintUrl]);

  const setTransactionHistory = useCallback((value: React.SetStateAction<TransactionHistory[]>) => {
    setTransactionHistoryState(prev => {
      const newHistory = typeof value === 'function' ? value(prev) : value;
      saveTransactionHistory(newHistory);
      return newHistory;
    });
  }, []);

  const { generateTokenCore, initWallet } = useWalletOperations({
    mintUrl: DEFAULT_MINT_URL,
    baseUrl: '',
    setBalance: (balance: number | ((prevBalance: number) => number)) => {
      if (typeof balance === 'function') {
        setBalance(balance);
      } else {
        setBalance(balance);
      }
    },
    setTransactionHistory: setTransactionHistory,
    transactionHistory: transactionHistory
  });

  // Initialize wallet when component mounts or mintUrl changes
  useEffect(() => {
    const initializeWallet = async () => {
      try {
        await initWallet();
      } catch (error) {
        console.error('Failed to initialize wallet. Please try again.');
      }
    };

    if (isAuthenticated) {
      void initializeWallet();
    }
  }, [initWallet]);


  /**
   * Spend Cashu function with token management logic
   * @param mintUrl The mint URL to send tokens from
   * @param amount The amount to send
   * @param baseUrl The base URL for token storage
   * @param p2pkPubkey Optional public key for P2PK
   * @returns Promise with token string, null if failed, or object with hasTokens: false if no tokens available
   */
  const spendCashu = async (
    mintUrl: string, 
    amount: number, 
    baseUrl: string,
    p2pkPubkey?: string
  ): Promise<string | null | { hasTokens: false }> => {
    // Try to get existing token for the given baseUrl
    const storedToken = getLocalCashuToken(baseUrl);
    const pendingBalances = getPendingCashuTokenDistribution();

    // TODO: Implement useProviderBalancesSync instead of local storage once the nodes are all stable with the refunds. Too early. 
    if (storedToken) {
      const balanceForBaseUrl = pendingBalances.find(b => b.baseUrl === baseUrl)?.amount || 0;
      if (balanceForBaseUrl > amount) {
        return storedToken;
      }
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

    let token: string | null = null;

    if (usingNip60) {      // Generate new token if none exists
      if (!cashuStore.activeMintUrl) {
        console.error("No active mint selected. Please select a mint in your wallet settings.");
        return null;
      }

      try {
        token = await sendToken(cashuStore.activeMintUrl, adjustedAmount, p2pkPubkey);
      } catch (error) {
        console.error("Error generating token:", error);
        console.error(error instanceof Error ? error.message : String(error));
      }
    } else {
      try {
        // Use the generateTokenCore function from useWalletOperations
        token = await generateTokenCore(adjustedAmount, mintUrl);
        console.log('rdlogs: token', token);
      } catch (error) {
        console.error("Error generating legacy token:", error);
        console.error(error instanceof Error ? error.message : String(error));
      }
    }

    // Store token and return if successful
    if (token) {
      if (baseUrl !== '') {
        setLocalCashuToken(baseUrl, token);
      }
      return token;
    }

    return null;
  };

  /**
   * Store Cashu function
   * @param token The encoded token string
   * @returns Promise with received proofs
   */
  const storeCashu = async (token: string): Promise<Proof[]> => {
    return receiveToken(token);
  };

  return {
    // Balance and wallet state
    balance,
    setBalance,
    currentMintUnit,
    mintBalances,
    mintUnits,
    isBalanceLoading,
    pendingCashuAmountState,
    setPendingCashuAmountState,
    transactionHistory,
    setTransactionHistory,
    hotTokenBalance,
    setHotTokenBalance,
    usingNip60,
    
    // Wallet operations
    wallet,
    isWalletLoading,
    didRelaysTimeout,
    cashuStore,
    logins,
    handleCreateWallet,
    isCreatingWallet,
    createWalletError,
    
    // Token operations
    spendCashu,
    storeCashu,
    cleanSpentProofs
  };
}
