"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { Copy, Check, Zap, ClipboardPaste, AlertCircle } from "lucide-react";
import {
  getDecodedToken,
  MeltQuoteState,
  MintQuoteState,
} from "@cashu/cashu-ts";
import { useInvoiceSync } from "@/hooks/useInvoiceSync";
import { useChat } from "@/context/ChatProvider";
import { useAuth } from "@/context/AuthProvider";
import { formatPublicKey } from "@/lib/nostr";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import {
  useWalletOperations,
  useCashuWallet,
  useCreateCashuWallet,
  useCashuToken,
  useCashuStore,
  formatBalance,
  calculateBalanceByMint,
  useTransactionHistoryStore,
} from "@/features/wallet";
import { createPendingTransaction } from "@/utils/transactionUtils";
import {
  isMintValid,
  getCurrentMintBalance as utilGetCurrentMintBalance,
  getWalletMintData,
} from "@/utils/walletUtils";
import {
  createLightningInvoice,
  mintTokensFromPaidInvoice,
  payMeltQuote,
  createMeltQuote,
} from "@/lib/cashuLightning";
import type { TransactionHistory } from "@/types/chat";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useCashuWithXYZ } from "@/hooks/useCashuWithXYZ";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import { getPendingCashuTokenAmount } from "@/utils/cashuUtils";
import { toast } from "sonner";
import {
  requestBitcoinConnectProvider,
  useBitcoinConnectStatus,
} from "@/hooks/useBitcoinConnect";
import BitcoinConnectStatusRow from "@/components/bitcoin-connect/BitcoinConnectStatusRow";
import MintSelector from "@/features/wallet/components/balance/MintSelector";
import BalancePopoverHeader from "@/features/wallet/components/balance/BalancePopoverHeader";
import BalanceOverviewTab from "@/features/wallet/components/balance/BalanceOverviewTab";
import BalanceActivityTab from "@/features/wallet/components/balance/BalanceActivityTab";
import BalanceInvoiceTab from "@/features/wallet/components/balance/BalanceInvoiceTab";

/**
 * User balance and authentication status component with comprehensive wallet popover
 * Displays balance in header and shows full wallet interface in popover
 */
interface BalanceDisplayProps {
  setIsSettingsOpen: (isOpen: boolean) => void;
  setInitialSettingsTab: (
    tab: "settings" | "wallet" | "history" | "api-keys"
  ) => void;
  onShowQRCode: (data: {
    invoice: string;
    amount: string;
    unit: string;
  }) => void;
  isQrModalOpen: boolean;
}

const BalanceDisplay: React.FC<BalanceDisplayProps> = ({
  setIsSettingsOpen,
  setInitialSettingsTab,
  onShowQRCode,
  isQrModalOpen,
}) => {
  const { isAuthenticated } = useAuth();
  const {
    balance,
    activeAccount,
    currentMintUnit,
    isBalanceLoading,
    setIsLoginModalOpen,
    baseUrl,
    transactionHistory,
    setTransactionHistory,
    setBalance,
  } = useChat();
  const { addInvoice, updateInvoice } = useInvoiceSync();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "overview" | "send" | "receive" | "activity" | "invoice"
  >("overview");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [localBalance, setLocalBalance] = useState(0);

  // Send state
  const [sendTab, setSendTab] = useState<"token" | "lightning">("token");
  const [sendAmount, setSendAmount] = useState("");
  const [isGeneratingSendToken, setIsGeneratingSendToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState("");
  const [lightningInvoice, setLightningInvoice] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState<number | null>(null);
  const [invoiceFeeReserve, setInvoiceFeeReserve] = useState<number | null>(
    null
  );
  const [isPayingInvoice, setIsPayingInvoice] = useState(false);

  // Receive state
  const [receiveTab, setReceiveTab] = useState<"lightning" | "token">(
    "lightning"
  );
  const [mintAmount, setMintAmount] = useState("");
  const [mintInvoice, setMintInvoice] = useState("");
  const [isMinting, setIsMinting] = useState(false);
  const [isAutoChecking, setIsAutoChecking] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [tokenToImport, setTokenToImport] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  // Mint selector state
  const [isMintSelectorOpen, setIsMintSelectorOpen] = useState(false);
  const handlePasteTokenToImport = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setTokenToImport(text);
    } catch {
      toast.error("Failed to read from clipboard");
    }
  }, []);

  // Common state
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  // Auto-checking refs
  const autoCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const balanceIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const {
    initWallet,
    generateSendToken: hookGenerateSendToken,
    createMintQuote,
    checkMintQuote,
    importToken: hookImportToken,
  } = useWalletOperations({
    mintUrl: DEFAULT_MINT_URL,
    baseUrl,
    setBalance,
    setTransactionHistory,
    transactionHistory,
  });

  // NIP-60 wallet hooks
  const { wallet, isLoading: isNip60Loading, updateProofs } = useCashuWallet();
  const {
    mutate: handleCreateWallet,
    isPending: isCreatingWallet,
    error: createWalletError,
  } = useCreateCashuWallet();
  const {
    cleanSpentProofs,
    cleanupPendingProofs,
    receiveToken,
    isLoading: isTokenLoading,
    error: nip60Error,
  } = useCashuToken();
  const cashuStore = useCashuStore();
  const usingNip60 = cashuStore.getUsingNip60();
  const transactionHistoryStore = useTransactionHistoryStore();
  const { spendCashu } = useCashuWithXYZ();

  // NIP-60 specific state
  const [nip60Invoice, setNip60Invoice] = useState("");
  const [nip60QuoteId, setNip60QuoteId] = useState("");
  const [nip60PendingTxId, setNip60PendingTxId] = useState<string | null>(null);
  const [isNip60Processing, setIsNip60Processing] = useState(false);

  // NIP-60 Lightning payment state
  const [nip60SendInvoice, setNip60SendInvoice] = useState("");
  const [nip60MeltQuoteId, setNip60MeltQuoteId] = useState("");
  const [isNip60LoadingInvoice, setIsNip60LoadingInvoice] = useState(false);
  const nip60ProcessingInvoiceRef = useRef<string | null>(null);

  // Get formatted npub
  const npub = activeAccount?.pubkey
    ? formatPublicKey(activeAccount?.pubkey)
    : "";
  const truncatedNpub =
    npub.length <= 16 ? npub : `${npub.slice(0, 8)}...${npub.slice(-6)}`;

  // Bitcoin Connect (NWC) connection state for UI
  const {
    status: bcStatus,
    balance: bcBalance,
    connect: connectWallet,
  } = useBitcoinConnectStatus();
  const [isBcPaying, setIsBcPaying] = useState(false);

  const handlePayWithBitcoinConnect = async () => {
    const invoiceToPay = usingNip60 ? nip60Invoice : mintInvoice;
    if (!invoiceToPay) return;
    setIsBcPaying(true);
    try {
      const provider = await requestBitcoinConnectProvider();
      try {
        await provider.sendPayment(invoiceToPay);
      } catch {
        // Some wallets may not return preimage or may throw; rely on polling below
      }
      // Trigger a manual check for NIP-60
      if (usingNip60 && nip60QuoteId && cashuStore.activeMintUrl) {
        const amt = parseInt(mintAmount || "0", 10) || 0;
        if (amt > 0) {
          try {
            await checkNip60PaymentStatus(
              cashuStore.activeMintUrl,
              nip60QuoteId,
              amt,
              crypto.randomUUID()
            );
          } catch {}
        }
      } else {
        // For local wallet, auto-check is already running; optionally nudge once
        try {
          await handleCheckMintQuote();
        } catch {}
      }
    } catch {
      // ignore provider errors
    } finally {
      setIsBcPaying(false);
    }
  };

  const { availableMints, mintBalances, mintUnits } = React.useMemo(
    () => getWalletMintData(wallet, cashuStore, calculateBalanceByMint),
    [wallet, cashuStore.proofs, cashuStore.mints]
  );

  // Check if user has any mints available
  const hasMints = availableMints.length > 0;

  // Check if current mint is valid
  const isCurrentMintValid = isMintValid(
    cashuStore.activeMintUrl,
    availableMints
  );

  // Handle mint selection
  const handleMintSelection = (mintUrl: string) => {
    if (cashuStore.setActiveMintUrlByUser) {
      cashuStore.setActiveMintUrlByUser(mintUrl);
    } else {
      cashuStore.setActiveMintUrl(mintUrl);
    }
    setIsMintSelectorOpen(false);
    setError(""); // Clear any previous errors
  };

  const msatNote =
    currentMintUnit === "msat" ? (
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2">
        <div className="text-blue-600 dark:text-blue-200 text-sm text-center">
          Note: You are using msats (millisats). 1 sat = 1000 msats
        </div>
      </div>
    ) : null;

  const subTabBase =
    "flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer";
  const getSubTabClass = (isActive: boolean, extra = "") =>
    `${subTabBase} ${
      isActive
        ? "bg-muted text-foreground"
        : "text-muted-foreground hover:text-foreground/80"
    } ${extra}`.trim();

  const mintSelector = usingNip60 ? (
    <MintSelector
      availableMints={availableMints}
      activeMintUrl={cashuStore.activeMintUrl}
      isCurrentMintValid={isCurrentMintValid}
      isOpen={isMintSelectorOpen}
      onToggle={() => setIsMintSelectorOpen((open) => !open)}
      onSelect={handleMintSelection}
      mintBalances={mintBalances}
      mintUnits={mintUnits}
    />
  ) : null;

  // Stop auto-checking
  const stopAutoChecking = useCallback(() => {
    setIsAutoChecking(false);
    if (autoCheckIntervalRef.current) {
      clearInterval(autoCheckIntervalRef.current);
      autoCheckIntervalRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  // Page transition function
  const navigateToTab = (
    tab: "overview" | "send" | "receive" | "activity" | "invoice"
  ) => {
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveTab(tab);
      setIsTransitioning(false);
    }, 150);
  };

  // Clean up intervals on unmount
  useEffect(() => {
    return () => {
      if (autoCheckIntervalRef.current) {
        clearInterval(autoCheckIntervalRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
      if (balanceIntervalRef.current) {
        clearInterval(balanceIntervalRef.current);
        balanceIntervalRef.current = null;
      }
    };
  }, []);

  // Reset states when popover opens/closes
  React.useEffect(() => {
    if (isPopoverOpen) {
      setActiveTab("overview");
      setSendAmount("");
      setGeneratedToken("");
      setMintAmount("");
      setMintInvoice("");
      setTokenToImport("");
      setLightningInvoice("");
      setInvoiceAmount(null);
      setInvoiceFeeReserve(null);
      setError("");
      setSuccessMessage("");
      setCopySuccess(false);
      setIsGeneratingSendToken(false);
      setIsMinting(false);
      setIsAutoChecking(false);
      setIsImporting(false);
      setIsPayingInvoice(false);
      setIsTransitioning(false);
      // Clear mint selector state
      setIsMintSelectorOpen(false);
      // Clear NIP-60 state
      setNip60Invoice("");
      setNip60QuoteId("");
      setNip60PendingTxId(null);
      setIsNip60Processing(false);
      setNip60SendInvoice("");
      setNip60MeltQuoteId("");
      setIsNip60LoadingInvoice(false);
      nip60ProcessingInvoiceRef.current = null;
      // Stop auto-checking when popover opens
      stopAutoChecking();
    } else {
      // Clean up intervals when popover closes
      stopAutoChecking();
    }
  }, [isPopoverOpen, stopAutoChecking]);

  // Handle payment success - redirect to overview instead of showing message
  React.useEffect(() => {
    if (successMessage === "Payment received! Tokens minted successfully.") {
      // Clear the success message immediately
      setSuccessMessage("");
      // Stop auto-checking
      stopAutoChecking();
      // Navigate to overview tab
      navigateToTab("overview");
      // Clear invoice-related state
      setMintInvoice("");
      setMintAmount("");
    }
  }, [successMessage, stopAutoChecking]);

  // Stop auto-checking when navigating away from invoice page
  React.useEffect(() => {
    if (activeTab !== "invoice" && isAutoChecking) {
      stopAutoChecking();
    }
  }, [activeTab, isAutoChecking, stopAutoChecking]);

  React.useEffect(() => {
    const every50ms = () => {
      setLocalBalance(balance + getPendingCashuTokenAmount());
    };

    // Run immediately once
    every50ms();

    // Clear existing interval before creating a new one
    if (balanceIntervalRef.current) {
      clearInterval(balanceIntervalRef.current);
    }

    // Run every 50ms
    balanceIntervalRef.current = setInterval(every50ms, 210);

    // Cleanup on dependency change or unmount
    return () => {
      if (balanceIntervalRef.current) {
        clearInterval(balanceIntervalRef.current);
        balanceIntervalRef.current = null;
      }
    };
  }, [balance]);

  // Auto-checking for mint quote
  const startAutoChecking = useCallback(() => {
    if (isAutoChecking) return;

    setIsAutoChecking(true);
    setCountdown(5);

    // Start countdown
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          return 5;
        }
        return prev - 1;
      });
    }, 1000);

    // Start auto-checking immediately, then every 5 seconds
    const checkPayment = async () => {
      try {
        await checkMintQuote(
          isAutoChecking,
          setIsAutoChecking,
          mintAmount,
          setError,
          setSuccessMessage,
          () => {}, // setShowInvoiceModal
          () => {}, // setMintQuote
          setMintInvoice,
          countdown,
          setCountdown
        );
      } catch (error) {
        console.error("Auto-check error:", error);
      }
    };

    // Check immediately
    checkPayment();

    // Then check every 5 seconds
    autoCheckIntervalRef.current = setInterval(checkPayment, 5000);
  }, [checkMintQuote, isAutoChecking, mintAmount, countdown]);

  // NIP-60 Lightning invoice creation
  const createNip60Invoice = useCallback(
    async (amount: number) => {
      if (!cashuStore.activeMintUrl) {
        setError(
          "No active mint selected. Please select a mint in your wallet settings."
        );
        return;
      }

      try {
        setIsNip60Processing(true);
        setError("");

        const invoiceData = await createLightningInvoice(
          cashuStore.activeMintUrl,
          amount
        );
        setNip60Invoice(invoiceData.paymentRequest);
        setNip60QuoteId(invoiceData.quoteId);

        // Store invoice persistently for recovery
        await addInvoice({
          type: "mint",
          mintUrl: cashuStore.activeMintUrl,
          quoteId: invoiceData.quoteId,
          paymentRequest: invoiceData.paymentRequest,
          amount: amount,
          state: MintQuoteState.UNPAID,
          expiresAt: invoiceData.expiresAt,
        });

        // Create pending transaction
        const pendingTransaction = createPendingTransaction({
          direction: "in",
          amount,
          mintUrl: cashuStore.activeMintUrl,
          quoteId: invoiceData.quoteId,
          paymentRequest: invoiceData.paymentRequest,
        });

        transactionHistoryStore.addPendingTransaction(pendingTransaction);
        setNip60PendingTxId(pendingTransaction.id);

        // Start polling for payment status
        checkNip60PaymentStatus(
          cashuStore.activeMintUrl,
          invoiceData.quoteId,
          amount,
          pendingTransaction.id
        );
      } catch (error) {
        console.error("Error creating NIP-60 invoice:", error);
        setError(
          "Failed to create Lightning invoice: " +
            (error instanceof Error ? error.message : String(error))
        );
      } finally {
        setIsNip60Processing(false);
      }
    },
    [cashuStore.activeMintUrl, transactionHistoryStore]
  );

  // Check NIP-60 payment status
  const checkNip60PaymentStatus = useCallback(
    async (
      mintUrl: string,
      quoteId: string,
      amount: number,
      pendingTxId: string
    ) => {
      try {
        const proofs = await mintTokensFromPaidInvoice(
          mintUrl,
          quoteId,
          amount
        );

        if (proofs.length > 0) {
          await updateProofs({
            mintUrl,
            proofsToAdd: proofs,
            proofsToRemove: [],
          });

          transactionHistoryStore.removePendingTransaction(pendingTxId);
          setNip60PendingTxId(null);
          setSuccessMessage(
            `Received ${formatBalance(amount, currentMintUnit)}s!`
          );
          setNip60Invoice("");
          setNip60QuoteId("");
          setMintAmount("");
          // Navigate back to overview after successful payment
          navigateToTab("overview");
          setTimeout(() => setSuccessMessage(""), 5000);
        } else {
          setTimeout(() => {
            if (nip60QuoteId === quoteId) {
              checkNip60PaymentStatus(mintUrl, quoteId, amount, pendingTxId);
            }
          }, 5000);
        }
      } catch (error) {
        if (
          !(error instanceof Error && error.message.includes("not been paid"))
        ) {
          console.error("Error checking NIP-60 payment status:", error);
          setError(
            "Failed to check payment status: " +
              (error instanceof Error ? error.message : String(error))
          );
        } else {
          setTimeout(() => {
            if (nip60QuoteId === quoteId) {
              checkNip60PaymentStatus(mintUrl, quoteId, amount, pendingTxId);
            }
          }, 5000);
        }
      }
    },
    [updateProofs, transactionHistoryStore, nip60QuoteId, navigateToTab]
  );

  // NIP-60 Lightning invoice input handler
  const handleNip60InvoiceInput = useCallback(
    async (value: string) => {
      if (!cashuStore.activeMintUrl) {
        setError(
          "No active mint selected. Please select a mint in your wallet settings."
        );
        return;
      }

      // Prevent duplicate processing of the same invoice
      if (nip60ProcessingInvoiceRef.current === value || nip60MeltQuoteId) {
        return;
      }

      setNip60SendInvoice(value);
      nip60ProcessingInvoiceRef.current = value;

      // Create melt quote
      const mintUrl = cashuStore.activeMintUrl;
      try {
        setIsNip60LoadingInvoice(true);
        const meltQuote = await createMeltQuote(mintUrl, value);
        setNip60MeltQuoteId(meltQuote.quote);

        // Parse amount from invoice
        setInvoiceAmount(meltQuote.amount);
        setInvoiceFeeReserve(meltQuote.fee_reserve);

        // Store melt invoice persistently
        await addInvoice({
          type: "melt",
          mintUrl: mintUrl,
          quoteId: meltQuote.quote,
          paymentRequest: value,
          amount: meltQuote.amount,
          state: MeltQuoteState.UNPAID,
          fee: meltQuote.fee_reserve,
        });
      } catch (error) {
        console.error("Error creating NIP-60 melt quote:", error);
        setError(
          "Failed to create melt quote: " +
            (error instanceof Error ? error.message : String(error))
        );
        setNip60MeltQuoteId(""); // Reset quote ID on error
        // Clear states on error
        setNip60SendInvoice("");
        setInvoiceAmount(null);
        setInvoiceFeeReserve(null);
      } finally {
        setIsNip60LoadingInvoice(false);
        nip60ProcessingInvoiceRef.current = null;
      }
    },
    [cashuStore.activeMintUrl, nip60MeltQuoteId]
  );

  // NIP-60 Lightning payment
  const handleNip60PayInvoice = useCallback(async () => {
    if (!nip60SendInvoice) {
      setError("Please enter a Lightning invoice");
      return;
    }

    if (error && nip60SendInvoice) {
      await handleNip60InvoiceInput(nip60SendInvoice);
    }

    if (!cashuStore.activeMintUrl) {
      setError(
        "No active mint selected. Please select a mint in your wallet settings."
      );
      return;
    }

    if (!invoiceAmount) {
      setError("Could not parse invoice amount");
      return;
    }

    try {
      setIsNip60Processing(true);
      setError("");

      // Get active mint
      const mintUrl = cashuStore.activeMintUrl;

      // Select proofs to spend
      const selectedProofs = await cashuStore.getMintProofs(mintUrl);
      const totalProofsAmount = selectedProofs.reduce(
        (sum, p) => sum + p.amount,
        0
      );

      if (totalProofsAmount < invoiceAmount + (invoiceFeeReserve || 0)) {
        setError(
          `Insufficient balance: have ${formatBalance(
            totalProofsAmount,
            currentMintUnit
          )}s, need ${formatBalance(
            invoiceAmount + (invoiceFeeReserve || 0),
            currentMintUnit
          )}s`
        );
        setIsNip60Processing(false);
        return;
      }

      // Pay the invoice
      const result = await payMeltQuote(
        mintUrl,
        nip60MeltQuoteId,
        selectedProofs,
        cleanSpentProofs
      );

      if (result.success) {
        // Remove spent proofs from the store
        await updateProofs({
          mintUrl,
          proofsToAdd: [...result.keep, ...result.change],
          proofsToRemove: selectedProofs,
        });

        setSuccessMessage(
          `Paid ${formatBalance(invoiceAmount, currentMintUnit)}s!`
        );
        // Update invoice status to paid
        await updateInvoice(nip60MeltQuoteId, {
          state: MeltQuoteState.PAID,
          paidAt: Date.now(),
        });

        setSuccessMessage(
          `Paid ${formatBalance(invoiceAmount, currentMintUnit)}s!`
        );
        handleNip60PaymentCancel();
        setTimeout(() => setSuccessMessage(""), 5000);
      }
    } catch (error) {
      console.error("Error paying NIP-60 invoice:", error);
      setError(
        "Failed to pay Lightning invoice: " +
          (error instanceof Error ? error.message : String(error))
      );
      setNip60MeltQuoteId(""); // Reset quote ID on error
    } finally {
      setIsNip60Processing(false);
    }
  }, [
    nip60SendInvoice,
    cashuStore.activeMintUrl,
    invoiceAmount,
    invoiceFeeReserve,
    nip60MeltQuoteId,
    updateProofs,
    error,
    handleNip60InvoiceInput,
  ]);

  // NIP-60 payment cancellation
  const handleNip60PaymentCancel = useCallback(() => {
    setNip60SendInvoice("");
    setNip60MeltQuoteId("");
    setInvoiceAmount(null);
    setInvoiceFeeReserve(null);
    nip60ProcessingInvoiceRef.current = null;
  }, []);

  // Wallet operations
  const generateSendToken = useCallback(async () => {
    if (!sendAmount || isNaN(parseInt(sendAmount))) {
      setError("Please enter a valid amount");
      return;
    }

    try {
      setError("");
      setSuccessMessage("");
      setGeneratedToken("");
      setIsGeneratingSendToken(true);

      const amountValue =
        currentMintUnit === "msat"
          ? parseInt(sendAmount) / 1000
          : parseInt(sendAmount);

      const mintUrl = cashuStore.activeMintUrl || DEFAULT_MINT_URL;
      const result = await spendCashu(mintUrl, amountValue, "");

      if (result.status === "success" && result.token) {
        setGeneratedToken(result.token);
        setSuccessMessage(
          `Token generated for ${formatBalance(amountValue, currentMintUnit)}`
        );
      } else {
        setError(result.error || "Failed to generate token");
      }
    } catch (error) {
      console.error("Error generating token:", error);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGeneratingSendToken(false);
    }
  }, [
    spendCashu,
    sendAmount,
    cashuStore.activeMintUrl,
    baseUrl,
    currentMintUnit,
  ]);

  const handleCreateMintQuote = useCallback(async () => {
    if (usingNip60) {
      const amount = parseInt(mintAmount);
      if (isNaN(amount) || amount <= 0) {
        setError("Please enter a valid amount");
        return;
      }
      await createNip60Invoice(amount);
      navigateToTab("invoice");
      return;
    }
    try {
      await createMintQuote(
        setIsMinting,
        setError,
        setSuccessMessage,
        () => {}, // setShowInvoiceModal
        mintAmount,
        () => {}, // setMintQuote
        setMintInvoice
      );

      // Navigate to invoice page after creation
      setTimeout(() => {
        navigateToTab("invoice");
        // Start auto-checking after navigation
        setTimeout(() => startAutoChecking(), 300);
      }, 500);
    } catch (error) {
      console.error("Error creating mint quote:", error);
      setError("Failed to create invoice. Please try again.");
    }
  }, [
    createMintQuote,
    mintAmount,
    startAutoChecking,
    navigateToTab,
    usingNip60,
    createNip60Invoice,
  ]);

  const handleCheckMintQuote = useCallback(async () => {
    await checkMintQuote(
      isAutoChecking,
      setIsAutoChecking,
      mintAmount,
      setError,
      setSuccessMessage,
      () => {}, // setShowInvoiceModal
      () => {}, // setMintQuote
      setMintInvoice,
      countdown,
      setCountdown
    );
  }, [checkMintQuote, isAutoChecking, mintAmount, countdown]);

  const handleImportToken = useCallback(async () => {
    if (usingNip60) {
      if (!tokenToImport) {
        setError("Please enter a token");
        return;
      }

      try {
        setError("");
        setSuccessMessage("");
        setIsImporting(true);

        const unit = getDecodedToken(tokenToImport).unit;
        const proofs = await receiveToken(tokenToImport);
        const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0);

        setSuccessMessage(
          `Received ${formatBalance(
            totalAmount,
            unit ? `${unit}s` : "sats"
          )} successfully!`
        );
        setTokenToImport("");
      } catch (error) {
        console.error("Error receiving NIP-60 token:", error);
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsImporting(false);
      }
      return;
    }
    await hookImportToken(
      setIsImporting,
      setError,
      setSuccessMessage,
      tokenToImport,
      setTokenToImport
    );
  }, [hookImportToken, tokenToImport, usingNip60, receiveToken]);

  // Lightning invoice payment
  const handlePayLightningInvoice = useCallback(async () => {
    if (usingNip60) {
      await handleNip60PayInvoice();
      return;
    }
    if (!lightningInvoice) {
      setError("Please enter a lightning invoice");
      return;
    }

    setIsPayingInvoice(true);
    setError("");

    try {
      // Mock parsing invoice amount (in real implementation, use lightning library)
      // This is a simplified version - real implementation would parse the invoice
      const mockAmount = 1000; // This should be parsed from the actual invoice
      setInvoiceAmount(mockAmount);
      setInvoiceFeeReserve(10); // Mock fee reserve

      // Mock payment process
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Simulate successful payment
      setSuccessMessage(`Successfully paid ${mockAmount} sats!`);
      setLightningInvoice("");
      setInvoiceAmount(null);
      setInvoiceFeeReserve(null);

      // Update balance (mock)
      setBalance((prev) => prev - mockAmount - 10);

      // Add to transaction history
      const newTransaction: TransactionHistory = {
        type: "send",
        amount: mockAmount + 10,
        timestamp: Date.now(),
        status: "success",
        balance: balance - mockAmount - 10,
      };
      setTransactionHistory((prev) => [...prev, newTransaction]);
    } catch (error) {
      setError("Failed to pay lightning invoice. Please try again.");
    } finally {
      setIsPayingInvoice(false);
    }
  }, [
    lightningInvoice,
    balance,
    setBalance,
    setTransactionHistory,
    usingNip60,
    handleNip60PayInvoice,
  ]);

  const copyToClipboard = async (text: string, type: string = "text") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setSuccessMessage(`${type} copied to clipboard!`);
      setTimeout(() => {
        setCopySuccess(false);
        setSuccessMessage("");
      }, 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      setError("Failed to copy to clipboard");
    }
  };

  const handleAmountChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "send" | "receive"
  ) => {
    const value = e.target.value;
    if (value === "" || /^\d+$/.test(value)) {
      if (type === "send") {
        setSendAmount(value);
      } else {
        setMintAmount(value);
      }
      setError("");
    }
  };

  // Clear transaction history
  const handleClearHistory = () => {
    if (
      window.confirm(
        "Are you sure you want to clear all transaction history? This cannot be undone."
      )
    ) {
      setTransactionHistory([]);
      setSuccessMessage("Transaction history cleared");
      setTimeout(() => setSuccessMessage(""), 2000);
    }
  };

  const openWalletSettings = (
    tab: "settings" | "wallet" | "history" | "api-keys" = "wallet"
  ) => {
    setIsSettingsOpen(true);
    setInitialSettingsTab(tab);
    setIsPopoverOpen(false);
  };

  const isValidSendAmount =
    sendAmount &&
    parseInt(sendAmount) > 0 &&
    parseInt(sendAmount) <=
      (usingNip60
        ? utilGetCurrentMintBalance(cashuStore.activeMintUrl, mintBalances)
        : currentMintUnit === "msat"
          ? balance * 1000
          : balance);
  const isValidReceiveAmount = mintAmount && parseInt(mintAmount) > 0;

  const tabTitleMap: Record<typeof activeTab, string> = {
    overview: "Wallet",
    send: "Send",
    receive: "Receive",
    activity: "Activity",
    invoice: "Invoice",
  };
  const activeTabTitle = tabTitleMap[activeTab];

  const displayBalance = isBalanceLoading
    ? "loading"
    : `${localBalance.toFixed(2)} sats`;

  if (!isAuthenticated) {
    return (
      <button
        onClick={() => setIsLoginModalOpen(true)}
        className="flex items-center gap-2 text-foreground bg-muted/50 hover:bg-muted rounded-md py-2 px-3 sm:px-4 h-[36px] text-xs sm:text-sm transition-colors cursor-pointer border border-border justify-center"
      >
        Sign in
      </button>
    );
  }

  return (
    <Popover
      open={isPopoverOpen}
      onOpenChange={(open) => {
        // Prevent closing the popover when QR modal is open
        if (!open && isQrModalOpen) {
          return;
        }
        setIsPopoverOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <button
          className={
            "flex items-center gap-2 text-foreground bg-muted/50 hover:bg-muted rounded-md py-2 px-3 sm:px-4 h-[36px] text-xs sm:text-sm transition-colors cursor-pointer border border-border justify-center"
          }
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-wallet shrink-0"
          >
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
            <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
          </svg>
          <span className={isMobile ? "text-xs" : "text-sm"}>
            {displayBalance}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={isMobile ? 12 : 4}
        className={`${
          isMobile ? "w-[92vw]" : "w-72"
        } bg-card border border-border rounded-md shadow-lg p-0 max-h-[70vh] overflow-y-auto`}
      >
        <BalancePopoverHeader
          title={activeTab === "invoice" ? "Invoice" : activeTabTitle}
          showBackButton={activeTab !== "overview" && activeTab !== "invoice"}
          onBack={() => navigateToTab("overview")}
          mintSelector={
            activeTab === "send" || activeTab === "receive"
              ? mintSelector
              : null
          }
          showSettings={activeTab === "overview"}
          onOpenSettings={() => openWalletSettings("wallet")}
        />

        <div
          className={`transition-all duration-300 ${
            isTransitioning
              ? "opacity-0 translate-x-2"
              : "opacity-100 translate-x-0"
          }`}
        >
          {/* No Wallet - Create Wallet Prompt */}
          {usingNip60 && !wallet && !isNip60Loading && !isCreatingWallet ? (
            <div className="p-4">
              <div className="bg-muted/50 border border-border rounded-md p-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    You don&apos;t have a Cashu wallet yet
                  </span>
                </div>
                <div className="mt-4">
                  <button
                    onClick={() => handleCreateWallet()}
                    disabled={!activeAccount}
                    className="bg-muted border border-border text-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-muted/80 transition-colors disabled:opacity-50 cursor-pointer"
                    type="button"
                  >
                    Create Wallet
                  </button>
                  {!activeAccount && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-300 p-3 rounded-md text-sm mt-4">
                      <div className="flex items-center">
                        <AlertCircle className="h-4 w-4 mr-2" />
                        <span>You need to log in to create a wallet</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : usingNip60 && (isNip60Loading || isCreatingWallet) ? (
            <div className="p-4">
              <div className="bg-muted/50 border border-border rounded-md p-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    Loading wallet...
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Overview Tab */}
              {activeTab === "overview" && (
                <BalanceOverviewTab
                  usingNip60={usingNip60}
                  mintSelector={mintSelector}
                  truncatedNpub={truncatedNpub}
                  displayBalance={displayBalance}
                  transactionHistory={transactionHistory}
                  onNavigate={(tab) => navigateToTab(tab)}
                />
              )}

              {/* Send Tab Content */}
              {activeTab === "send" && (
                <div className="p-4 space-y-3">
                  {/* Sub-tabs for Token/Lightning */}
                  {/* Note about msats if using msat unit */}
                  {msatNote}
                  <div className="flex bg-muted/50 rounded-lg p-1">
                    <button
                      onClick={() => setSendTab("token")}
                      className={getSubTabClass(sendTab === "token")}
                      type="button"
                    >
                      eCash Token
                    </button>
                    <button
                      onClick={() => setSendTab("lightning")}
                      className={getSubTabClass(
                        sendTab === "lightning",
                        "flex items-center justify-center gap-1"
                      )}
                      type="button"
                    >
                      <Zap className="h-3 w-3" />
                      Lightning
                    </button>
                  </div>

                  {sendTab === "token" && (
                    <div className="space-y-3">
                      {/* Balance context */}
                      <div className="bg-muted/50 rounded-lg p-2 text-center">
                        <div className="text-muted-foreground text-xs">
                          Available Balance
                        </div>
                        <div className="text-foreground text-lg font-bold">
                          {usingNip60 ? (
                            <>
                              {currentMintUnit === "msat"
                                ? utilGetCurrentMintBalance(
                                    cashuStore.activeMintUrl,
                                    mintBalances
                                  )
                                : utilGetCurrentMintBalance(
                                    cashuStore.activeMintUrl,
                                    mintBalances
                                  )}{" "}
                              {currentMintUnit === "msat" ? "msats" : "sats"}
                            </>
                          ) : (
                            <>
                              {currentMintUnit === "msat"
                                ? balance * 1000
                                : balance}{" "}
                              {currentMintUnit === "msat" ? "msats" : "sats"}
                            </>
                          )}
                        </div>
                        {usingNip60 && !isCurrentMintValid && (
                          <div className="text-red-600 dark:text-red-400 text-xs mt-1">
                            Invalid mint selected
                          </div>
                        )}
                        {usingNip60 &&
                          isCurrentMintValid &&
                          utilGetCurrentMintBalance(
                            cashuStore.activeMintUrl,
                            mintBalances
                          ) === 0 && (
                            <div className="text-yellow-600 dark:text-yellow-400 text-xs mt-1">
                              No balance available in selected mint
                            </div>
                          )}
                      </div>

                      <div>
                        <label className="block text-muted-foreground text-xs font-medium mb-2">
                          Amount ({currentMintUnit}s)
                        </label>
                        <input
                          type="text"
                          value={sendAmount}
                          onChange={(e) => handleAmountChange(e, "send")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void generateSendToken();
                            }
                          }}
                          className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-foreground text-lg font-mono focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                          placeholder="0"
                          autoFocus
                        />
                        {sendAmount &&
                          parseInt(sendAmount) >
                            (usingNip60
                              ? utilGetCurrentMintBalance(
                                  cashuStore.activeMintUrl,
                                  mintBalances
                                )
                              : currentMintUnit === "msat"
                                ? balance * 1000
                                : balance) && (
                            <p className="text-red-600 dark:text-red-400 text-xs mt-1">
                              Amount exceeds available balance
                            </p>
                          )}
                      </div>

                      <div className="grid grid-cols-4 gap-1">
                        {[100, 500, 1000].map((amount) => (
                          <button
                            key={amount}
                            onClick={() => setSendAmount(amount.toString())}
                            disabled={
                              amount >
                              (usingNip60
                                ? utilGetCurrentMintBalance(
                                    cashuStore.activeMintUrl,
                                    mintBalances
                                  )
                                : currentMintUnit === "msat"
                                  ? balance * 1000
                                  : balance)
                            }
                            className="py-1.5 px-2 bg-muted/50 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed border border-border rounded-md text-muted-foreground text-xs transition-colors cursor-pointer"
                          >
                            {amount}
                          </button>
                        ))}
                        <button
                          onClick={() =>
                            setSendAmount(
                              (usingNip60
                                ? utilGetCurrentMintBalance(
                                    cashuStore.activeMintUrl,
                                    mintBalances
                                  )
                                : currentMintUnit === "msat"
                                  ? balance * 1000
                                  : balance
                              ).toString()
                            )
                          }
                          disabled={
                            usingNip60
                              ? utilGetCurrentMintBalance(
                                  cashuStore.activeMintUrl,
                                  mintBalances
                                ) === 0
                              : balance === 0
                          }
                          className="py-1.5 px-2 bg-muted/50 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed border border-border rounded-md text-muted-foreground text-xs transition-colors cursor-pointer"
                        >
                          Max
                        </button>
                      </div>

                      <button
                        onClick={generateSendToken}
                        disabled={
                          !isValidSendAmount ||
                          isGeneratingSendToken ||
                          (usingNip60 && (!hasMints || !isCurrentMintValid))
                        }
                        className="w-full bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed border border-border text-foreground py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isGeneratingSendToken ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-foreground/30 border-t-foreground" />
                            Generating...
                          </>
                        ) : (
                          "Generate Token"
                        )}
                      </button>

                      {generatedToken && (
                        <div className="space-y-2">
                          <div className="text-muted-foreground text-xs font-medium">
                            Generated Token:
                          </div>
                          <div className="bg-muted/50 border border-border rounded-lg p-2">
                            <div className="font-mono text-xs text-muted-foreground break-all mb-2 max-h-20 overflow-y-auto">
                              {generatedToken}
                            </div>
                            <button
                              onClick={() =>
                                copyToClipboard(generatedToken, "Token")
                              }
                              className="w-full bg-muted hover:bg-muted/80 border border-border text-foreground py-1.5 px-3 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                            >
                              {copySuccess ? (
                                <>
                                  <Check className="h-3 w-3" />
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  Copy Token
                                </>
                              )}
                            </button>
                          </div>
                          <div className="text-muted-foreground text-xs text-center">
                            Share this token to send {sendAmount}{" "}
                            {currentMintUnit}s
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {sendTab === "lightning" && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-muted-foreground text-xs font-medium mb-2">
                          Lightning Invoice
                        </label>
                        <textarea
                          value={
                            usingNip60 ? nip60SendInvoice : lightningInvoice
                          }
                          onChange={(e) =>
                            usingNip60
                              ? handleNip60InvoiceInput(e.target.value)
                              : setLightningInvoice(e.target.value)
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              void handlePayLightningInvoice();
                            }
                          }}
                          className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-foreground text-xs font-mono focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 min-h-[80px] resize-y"
                          placeholder="Paste lightning invoice here..."
                          autoFocus
                        />
                      </div>

                      {invoiceAmount && (
                        <div className="bg-muted/50 border border-border rounded-lg p-3">
                          <div className="text-muted-foreground text-xs mb-1">
                            Invoice Amount
                          </div>
                          <div className="text-foreground text-lg font-bold">
                            {invoiceAmount} {currentMintUnit}s
                            {invoiceFeeReserve !== 0 && (
                              <span className="text-xs font-normal text-muted-foreground ml-2">
                                + max {invoiceFeeReserve} fee
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={handlePayLightningInvoice}
                          disabled={
                            !(usingNip60
                              ? nip60SendInvoice.trim()
                              : lightningInvoice.trim()) ||
                            (usingNip60
                              ? isNip60Processing || isNip60LoadingInvoice
                              : isPayingInvoice)
                          }
                          className="flex-1 bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed border border-border text-foreground py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {(
                            usingNip60 ? isNip60Processing : isPayingInvoice
                          ) ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-foreground/30 border-t-foreground" />
                              Paying...
                            </>
                          ) : usingNip60 && isNip60LoadingInvoice ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-foreground/30 border-t-foreground" />
                              Loading...
                            </>
                          ) : (
                            <>
                              <Zap className="h-4 w-4" />
                              Pay Invoice
                            </>
                          )}
                        </button>

                        {/* Cancel button - only show when there's an invoice being processed */}
                        {usingNip60 &&
                          (nip60SendInvoice.trim() || nip60MeltQuoteId) && (
                            <button
                              onClick={handleNip60PaymentCancel}
                              disabled={isNip60Processing}
                              className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed border border-red-500/30 text-red-600 dark:text-red-200 rounded-lg font-medium transition-colors cursor-pointer"
                              title="Cancel and clear invoice"
                            >
                              ✕
                            </button>
                          )}
                      </div>

                      <div className="text-muted-foreground text-xs text-center">
                        Paste a lightning invoice to pay it instantly
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Receive Tab Content */}
              {activeTab === "receive" && (
                <div className="p-4 space-y-3">
                  {/* Note about msats if using msat unit */}
                  {msatNote}

                  {/* Sub-tabs for Lightning/Token */}
                  <div className="flex bg-muted/50 rounded-lg p-1">
                    <button
                      onClick={() => setReceiveTab("lightning")}
                      className={getSubTabClass(
                        receiveTab === "lightning",
                        "flex items-center justify-center gap-2"
                      )}
                      type="button"
                    >
                      <Zap className="h-3 w-3" />
                      Lightning
                    </button>
                    <button
                      onClick={() => setReceiveTab("token")}
                      className={getSubTabClass(receiveTab === "token")}
                      type="button"
                    >
                      Token
                    </button>
                  </div>

                  {receiveTab === "lightning" && (
                    <div className="space-y-3">
                      {/* NWC Wallet row */}
                      <BitcoinConnectStatusRow
                        status={bcStatus}
                        balance={bcBalance}
                        onConnect={connectWallet}
                      />
                      <div>
                        <label className="block text-muted-foreground text-xs font-medium mb-2">
                          Amount ({currentMintUnit}s)
                        </label>
                        <input
                          type="text"
                          value={mintAmount}
                          onChange={(e) => handleAmountChange(e, "receive")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleCreateMintQuote();
                            }
                          }}
                          className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-foreground text-lg font-mono focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                          placeholder="0"
                          autoFocus
                        />
                      </div>

                      <div className="grid grid-cols-4 gap-1">
                        {[100, 500, 1000, 5000].map((amount) => (
                          <button
                            key={amount}
                            onClick={() => setMintAmount(amount.toString())}
                            className="py-1.5 px-2 bg-muted/50 hover:bg-muted border border-border rounded-md text-muted-foreground text-xs transition-colors cursor-pointer"
                          >
                            {amount}
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={handleCreateMintQuote}
                        disabled={
                          !isValidReceiveAmount ||
                          (usingNip60 ? isNip60Processing : isMinting)
                        }
                        className="w-full bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed border border-border text-foreground py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {(usingNip60 ? isNip60Processing : isMinting) ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-foreground/30 border-t-foreground" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <Zap className="h-4 w-4" />
                            Create Invoice
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {receiveTab === "token" && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-muted-foreground text-xs font-medium mb-2">
                          Cashu Token
                        </label>
                        <div className="relative">
                          <textarea
                            value={tokenToImport}
                            onChange={(e) => setTokenToImport(e.target.value)}
                            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 pr-10 text-foreground text-xs font-mono focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 min-h-[80px] resize-y"
                            placeholder="Paste a Cashu token here..."
                            autoFocus
                          />
                          <button
                            onClick={handlePasteTokenToImport}
                            className="absolute top-2 right-2 bg-muted/60 hover:bg-muted border border-border text-foreground p-1.5 rounded-md transition-all cursor-pointer flex items-center justify-center"
                            type="button"
                            title="Paste"
                          >
                            <ClipboardPaste className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={handleImportToken}
                        disabled={!tokenToImport.trim() || isImporting}
                        className="w-full bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed border border-border text-foreground py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isImporting ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-foreground/30 border-t-foreground" />
                            Importing...
                          </>
                        ) : (
                          "Import Token"
                        )}
                      </button>

                      <div className="text-muted-foreground text-xs text-center">
                        Import a Cashu token to add sats to your wallet
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Activity Tab Content */}
              {activeTab === "activity" && (
                <BalanceActivityTab
                  transactionHistory={transactionHistory}
                  onClearHistory={handleClearHistory}
                  onOpenSettings={() => openWalletSettings("wallet")}
                />
              )}

              {/* Invoice Tab Content */}
              {activeTab === "invoice" && (
                <BalanceInvoiceTab
                  onBack={() => navigateToTab("receive")}
                  bcStatus={bcStatus}
                  bcBalance={bcBalance}
                  onConnectWallet={connectWallet}
                  usingNip60={usingNip60}
                  nip60Invoice={nip60Invoice}
                  mintInvoice={mintInvoice}
                  mintAmount={mintAmount}
                  currentMintUnit={currentMintUnit}
                  onShowQRCode={onShowQRCode}
                  onPayWithWallet={() => void handlePayWithBitcoinConnect()}
                  isPayingWithWallet={isBcPaying}
                  copyToClipboard={copyToClipboard}
                  copySuccess={copySuccess}
                />
              )}

              {/* Error/Success Messages */}
              {(error || successMessage) && (
                <div className="p-4 pt-0">
                  {error && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-200 p-2 rounded-lg text-xs">
                      {error}
                    </div>
                  )}

                  {successMessage &&
                    !successMessage.includes("Invoice generated") &&
                    successMessage !==
                      "Payment received! Tokens minted successfully." && (
                      <div className="bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-200 p-2 rounded-lg text-xs">
                        {successMessage}
                      </div>
                    )}
                </div>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default BalanceDisplay;
