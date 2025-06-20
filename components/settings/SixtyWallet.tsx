import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Copy, Loader2, QrCode, Zap, ArrowRight, Info } from "lucide-react";
import QRCode from "react-qr-code";
import { getEncodedTokenV4, Proof, MeltQuoteResponse, MintQuoteResponse } from "@cashu/cashu-ts";
import { useCashuWallet } from "@/hooks/useCashuWallet";
import { useCreateCashuWallet } from "@/hooks/useCreateCashuWallet";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCashuToken } from "@/hooks/useCashuToken";
import { useCashuStore } from "@/stores/cashuStore";
import { formatBalance, calculateBalance } from "@/lib/cashu";
import { cn } from "@/lib/utils";
import {
  createLightningInvoice,
  mintTokensFromPaidInvoice,
  payMeltQuote,
  parseInvoiceAmount,
  createMeltQuote,
} from "@/lib/cashuLightning";
import {
  useTransactionHistoryStore,
  PendingTransaction,
} from "@/stores/transactionHistoryStore";
import { getBalanceFromStoredProofs } from "@/utils/cashuUtils";

// Helper function to generate unique IDs
const generateId = () => crypto.randomUUID();

const SixtyWallet: React.FC<{mintUrl:string, usingNip60: boolean, setUsingNip60: (usingNip60: boolean) => void}> = ({mintUrl, usingNip60, setUsingNip60}) => {
  // Popular amounts for quick minting
  const popularAmounts = [100, 500, 1000];
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'deposit' | 'send'>('deposit');

  // Lightning state variables (from Chorus)
  const [receiveAmount, setReceiveAmount] = useState("");
  const [invoice, setInvoice] = useState("");
  const [currentMeltQuoteId, setcurrentMeltQuoteId] = useState("");
  const [paymentRequest, setPaymentRequest] = useState("");
  const [sendInvoice, setSendInvoice] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState<number | null>(null);
  const [invoiceFeeReserve, setInvoiceFeeReserve] = useState<number | null>(null);
  const [mintQuote, setMintQuote] = useState<MintQuoteResponse | null>(null);
  const [meltQuote, setMeltQuote] = useState<MeltQuoteResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(false);
  const [pendingTransactionId, setPendingTransactionId] = useState<string | null>(null);
  const processingInvoiceRef = useRef<string | null>(null);

  // Internal state for the UI elements
  const [balance, setBalance] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isGeneratingSendToken, setIsGeneratingSendToken] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  
  // Migration state
  const [localWalletBalance, setLocalWalletBalance] = useState(0);
  const [isMigrating, setIsMigrating] = useState(false);
  const [showMigrationBanner, setShowMigrationBanner] = useState(false);

  // Handle lightning invoice creation
  const handleCreateInvoice = async () => {
    if (!cashuStore.activeMintUrl) {
      setError(
        "No active mint selected. Please select a mint in your wallet settings."
      );
      return;
    }

    if (!receiveAmount || isNaN(parseInt(receiveAmount))) {
      setError("Please enter a valid amount");
      return;
    }

    try {
      setIsProcessing(true);
      setError(null);

      const amount = parseInt(receiveAmount);
      const invoiceData = await createLightningInvoice(
        cashuStore.activeMintUrl,
        amount
      );

      setInvoice(invoiceData.paymentRequest);
      setcurrentMeltQuoteId(invoiceData.quoteId);
      setPaymentRequest(invoiceData.paymentRequest);

      // Create pending transaction
      const pendingTxId = generateId();
      const pendingTransaction: PendingTransaction = {
        id: pendingTxId,
        direction: "in",
        amount: amount.toString(),
        timestamp: Math.floor(Date.now() / 1000),
        status: "pending",
        mintUrl: cashuStore.activeMintUrl,
        quoteId: invoiceData.quoteId,
        paymentRequest: invoiceData.paymentRequest,
      };

      // Store the pending transaction
      transactionHistoryStore.addPendingTransaction(pendingTransaction);
      setPendingTransactionId(pendingTxId);

      // Start polling for payment status
      checkPaymentStatus(
        cashuStore.activeMintUrl,
        invoiceData.quoteId,
        amount,
        pendingTxId
      );
    } catch (error) {
      console.error("Error creating invoice:", error);
      setError(
        "Failed to create Lightning invoice: " +
          (error instanceof Error ? error.message : String(error))
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle quick mint button click
  const handleQuickMint = async (amount: number) => {
    setReceiveAmount(amount.toString());
    await handleCreateInvoice();
  };

  // Poll for payment status
  const checkPaymentStatus = async (
    mintUrl: string,
    quoteId: string,
    amount: number,
    pendingTxId: string
  ) => {
    try {
      // Check if payment has been received
      const proofs = await mintTokensFromPaidInvoice(mintUrl, quoteId, amount);

      if (proofs.length > 0) {
        // update proofs
        await updateProofs({
          mintUrl,
          proofsToAdd: proofs,
          proofsToRemove: [],
        });

        // Remove the pending transaction
        transactionHistoryStore.removePendingTransaction(pendingTxId);
        setPendingTransactionId(null);

        setSuccessMessage(`Received ${formatBalance(amount)}!`);
        setInvoice("");
        setcurrentMeltQuoteId("");
        setReceiveAmount("");
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        // If payment not received yet, check again in 5 seconds
        setTimeout(() => {
          if (currentMeltQuoteId === quoteId) {
            // Only continue if we're still waiting for this payment
            checkPaymentStatus(mintUrl, quoteId, amount, pendingTxId);
          }
        }, 5000);
      }
    } catch (error) {
      // If it's not a "not paid yet" error, show the error
      if (
        !(error instanceof Error && error.message.includes("not been paid"))
      ) {
        console.error("Error checking payment status:", error);
        setError(
          "Failed to check payment status: " +
            (error instanceof Error ? error.message : String(error))
        );
      } else {
        // Keep polling if it's just not paid yet
        setTimeout(() => {
          if (currentMeltQuoteId === quoteId) {
            // Only continue if we're still waiting for this payment
            checkPaymentStatus(mintUrl, quoteId, amount, pendingTxId);
          }
        }, 5000);
      }
    }
  };

  // Copy invoice to clipboard
  const copyInvoiceToClipboard = () => {
    navigator.clipboard.writeText(invoice);
    setSuccessMessage("Invoice copied to clipboard");
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const { user } = useCurrentUser();
  const { wallet, isLoading, updateProofs } = useCashuWallet();
  const { mutate: handleCreateWallet, isPending: isCreatingWallet, error: createWalletError } = useCreateCashuWallet();
  const cashuStore = useCashuStore();
  const { sendToken, receiveToken, cleanSpentProofs, isLoading: isTokenLoading, error: hookError } = useCashuToken();
  const transactionHistoryStore = useTransactionHistoryStore();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [generatedToken, setGeneratedToken] = useState(''); // For send
  const [tokenToImport, setTokenToImport] = useState(''); // For receive
  const [sendAmount, setSendAmount] = useState(''); // For send

  useEffect(() => {
    if (createWalletError) {
      setError(createWalletError.message);
      console.log(createWalletError.message);
    }
  }, [createWalletError]);

  useEffect(() => {
    if (hookError) {
      setError(hookError);
    }
  }, [hookError]);

  const mintBalances = React.useMemo(() => {
    if (!cashuStore.proofs) return {};
    return calculateBalance(cashuStore.proofs);
  }, [cashuStore.proofs]);

  useEffect(() => {
    const totalBalance = Object.values(mintBalances).reduce(
      (sum, balance) => sum + balance,
      0
    );
    setBalance(totalBalance);
  }, [mintBalances]);

  // Check for local wallet balance on component mount
  useEffect(() => {
    const checkLocalBalance = () => {
      const localBalance = getBalanceFromStoredProofs();
      setLocalWalletBalance(localBalance);
      setShowMigrationBanner(localBalance > 0);
    };
    
    checkLocalBalance();
    // Check periodically for changes
    const interval = setInterval(checkLocalBalance, 5000);
    return () => clearInterval(interval);
  }, []);

  const cleanMintUrl = (mintUrl: string) => {
    try {
      const url = new URL(mintUrl);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return mintUrl;
    }
  };

  const handleReceiveToken = async () => {
    if (!tokenToImport) {
      setError("Please enter a token");
      return;
    }

   try {
      setError(null);
      setSuccessMessage(null);

      const proofs = await receiveToken(tokenToImport);
      const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0);

      setSuccessMessage(`Received ${formatBalance(totalAmount)} successfully!`);
      setTokenToImport("");
    } catch (error) {
      console.error("Error receiving token:", error);
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const handlesendToken = async () => {
    if (!cashuStore.activeMintUrl) {
      setError(
        "No active mint selected. Please select a mint in your wallet settings."
      );
      return;
    }

    if (!sendAmount || isNaN(parseInt(sendAmount))) {
      setError("Please enter a valid amount");
      return;
    }

    try {
      setError(null);
      setSuccessMessage(null);
      setGeneratedToken("");

      const amountValue = parseInt(sendAmount);
      const proofs = await sendToken(cashuStore.activeMintUrl, amountValue);
      const token = getEncodedTokenV4({
        mint: cashuStore.activeMintUrl,
        proofs: proofs.map((p) => ({
          id: p.id || "",
          amount: p.amount,
          secret: p.secret || "",
          C: p.C || "",
        })),
      });

      setGeneratedToken(token as string);
      setSuccessMessage(`Token generated for ${formatBalance(amountValue)}`);
    } catch (error) {
      console.error("Error generating token:", error);
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  // Handle lightning send invoice input
  const handleInvoiceInput = async (value: string) => {
    if (!cashuStore.activeMintUrl) {
      setError(
        "No active mint selected. Please select a mint in your wallet settings."
      );
      return;
    }

    // Prevent duplicate processing of the same invoice
    if (processingInvoiceRef.current === value || currentMeltQuoteId) {
      return;
    }

    setSendInvoice(value);
    processingInvoiceRef.current = value;

    // Create melt quote
    const mintUrl = cashuStore.activeMintUrl;
    try {
      setIsLoadingInvoice(true);
      const meltQuote = await createMeltQuote(mintUrl, value);
      setcurrentMeltQuoteId(meltQuote.quote);

      // Parse amount from invoice
      setInvoiceAmount(meltQuote.amount);
      setInvoiceFeeReserve(meltQuote.fee_reserve);
    } catch (error) {
      console.error("Error creating melt quote:", error);
      setError(
        "Failed to create melt quote: " +
          (error instanceof Error ? error.message : String(error))
      );
      setcurrentMeltQuoteId(""); // Reset quote ID on error
      handleCancel();
    } finally {
      setIsLoadingInvoice(false);
      processingInvoiceRef.current = null;
    }
  };

  // Pay Lightning invoice
  const handlePayInvoice = async () => {
    if (!sendInvoice) {
      setError("Please enter a Lightning invoice");
      return;
    }

    if (error && sendInvoice) {
      await handleInvoiceInput(sendInvoice);
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
      setIsProcessing(true);
      setError(null);

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
            totalProofsAmount
          )}, need ${formatBalance(invoiceAmount + (invoiceFeeReserve || 0))}`
        );
        setIsProcessing(false);
        return;
      }

      // Pay the invoice
      const result = await payMeltQuote(
        mintUrl,
        currentMeltQuoteId,
        selectedProofs
      );

      if (result.success) {
        // Remove spent proofs from the store
        await updateProofs({
          mintUrl,
          proofsToAdd: [...result.keep, ...result.change],
          proofsToRemove: selectedProofs,
        });

        setSuccessMessage(`Paid ${formatBalance(invoiceAmount)}!`);
        setSendInvoice("");
        setInvoiceAmount(null);
        setInvoiceFeeReserve(null);
        setcurrentMeltQuoteId("");
        processingInvoiceRef.current = null;
        setTimeout(() => setSuccessMessage(null), 5000);
      }
    } catch (error) {
      console.error("Error paying invoice:", error);
      setError(
        "Failed to pay Lightning invoice: " +
          (error instanceof Error ? error.message : String(error))
      );
      setcurrentMeltQuoteId(""); // Reset quote ID on error
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle cancel operations
  const handleCancel = () => {
    setInvoice("");
    setcurrentMeltQuoteId("");
    setSendInvoice("");
    setInvoiceAmount(null);
    setInvoiceFeeReserve(null);
    setReceiveAmount("");
    processingInvoiceRef.current = null;
  };

  const copyTokenToClipboard = () => {
    if (generatedToken) {
      navigator.clipboard.writeText(generatedToken);
      setSuccessMessage("Token copied to clipboard");
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  };

  // Handle migration from local wallet to nip60 wallet
  const handleMigration = async () => {
    if (localWalletBalance <= 0) {
      setError("No balance found in local wallet to migrate");
      return;
    }

    if (!cashuStore.activeMintUrl) {
      setError("No active mint selected. Please select a mint in your wallet settings.");
      return;
    }

    try {
      setIsMigrating(true);
      setError(null);
      setSuccessMessage(null);

      // Step 1: Generate token from local wallet (similar to WalletTab.tsx)
      const storedProofs = localStorage.getItem("cashu_proofs");
      if (!storedProofs) {
        throw new Error("No local wallet proofs found");
      }

      const proofs = JSON.parse(storedProofs);
      if (!proofs || proofs.length === 0) {
        throw new Error("No valid proofs found in local wallet");
      }

      // Calculate total amount to migrate
      const totalAmount = proofs.reduce((sum: number, proof: any) => sum + proof.amount, 0);

      // Create token from local proofs
      const token = getEncodedTokenV4({
        mint: cashuStore.activeMintUrl,
        proofs: proofs.map((p: any) => ({
          id: p.id || "",
          amount: p.amount,
          secret: p.secret || "",
          C: p.C || "",
        })),
      });

      // Step 2: Receive token to nip60 wallet (using existing receiveToken function)
      const receivedProofs = await receiveToken(token as string);
      const receivedAmount = receivedProofs.reduce((sum, p) => sum + p.amount, 0);

      // Step 3: Clear local wallet proofs after successful migration
      localStorage.removeItem("cashu_proofs");
      
      // Update local balance state
      setLocalWalletBalance(0);
      setShowMigrationBanner(false);

      setSuccessMessage(`Successfully migrated ${formatBalance(receivedAmount)} from local wallet to NIP-60 wallet!`);
      
    } catch (error) {
      console.error("Error during migration:", error);
      setError(error instanceof Error ? error.message : "Migration failed");
    } finally {
      setIsMigrating(false);
    }
  };

  if (isLoading || isCreatingWallet) {
    return (
      <div className="space-y-6">
        <div className="bg-white/5 border border-white/10 rounded-md p-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-white/70">Loading wallet...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="space-y-6">
        <div className="bg-white/5 border border-white/10 rounded-md p-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-white/70">You don't have a Cashu wallet yet</span>
          </div>
          <div className="mt-4">
            <button
              onClick={() => handleCreateWallet()}
              disabled={!user}
              className="bg-white/10 border border-white/10 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
              type="button"
            >
              Create Wallet
            </button>
            {!user && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-3 rounded-md text-sm mt-4">
                <div className="flex items-center">
                  <AlertCircle className="h-4 w-4 mr-2" />
                  <span>
                    You need to log in to create a wallet
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Migration Banner */}
      {showMigrationBanner && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-md p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <Info className="h-5 w-5 text-blue-300 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-blue-200 mb-1">
                  Local Wallet Found - Migrate to Cloud Wallet
                </h3>
                <p className="text-xs text-blue-200/80 mb-3">
                  You have {formatBalance(localWalletBalance)} in your local device wallet.
                  Migrate to the new NIP-60 cloud-based wallet for better security and sync across devices.
                </p>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleMigration}
                    disabled={isMigrating}
                    className="inline-flex items-center px-3 py-1.5 bg-blue-500/20 border border-blue-500/30 text-blue-200 text-xs font-medium rounded-md hover:bg-blue-500/30 transition-colors disabled:opacity-50 cursor-pointer"
                    type="button"
                    title="Migrate your local wallet balance to the new NIP-60 cloud wallet. This will move all your funds to the cloud for better security and device sync."
                  >
                    {isMigrating ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Migrating...
                      </>
                    ) : (
                      <>
                        <ArrowRight className="h-3 w-3 mr-1" />
                        Migrate {formatBalance(localWalletBalance)}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setShowMigrationBanner(false)}
                    className="text-xs text-blue-200/60 hover:text-blue-200/80"
                    type="button"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Balance Display */}
      <div className="bg-white/5 border border-white/10 rounded-md p-4">
        <div className="flex justify-between items-center">
          <span className="text-sm text-white/70">Available Balance</span>
          <div className="flex flex-col items-end">
            <span className="text-lg font-semibold text-white">{balance} sats</span>
          </div>
        </div>
        {wallet.mints && wallet.mints.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <h3 className="text-sm font-medium text-white/80 mb-2">Select Mint</h3>
            <div className="space-y-2">
              {wallet.mints.map((mint) => {
                const mintBalance = mintBalances[mint] || 0;
                const isActive = cashuStore.activeMintUrl === mint;
                return (
                  <div key={mint} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <input
                        type="radio"
                        id={`mint-${mint}`}
                        name="activeMint"
                        value={mint}
                        checked={isActive}
                        onChange={() => cashuStore.setActiveMintUrl(mint)}
                        className="form-radio h-4 w-4 text-white bg-white/10 border-white/30 focus:ring-white/50"
                      />
                      <label htmlFor={`mint-${mint}`} className={cn("ml-2 text-sm cursor-pointer", isActive ? "text-white" : "text-white/70")}>
                        {cleanMintUrl(mint)}
                      </label>
                      <button
                        onClick={() => cleanSpentProofs(mint)}
                        className="ml-2 px-2 py-1 text-xs bg-white/10 border border-white/20 rounded-md text-white hover:bg-white/20 transition-colors"
                        type="button"
                      >
                        Clean Proofs
                      </button>
                    </div>
                    <span className={cn("text-sm font-medium", isActive ? "text-white" : "text-white/70")}>
                      {formatBalance(mintBalance)} sats
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      
      {/* Error/Success Messages */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-3 rounded-md text-sm">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-200 p-3 rounded-md text-sm">
          {successMessage}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="bg-white/5 border border-white/10 rounded-md">
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab('deposit')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'deposit'
                ? 'text-white bg-white/5 border-b-2 border-white/30'
                : 'text-white/70 hover:text-white/90 hover:bg-white/5'
            }`}
            type="button"
          >
            Deposit
          </button>
          <button
            onClick={() => setActiveTab('send')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'send'
                ? 'text-white bg-white/5 border-b-2 border-white/30'
                : 'text-white/70 hover:text-white/90 hover:bg-white/5'
            }`}
            type="button"
          >
            Send
          </button>
        </div>

        {/* Tab Content Container with Fixed Height */}
        <div className="p-4 min-h-[400px]">
          {/* Deposit Tab Content */}
          {activeTab === 'deposit' && (
            <div className="space-y-6 h-full">
              {/* Mint Tokens Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-white/80">Via Lightning</h3>

                {/* Quick Mint Buttons */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    {popularAmounts.map((amount) => (
                      <button
                        key={amount}
                        onClick={() => handleQuickMint(amount)}
                        disabled={isProcessing}
                        className="flex-1 bg-white/5 border border-white/20 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 hover:border-white/30 transition-colors disabled:opacity-50 cursor-pointer"
                        type="button"
                      >
                        {amount} sats
                      </button>
                    ))}
                  </div>
                </div>

                {/* Manual Amount Input */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={receiveAmount}
                      onChange={(e) => setReceiveAmount(e.target.value)}
                      className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                      placeholder="Amount in sats"
                    />
                    <button
                      onClick={handleCreateInvoice}
                      disabled={isProcessing || !receiveAmount || !cashuStore.activeMintUrl}
                      className="bg-white/10 border border-white/10 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
                      type="button"
                    >
                      <Zap className="h-4 w-4 mr-2 inline" />
                      {isProcessing ? 'Creating Invoice...' : 'Create Lightning Invoice'}
                    </button>
                  </div>
                </div>

                {invoice && (
                  <div className="space-y-4">
                    <div className="bg-white p-4 rounded-md flex items-center justify-center">
                      <div className="border border-gray-300 w-48 h-48 flex items-center justify-center bg-white p-2 rounded-md">
                        <QRCode value={invoice} size={180} />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-sm text-white/70">Lightning Invoice</span>
                      <div className="relative">
                        <input
                          readOnly
                          value={invoice}
                          className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 pr-10 text-xs text-white font-mono break-all focus:border-white/30 focus:outline-none"
                        />
                        <button
                          onClick={copyInvoiceToClipboard}
                          className="absolute right-2 top-2 text-white/70 hover:text-white"
                          type="button"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="text-xs text-white/50">
                        Waiting for payment...
                      </p>
                    </div>

                    <button
                      onClick={handleCancel}
                      className="w-full bg-white/10 border border-white/10 text-white py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors"
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* Import Tokens Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-white/80">Via Cashu</h3>
                <div className="space-y-2">
                  <textarea
                    value={tokenToImport}
                    onChange={(e) => setTokenToImport(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white h-24 focus:border-white/30 focus:outline-none resize-none"
                    placeholder="Paste your Cashu token here..."
                  />
                  <button
                    onClick={handleReceiveToken}
                    disabled={isImporting || !tokenToImport.trim()}
                    className="w-full bg-white/10 border border-white/10 text-white py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
                    type="button"
                  >
                    {isImporting ? 'Importing...' : 'Import Token'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Send Tab Content */}
          {activeTab === 'send' && (
            <div className="space-y-6 h-full">
              {/* Lightning Send Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-white/80">Via Lightning</h3>
                <div className="space-y-2">
                  <span className="text-sm text-white/70">Invoice</span>
                  <div className="relative">
                    <input
                      placeholder="Lightning invoice"
                      value={sendInvoice}
                      onChange={(e) => handleInvoiceInput(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 pr-10 text-sm text-white focus:border-white/30 focus:outline-none"
                    />
                    <button
                      className="absolute right-2 top-2 text-white/70 hover:text-white"
                      type="button"
                    >
                      <QrCode className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {invoiceAmount && (
                  <div className="bg-white/5 border border-white/10 rounded-md p-4">
                    <p className="text-sm font-medium text-white/80">Invoice Amount</p>
                    <p className="text-2xl font-bold text-white">
                      {formatBalance(invoiceAmount)}
                      {invoiceFeeReserve && (
                        <>
                          <span className="text-xs font-bold pl-2 text-white/50">
                            + max {formatBalance(invoiceFeeReserve)} fee
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSendInvoice("");
                      setInvoiceAmount(null);
                      setInvoiceFeeReserve(null);
                      setcurrentMeltQuoteId("");
                      processingInvoiceRef.current = null;
                    }}
                    className="flex-1 bg-white/10 border border-white/10 text-white py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors"
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePayInvoice}
                    disabled={
                      isProcessing ||
                      isLoadingInvoice ||
                      !sendInvoice ||
                      !invoiceAmount
                    }
                    className="flex-1 bg-white/10 border border-white/10 text-white py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50"
                    type="button"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin inline" />
                        Processing...
                      </>
                    ) : isLoadingInvoice ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin inline" />
                        Loading...
                      </>
                    ) : (
                      "Pay Invoice"
                    )}
                  </button>
                </div>
              </div>

              {/* eCash Send Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-white/80">Via eCash</h3>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                    placeholder="Amount in sats"
                  />
                  <button
                    onClick={handlesendToken}
                    disabled={isGeneratingSendToken || !sendAmount || parseInt(sendAmount) > balance}
                    className="bg-white/10 border border-white/10 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
                    type="button"
                  >
                    {isGeneratingSendToken ? 'Generating...' : 'Generate Token'}
                  </button>
                </div>

                {generatedToken && (
                  <div className="bg-white/5 border border-white/10 rounded-md p-4">
                    <div className="mb-2 flex justify-between items-center">
                      <span className="text-sm text-white/70">Generated Token</span>
                      <button
                        onClick={copyTokenToClipboard}
                        className="text-xs text-blue-300 hover:text-blue-200 cursor-pointer"
                        type="button"
                      >
                        Copy Token
                      </button>
                    </div>
                    <div className="font-mono text-xs break-all text-white/70 max-h-32 overflow-y-auto">
                      {generatedToken}
                    </div>
                  </div>
                )}

                <div className="text-sm text-white/50 italic">
                  Share your generated token with others to send them eCash.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SixtyWallet;