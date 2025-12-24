import { useState, useEffect, useCallback, useRef } from "react";
import { useCashuToken } from "@/features/wallet/hooks/useCashuToken";
import {
  useCashuStore,
  useCashuWallet,
  useCreateCashuWallet,
} from "@/features/wallet";
import { calculateBalanceByMint } from "@/features/wallet";
import {
  getBalanceFromStoredProofs,
  getPendingCashuTokenAmount,
  fetchBalances,
  getPendingCashuTokenDistribution,
  unifiedRefund,
} from "@/utils/cashuUtils";
import { useWalletOperations } from "@/features/wallet/hooks/useWalletOperations";
import {
  getLocalCashuToken,
  loadMintsFromAllProviders,
  removeLocalCashuToken,
  setLocalCashuToken,
  setProviderMints,
} from "@/utils/storageUtils";
import {
  loadTransactionHistory,
  saveTransactionHistory,
} from "@/utils/storageUtils";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import { TransactionHistory } from "@/types/chat";
import { Proof } from "@cashu/cashu-ts";
import { useAuth } from "@/context/AuthProvider";
import React from "react";

export interface SpendCashuResult {
  token: string | null;
  status: "success" | "failed";
  balance: number;
  error?: string;
}

/**
 * Hook that manages Cashu wallet operations, balance tracking, and token spending/storing
 * Moved from useChatActions to separate balance/spend concerns from chat logic
 */
export function useCashuWithXYZ() {
  // Balance and wallet state
  const [balance, setBalance] = useState(0);
  const [maxBalance, setMaxBalance] = useState(0);
  const [currentMintUnit, setCurrentMintUnit] = useState("sat");
  const [isBalanceLoading, setIsBalanceLoading] = useState(true);
  const [pendingCashuAmountState, setPendingCashuAmountState] = useState(0);
  const [transactionHistory, setTransactionHistoryState] = useState<
    TransactionHistory[]
  >([]);
  const [hotTokenBalance, setHotTokenBalance] = useState<number>(0);

  // Cashu wallet hooks
  const { isAuthenticated } = useAuth();
  const {
    wallet,
    isLoading: isWalletLoading,
    didRelaysTimeout,
  } = useCashuWallet();
  const cashuStore = useCashuStore();
  const usingNip60 = cashuStore.getUsingNip60();
  const { sendToken, receiveToken, cleanSpentProofs } = useCashuToken();
  const { logins } = useAuth();
  const {
    mutate: handleCreateWallet,
    isPending: isCreatingWallet,
    error: createWalletError,
  } = useCreateCashuWallet();

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

  // Ensure default mint is set on initialization
  useEffect(() => {
    if (!cashuStore.activeMintUrl) {
      // Add default mint if not already in the store
      if (!cashuStore.mints.find((m) => m.url === DEFAULT_MINT_URL)) {
        cashuStore.addMint(DEFAULT_MINT_URL);
      } else {
        cashuStore.setActiveMintUrl(DEFAULT_MINT_URL);
      }
    }
  }, [cashuStore]);

  useEffect(() => {
    setCurrentMintUnit(mintUnits[cashuStore.activeMintUrl ?? ""]);
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
          let maxBalance = 0;
          for (const mintUrl in mintBalances) {
            const balance = mintBalances[mintUrl];
            const unit = mintUnits[mintUrl];
            if (unit === "msat") {
              totalBalance += balance / 1000;
              maxBalance = Math.max(maxBalance, balance / 1000);
            } else {
              totalBalance += balance;
              maxBalance = Math.max(maxBalance, balance);
            }
          }
          const balanceBeingSet = Math.round(totalBalance * 100) / 100;
          setBalance(balanceBeingSet);
          setMaxBalance(maxBalance);
        }
      } else {
        // Legacy wallet balance calculation would go here
        setIsBalanceLoading(false);
        setBalance(getBalanceFromStoredProofs() + pendingCashuAmountState);
      }
    };
    fetchAndSetBalances();
  }, [
    mintBalances,
    mintUnits,
    usingNip60,
    isWalletLoading,
    pendingCashuAmountState,
  ]);

  // Effect to listen for changes in localStorage for 'current_cashu_token'
  useEffect(() => {
    const updatePendingAmount = () => {
      setPendingCashuAmountState(getPendingCashuTokenAmount());
    };

    // Initial update
    updatePendingAmount();

    // Listen for storage events
    window.addEventListener("storage", updatePendingAmount);

    // Cleanup
    return () => {
      window.removeEventListener("storage", updatePendingAmount);
    };
  }, []); // Remove pendingCashuAmountState from deps to avoid stale closure

  // Set active mint URL based on wallet and current mint URL
  useEffect(() => {
    if (logins.length > 0) {
      if (wallet) {
        const currentActiveMintUrl = cashuStore.getActiveMintUrl();

        // Only set active mint URL if it's not already set or if current one is not in wallet mints
        if (
          !currentActiveMintUrl ||
          !wallet.mints?.includes(currentActiveMintUrl)
        ) {
          if (wallet.mints?.includes(DEFAULT_MINT_URL)) {
            cashuStore.setActiveMintUrl(DEFAULT_MINT_URL);
          } else if (wallet.mints && wallet.mints.length > 0) {
            cashuStore.setActiveMintUrl(wallet.mints[0]);
          }
        }
      }

      if (!isWalletLoading) {
        if (didRelaysTimeout) {
          console.log("rdlogs: Skipping wallet creation due to relay timeout");
          return;
        }

        if (wallet) {
          // Call cleanSpentProofs for each mint in the wallet
          wallet.mints?.forEach((mint) => {
            cleanSpentProofs(mint);
          });
        } else {
          console.log("rdlogs: No wallet found, creating new wallet");
          handleCreateWallet();
        }
      }
    }
  }, [wallet, isWalletLoading, logins, handleCreateWallet, didRelaysTimeout]);

  // Auto-switch active mint to one that has balance if current has zero (NIP-60 only)
  useEffect(() => {
    if (!usingNip60) return;

    const activeUrl =
      cashuStore.getActiveMintUrl?.() ?? cashuStore.activeMintUrl;
    const activeBalance = activeUrl ? (mintBalances[activeUrl] ?? 0) : 0;

    // Respect user manual selection, even if empty
    if (
      cashuStore.userSelectedMintUrl &&
      cashuStore.userSelectedMintUrl === activeUrl
    ) {
      return;
    }

    // If current active has balance, keep it
    if (activeBalance > 0) return;

    // Find mint with highest non-zero balance
    const candidates = Object.entries(mintBalances).filter(
      ([, balance]) => (balance ?? 0) > 0
    );
    if (candidates.length === 0) return;
    const [bestMint] = candidates.sort(
      (a, b) => (b[1] as number) - (a[1] as number)
    )[0];

    if (bestMint && bestMint !== activeUrl) {
      cashuStore.setActiveMintUrl(bestMint);
    }
  }, [usingNip60, mintBalances, cashuStore.activeMintUrl]);

  const setTransactionHistory = useCallback(
    (value: React.SetStateAction<TransactionHistory[]>) => {
      setTransactionHistoryState((prev) => {
        const newHistory = typeof value === "function" ? value(prev) : value;
        saveTransactionHistory(newHistory);
        return newHistory;
      });
    },
    []
  );

  const { generateTokenCore, initWallet } = useWalletOperations({
    mintUrl: DEFAULT_MINT_URL,
    baseUrl: "",
    setBalance: (balance: number | ((prevBalance: number) => number)) => {
      if (typeof balance === "function") {
        setBalance(balance);
      } else {
        setBalance(balance);
      }
    },
    setTransactionHistory: setTransactionHistory,
    transactionHistory: transactionHistory,
  });

  // Initialize wallet when component mounts or mintUrl changes
  useEffect(() => {
    const initializeWallet = async () => {
      try {
        await initWallet();
      } catch (error) {
        console.error("Failed to initialize wallet. Please try again.");
      }
    };

    if (isAuthenticated && false && process.env.NODE_ENV === "production") {
      void initializeWallet();
    }
  }, [initWallet]);

  /**
   * Selects a mint with sufficient balance, excluding specified mints
   * @param mintBalances Object mapping mint URLs to their balances
   * @param mintUnits Object mapping mint URLs to their units
   * @param adjustedAmount The required amount in sats
   * @param excludeMints Array of mint URLs to exclude from selection
   * @returns Object with selectedMintUrl and selectedMintBalance, or null/0 if none found
   */
  const selectMintWithBalance = (
    mintBalances: Record<string, number>,
    mintUnits: Record<string, string>,
    adjustedAmount: number,
    excludeMints: string[] = []
  ): { selectedMintUrl: string | null; selectedMintBalance: number } => {
    let selectedMintUrl: string | null = null;
    let selectedMintBalance = 0;

    for (const mintUrl in mintBalances) {
      // Skip excluded mints
      if (excludeMints.includes(mintUrl)) {
        continue;
      }

      const balance = mintBalances[mintUrl];
      const unit = mintUnits[mintUrl];
      let balanceInSats = 0;
      if (unit === "msat") {
        balanceInSats = balance / 1000;
      } else {
        balanceInSats = balance;
      }
      if (balanceInSats >= adjustedAmount) {
        selectedMintUrl = mintUrl;
        selectedMintBalance = balanceInSats;
        break;
      }
    }

    return { selectedMintUrl, selectedMintBalance };
  };

  /**
   * Spend Cashu function with token management logic
   * @param mintUrl The mint URL to send tokens from
   * @param amount The amount to send ALWAYS in sats
   * @param baseUrl The base URL for token storage
   * @param p2pkPubkey Optional public key for P2PK
   * @returns Promise with structured result containing token, status, balance, mint, and error message if failed
   */
  const spendCashu = async (
    mintUrl: string,
    amount: number, // Always in sats
    baseUrl: string,
    reuseToken: boolean = false,
    p2pkPubkey?: string,
    excludeMints: string[] = [],
    retryCount: number = 0
  ): Promise<SpendCashuResult> => {
    // Read latest balances/units from store to avoid stale closure
    let latestMintBalances = mintBalances;
    let latestMintUnits = mintUnits;
    // Check if amount is a decimal and round up if necessary
    let adjustedAmount = amount;
    if (amount % 1 !== 0) {
      adjustedAmount = Math.ceil(amount);
    }

    if (!adjustedAmount || isNaN(adjustedAmount)) {
      console.error("Please enter a valid amount");
      return {
        token: null,
        status: "failed",
        balance: 0,
        error: "Please enter a valid amount",
      };
    }

    // Try to get existing token for the given baseUrl
    const storedToken = getLocalCashuToken(baseUrl);
    let pendingBalances = getPendingCashuTokenDistribution();

    // TODO: Implement useProviderBalancesSync instead of local storage once the nodes are all stable with the refunds. Too early.
    if (storedToken && reuseToken) {
      const balanceForBaseUrl =
        pendingBalances.find((b) => b.baseUrl === baseUrl)?.amount || 0;
      if (balanceForBaseUrl > amount) {
        return {
          token: storedToken,
          status: "success",
          balance: balanceForBaseUrl,
        };
      } else {
        const refundResult = await unifiedRefund(
          mintUrl,
          baseUrl,
          usingNip60,
          receiveToken,
          storedToken
        );
        if (refundResult.success) {
          console.log(refundResult.message || "Refund completed successfully!");
          pendingBalances = getPendingCashuTokenDistribution();
        } else {
          console.error(refundResult.message || "Failed to complete refund.");
        }
      }
    }
    let nip60Balance = 0;
    const localBalance = getBalanceFromStoredProofs();
    if (retryCount > 0) {
      // If retrying, get the latest proofs from the store
      const proofs = await cashuStore.getAllProofs();
      latestMintBalances = calculateBalanceByMint(
        proofs,
        cashuStore.mints
      ).balances;
      latestMintUnits = calculateBalanceByMint(proofs, cashuStore.mints).units;
    }

    for (const mintUrl in latestMintBalances) {
      const balance = latestMintBalances[mintUrl];
      const unit = latestMintUnits[mintUrl];
      let balanceInSats = 0;
      if (unit === "msat") {
        balanceInSats = balance / 1000;
      } else {
        balanceInSats = balance;
      }
      nip60Balance += balanceInSats;
    }

    const totalPendingBalance = pendingBalances.reduce(
      (total, item) => total + item.amount,
      0
    );
    let totalBalance = nip60Balance + localBalance + totalPendingBalance;

    // If totalBalance is 0, refetch latest balances from store and recalculate
    if (totalBalance === 0) {
      const proofs = await cashuStore.getAllProofs();
      console.log(proofs);
      latestMintBalances = calculateBalanceByMint(
        proofs,
        cashuStore.mints
      ).balances;
      latestMintUnits = calculateBalanceByMint(proofs, cashuStore.mints).units;
      console.log("Lat", latestMintBalances);

      nip60Balance = 0;
      for (const mintUrl in latestMintBalances) {
        const balance = latestMintBalances[mintUrl];
        const unit = latestMintUnits[mintUrl];
        const balanceInSats = unit === "msat" ? balance / 1000 : balance;
        nip60Balance += balanceInSats;
      }
      totalBalance = nip60Balance + localBalance + totalPendingBalance;
    }
    console.log("rdlogs: totalBalance", totalBalance, adjustedAmount);

    if (totalBalance < adjustedAmount) {
      console.log("cashu proofs", cashuStore.proofs, mintBalances);
      const errorMsg = `Insufficient balance to spend. Please add more tokens to your wallet. You need at least ${adjustedAmount} sats to use the model.`;
      console.error(errorMsg, adjustedAmount);
      return {
        token: null,
        status: "failed",
        balance: 0,
        error: errorMsg,
      };
    }

    let token: string | null = null;

    if (usingNip60) {
      // Generate new token if none exists

      // Check if the active mint has sufficient balance
      const activeMintBalance = latestMintBalances[mintUrl] || 0;
      const activeMintUnit = latestMintUnits[mintUrl];
      let activeMintBalanceInSats = 0;
      if (activeMintUnit === "msat") {
        activeMintBalanceInSats = activeMintBalance / 1000;
      } else {
        activeMintBalanceInSats = activeMintBalance;
      }

      // Check if any mint has sufficient balance
      let { selectedMintUrl, selectedMintBalance } = selectMintWithBalance(
        latestMintBalances,
        latestMintUnits,
        adjustedAmount,
        excludeMints
      );
      console.log(
        "rdlogs: selectedMintUrl",
        selectedMintUrl,
        selectedMintBalance
      );
      let providerMints = loadMintsFromAllProviders()[baseUrl];
      console.log("rdlogs: providerMints", providerMints, baseUrl);
      if (!providerMints && baseUrl !== "") {
        const response = await fetch(`${baseUrl}v1/info`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        if (response.ok) {
          const json = await response.json();
          providerMints = json.mints;
          setProviderMints(baseUrl, providerMints);
        }
      }
      if (
        selectedMintUrl &&
        baseUrl !== "" &&
        !providerMints?.includes(selectedMintUrl)
      ) {
        let alternateMintUrl: string | null = selectedMintUrl;
        let alternateMintBalance: number = selectedMintBalance;
        while (
          alternateMintUrl &&
          !providerMints?.includes(alternateMintUrl) &&
          !excludeMints.includes(alternateMintUrl)
        ) {
          excludeMints.push(alternateMintUrl);
          const {
            selectedMintUrl: newMintUrl,
            selectedMintBalance: newMintBalance,
          } = selectMintWithBalance(
            latestMintBalances,
            latestMintUnits,
            adjustedAmount,
            excludeMints
          );
          if (newMintUrl) {
            alternateMintUrl = newMintUrl;
            alternateMintBalance = newMintBalance;
          }
          console.log(
            "rdlogs: alternateMintUrl",
            alternateMintUrl,
            excludeMints
          );
        }
        if (alternateMintUrl && alternateMintUrl === selectedMintUrl) {
          adjustedAmount += 2; // Add 2 sats to the amount to cover the fee for the mint that is not supported by the provider
        } else if (alternateMintUrl) {
          selectedMintUrl = alternateMintUrl;
          selectedMintBalance = alternateMintBalance;
        }
      }

      console.log(
        "activeMintBlance",
        activeMintBalanceInSats >= adjustedAmount,
        providerMints?.includes(mintUrl),
        baseUrl === ""
      );

      if (
        activeMintBalanceInSats >= adjustedAmount &&
        (baseUrl === "" || providerMints?.includes(mintUrl))
      ) {
        try {
          token = await sendToken(mintUrl, adjustedAmount, p2pkPubkey);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          console.error("Error generating token:", error);
          console.error(errorMsg);

          // If NetworkError, try with an alternate mint excluding the current active mint
          if (
            error instanceof Error &&
            (error.message.includes(
              "NetworkError when attempting to fetch resource"
            ) ||
              error.message.includes("Failed to fetch") ||
              error.message.includes("Load failed"))
          ) {
            const { selectedMintUrl: alternateMintUrl } = selectMintWithBalance(
              latestMintBalances,
              latestMintUnits,
              adjustedAmount,
              [...(excludeMints || []), ...(mintUrl ? [mintUrl] : [])]
            );

            if (
              alternateMintUrl &&
              retryCount < Object.keys(latestMintBalances).length
            ) {
              console.log(
                `NetworkError on active mint. Retrying with alternate mint ${alternateMintUrl}`
              );
              return spendCashu(
                alternateMintUrl as string,
                amount,
                baseUrl,
                false,
                p2pkPubkey,
                [...(excludeMints || []), ...(mintUrl ? [mintUrl] : [])],
                retryCount + 1
              );
            }
          }
          return {
            token: null,
            status: "failed",
            balance: 0,
            error: `Error generating token: ${errorMsg}`,
          };
        }
      } else if (
        selectedMintUrl &&
        baseUrl !== "" &&
        selectedMintBalance >= adjustedAmount
      ) {
        console.log(
          `Active mint insufficient. Using mint ${selectedMintUrl} with balance ${selectedMintBalance} sats instead`
        );
        try {
          token = await sendToken(selectedMintUrl, adjustedAmount, p2pkPubkey);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("Not enough funds on mint") &&
            error.message.includes("after cleaning spent proofs")
          ) {
            return spendCashu(selectedMintUrl, adjustedAmount, baseUrl);
          } else if (
            error instanceof Error &&
            (error.message.includes(
              "NetworkError when attempting to fetch resource"
            ) ||
              error.message.includes("Failed to fetch") ||
              error.message.includes("Load failed"))
          ) {
            const { selectedMintUrl: alternateMintUrl } = selectMintWithBalance(
              latestMintBalances,
              latestMintUnits,
              adjustedAmount,
              [...(excludeMints || []), ...(mintUrl ? [mintUrl] : [])]
            );

            if (
              alternateMintUrl &&
              retryCount < Object.keys(latestMintBalances).length
            ) {
              console.log(
                `NetworkError on active mint. Retrying with alternate mint ${alternateMintUrl}`
              );
              return spendCashu(
                alternateMintUrl as string,
                amount,
                baseUrl,
                false,
                p2pkPubkey,
                [...(excludeMints || []), ...(mintUrl ? [mintUrl] : [])],
                retryCount + 1
              );
            }
          }
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          console.error("Error generating token from alternate mint:", error);
          console.error(errorMsg);
          return {
            token: null,
            status: "failed",
            balance: 0,
            error: `Error generating token from alternate mint: ${errorMsg}`,
          };
        }
      } else if (
        totalPendingBalance + selectedMintBalance >= adjustedAmount &&
        retryCount < 1
      ) {
        console.log("=== Attempting to refund pending balances and retry ===");
        console.log(`Total pending balance: ${totalPendingBalance} sats`);
        console.log(`Selected mint balance: ${selectedMintBalance} sats`);
        console.log(`Required amount: ${adjustedAmount} sats`);

        // Refund all pending balances
        let refundSuccessful = true;
        for (const pendingBalance of pendingBalances) {
          const storedToken = getLocalCashuToken(pendingBalance.baseUrl);
          if (storedToken) {
            console.log(
              `Refunding pending token for ${pendingBalance.baseUrl}: ${pendingBalance.amount} sats`
            );
            const refundResult = await unifiedRefund(
              mintUrl,
              pendingBalance.baseUrl,
              usingNip60,
              receiveToken,
              storedToken
            );
            if (!refundResult.success) {
              console.error(
                `Failed to refund ${pendingBalance.baseUrl}: ${refundResult.message}`
              );
              refundSuccessful = false;
            } else {
              console.log(`Successfully refunded ${pendingBalance.baseUrl}`);
              removeLocalCashuToken(pendingBalance.baseUrl);
            }
          }
        }

        if (refundSuccessful) {
          console.log("All pending balances refunded. Retrying spend...");
          // Update pending amount state so UI reflects cleared pendings immediately
          setPendingCashuAmountState(getPendingCashuTokenAmount());
          return spendCashu(
            mintUrl,
            amount,
            baseUrl,
            false,
            p2pkPubkey,
            excludeMints,
            retryCount + 1
          );
        } else {
          console.error("Some refunds failed, still gonna retry");
          setPendingCashuAmountState(getPendingCashuTokenAmount());
          return spendCashu(
            mintUrl,
            amount,
            baseUrl,
            false,
            p2pkPubkey,
            excludeMints,
            retryCount + 1
          );
        }
      } else {
        console.error("=== Insufficient Balance Error ===");
        console.error(`Required amount: ${adjustedAmount} sats`);
        console.error(
          `Active mint (${mintUrl}): ${activeMintBalanceInSats} sats`
        );
        console.error("\nAll mint balances:");
        let maxMintBalance = 0;
        let maxMintUrl = "";
        for (const mintUrl in latestMintBalances) {
          const balance = latestMintBalances[mintUrl];
          const unit = latestMintUnits[mintUrl];
          let balanceInSats = 0;
          if (unit === "msat") {
            balanceInSats = balance / 1000;
          } else {
            balanceInSats = balance;
          }
          if (balanceInSats > maxMintBalance) {
            maxMintBalance = balanceInSats;
            maxMintUrl = mintUrl;
          }
          console.error(`  ${mintUrl}: ${balanceInSats} sats`);
        }
        const errorMsg = `Insufficient balance. Required: ${adjustedAmount} sats, Available: ${maxMintBalance} sats from mint ${maxMintUrl} is your biggest mint balance.`;
        return {
          token: null,
          status: "failed",
          balance: 0,
          error: errorMsg,
        };
      }
    } else {
      try {
        // Use the generateTokenCore function from useWalletOperations
        token = await generateTokenCore(adjustedAmount, mintUrl);
        console.log("rdlogs: token", token);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error("Error generating legacy token:", error);
        console.error(errorMsg);
        return {
          token: null,
          status: "failed",
          balance: 0,
          error: `Error generating legacy token: ${errorMsg}`,
        };
      }
    }

    // Store token and return if successful
    if (token) {
      if (baseUrl !== "") {
        setLocalCashuToken(baseUrl, token);
      }
      return {
        token,
        status: "success",
        balance: adjustedAmount,
      };
    }

    return {
      token: null,
      status: "failed",
      balance: 0,
      error: "Failed to generate token",
    };
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
    maxBalance,
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
    cleanSpentProofs,
  };
}
