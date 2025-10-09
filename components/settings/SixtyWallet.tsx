import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Copy, Loader2, QrCode, Zap, ArrowRight, Info, Plus, Trash2, Eraser } from "lucide-react";
import { getEncodedTokenV4, Proof, MeltQuoteResponse, MintQuoteResponse, getDecodedToken } from "@cashu/cashu-ts";
import { useCashuWallet } from "@/hooks/useCashuWallet";
import { useCreateCashuWallet } from "@/hooks/useCreateCashuWallet";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCashuToken } from "@/hooks/useCashuToken";
import { useCashuStore } from "@/stores/cashuStore";
import { formatBalance, calculateBalance } from "@/lib/cashu";
import { cn } from "@/lib/utils";
import InvoiceModal from './InvoiceModal';
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
import { useInvoiceSync } from "@/hooks/useInvoiceSync";
import { useInvoiceChecker } from "@/hooks/useInvoiceChecker";
import { MintQuoteState, MeltQuoteState } from "@cashu/cashu-ts";
import InvoiceHistory from './InvoiceHistory';

// Helper function to generate unique IDs
const generateId = () => crypto.randomUUID();

const SixtyWallet: React.FC<{mintUrl:string, usingNip60: boolean, setUsingNip60: (usingNip60: boolean) => void}> = ({mintUrl, usingNip60, setUsingNip60}) => {
  // Popular amounts for quick minting
  const popularAmounts = [100, 500, 1000];
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'deposit' | 'send' | 'history'>('deposit');

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
  const [customMintUrl, setCustomMintUrl] = useState('');
  const [isAddingMint, setIsAddingMint] = useState(false);
  const [showAddMintInput, setShowAddMintInput] = useState(false);
  const [showRemoveMintMode, setShowRemoveMintMode] = useState(false);
  const [isRemovingMint, setIsRemovingMint] = useState(false);
  
  // Migration state
  const [localWalletBalance, setLocalWalletBalance] = useState(0);
  const [isMigrating, setIsMigrating] = useState(false);
  const [showMigrationBanner, setShowMigrationBanner] = useState(false);

  // Invoice modal state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  // Handle lightning invoice creation
  const handleCreateInvoice = async (quickMintAmount?: number) => {
    if (!cashuStore.activeMintUrl) {
      setError(
        "No active mint selected. Please select a mint in your wallet settings."
      );
      return;
    }

    const amount = quickMintAmount !== undefined ? quickMintAmount : parseInt(receiveAmount);

    if (isNaN(amount) || amount <= 0) {
      console.log('rdlogs: ', receiveAmount);
      console.log('rdlogs: ', isNaN(parseInt(receiveAmount)));
      setError("Please enter a valid amount");
      return;
    }

    try {
      setIsProcessing(true);
      setError(null);

      const invoiceData = await createLightningInvoice(
        cashuStore.activeMintUrl,
        amount
      );

      setInvoice(invoiceData.paymentRequest);
      setcurrentMeltQuoteId(invoiceData.quoteId);
      setPaymentRequest(invoiceData.paymentRequest);
      setShowInvoiceModal(true); // Automatically show QR code modal

      // Store invoice persistently
      await addInvoice({
        type: 'mint',
        mintUrl: cashuStore.activeMintUrl,
        quoteId: invoiceData.quoteId,
        paymentRequest: invoiceData.paymentRequest,
        amount: amount,
        state: MintQuoteState.UNPAID,
        expiresAt: invoiceData.expiresAt
      });

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

      // Invoice checker will handle payment status automatically
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
    await handleCreateInvoice(amount);
  };


  const { user } = useCurrentUser();
  const { wallet, isLoading, updateProofs } = useCashuWallet();
  const { mutate: handleCreateWallet, isPending: isCreatingWallet, error: createWalletError } = useCreateCashuWallet();
  const cashuStore = useCashuStore();
  const { sendToken, receiveToken, cleanSpentProofs, cleanupPendingProofs, isLoading: isTokenLoading, error: hookError, addMintIfNotExists, removeMint } = useCashuToken();
  const transactionHistoryStore = useTransactionHistoryStore();
  const { addInvoice, updateInvoice } = useInvoiceSync();
  const { triggerCheck } = useInvoiceChecker();

  const [error, setError] = useState<string | null>(null);
  const [currentMintUnit, setCurrentMintUnit] = useState<string | 'sat'>('sat');
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

  const { balances: mintBalances, units: mintUnits } = React.useMemo(() => {
    if (!cashuStore.proofs) return { balances: {}, units: {} };
    return calculateBalance(cashuStore.proofs);
  }, [cashuStore.proofs]);

  useEffect(() => {
    setCurrentMintUnit(mintUnits[cashuStore.activeMintUrl??'']);
  }, [mintUnits, cashuStore.activeMintUrl]);

  useEffect(() => {
    let totalBalance = 0;
    for (const mintUrl in mintBalances) {
      const balance = mintBalances[mintUrl];
      const unit = mintUnits[mintUrl];
      if (unit === 'msat') {
        totalBalance += balance / 1000;
      } else {
        totalBalance += balance;
      }
    }
    setBalance(Math.round(totalBalance*1000)/1000);
  }, [mintBalances, mintUnits]);

  // Check for local wallet balance on component mount
  useEffect(() => {
    const checkLocalBalance = () => {
      const localBalance = getBalanceFromStoredProofs();
      setLocalWalletBalance(localBalance);
      // Only show migration banner if NIP-60 is enabled and there's a local balance
      setShowMigrationBanner(usingNip60 && localBalance > 0);
    };
    
    checkLocalBalance();
    // Check periodically for changes
    const interval = setInterval(checkLocalBalance, 5000);
    return () => clearInterval(interval);
  }, [usingNip60]);

  // Check invoices when wallet opens
  useEffect(() => {
    triggerCheck();
  }, []); // Run once on mount

  const handleAddCustomMint = async () => {
    if (!customMintUrl.trim()) {
      setError("Please enter a valid mint URL.");
      return;
    }

    try {
      setIsAddingMint(true);
      setError(null);
      setSuccessMessage(null);

      await addMintIfNotExists(customMintUrl);
      setCustomMintUrl('');
      setSuccessMessage(`Mint "${cleanMintUrl(customMintUrl)}" added and set as active.`);
    } catch (error) {
      console.error("Error adding custom mint:", error);
      setError(`Failed to add mint: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsAddingMint(false);
    }
  };

  const handleRemoveMint = async (mintUrl: string) => {
    try {
      setIsRemovingMint(true);
      setError(null);
      setSuccessMessage(null);

      await removeMint(mintUrl);
      setSuccessMessage(`Mint "${cleanMintUrl(mintUrl)}" removed successfully.`);
      
      // If the removed mint was the active one, set a new active mint
      if (cashuStore.activeMintUrl === mintUrl && wallet?.mints && wallet.mints.length > 0) {
        const remainingMints = wallet.mints.filter(mint => mint !== mintUrl);
        if (remainingMints.length > 0) {
          cashuStore.setActiveMintUrl(remainingMints[0]);
        }
      }
    } catch (error) {
      console.error("Error removing mint:", error);
      setError(`Failed to remove mint: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRemovingMint(false);
    }
  };

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

      const unit = getDecodedToken(tokenToImport).unit;
      const proofs = await receiveToken(tokenToImport);
      const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0);

      setSuccessMessage(`Received ${formatBalance(totalAmount, unit != undefined ? unit+'s' : 'sats' )} successfully!`);
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
      const { proofs, unit } = await sendToken(cashuStore.activeMintUrl, amountValue);
      const token = getEncodedTokenV4({
        mint: cashuStore.activeMintUrl,
        proofs: proofs.map((p) => ({
          id: p.id || "",
          amount: p.amount,
          secret: p.secret || "",
          C: p.C || "",
        })),
        unit: unit
      });

      // Clean up pending proofs after successful token creation
      if ((proofs as any).pendingProofsKey) {
        cleanupPendingProofs((proofs as any).pendingProofsKey);
      }

      setGeneratedToken(token as string);
      setSuccessMessage(`Token generated for ${formatBalance(amountValue, unit)}`);
    } catch (error) {
      console.error("Error generating token:", error);
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  // Handle lightning send invoice input
  const handleInvoiceInput = async (value: string) => {
    console.log('rdlogs:gm', processingInvoiceRef.current, currentMeltQuoteId);
    if (!cashuStore.activeMintUrl) {
      setError(
        "No active mint selected. Please select a mint in your wallet settings."
      );
      return;
    }

    // Prevent duplicate processing of the same invoice
    if (processingInvoiceRef.current === value) {
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
            totalProofsAmount, 'sats'
          )}, need ${formatBalance(invoiceAmount + (invoiceFeeReserve || 0), 'sats')}`
        );
        setIsProcessing(false);
        return;
      }

      // Store melt invoice persistently before payment attempt
      await addInvoice({
        type: 'melt',
        mintUrl: mintUrl,
        quoteId: currentMeltQuoteId,
        paymentRequest: sendInvoice,
        amount: invoiceAmount,
        state: MeltQuoteState.UNPAID,
        fee: invoiceFeeReserve || undefined
      });

      // Pay the invoice
      const result = await payMeltQuote(
        mintUrl,
        currentMeltQuoteId,
        selectedProofs,
        cleanSpentProofs
      );

      if (result.success) {
        // Update invoice status
        await updateInvoice(currentMeltQuoteId, {
          state: MeltQuoteState.PAID,
          paidAt: Date.now(),
          fee: result.fee
        });

        // Remove spent proofs from the store
        await updateProofs({
          mintUrl,
          proofsToAdd: [...result.keep, ...result.change],
          proofsToRemove: selectedProofs,
        });

        setSuccessMessage(`Paid ${formatBalance(invoiceAmount, `${currentMintUnit}s`)}!`);
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

      setSuccessMessage(`Successfully migrated ${formatBalance(receivedAmount, 'sats')} from local wallet to NIP-60 wallet!`);
      
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
        <div className="bg-white/5 border border-white/20 rounded-md p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <Info className="h-5 w-5 text-white/70 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-white mb-1">
                  Local Wallet Found - Migrate to Cloud Wallet
                </h3>
                <p className="text-xs text-white/70 mb-3">
                  You have {formatBalance(localWalletBalance, 'sats')} in your local device wallet.
                  Migrate to the new NIP-60 cloud-based wallet for better security and sync across devices.
                </p>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleMigration}
                    disabled={isMigrating}
                    className="inline-flex items-center px-3 py-1.5 bg-white/10 border border-white/20 text-white/80 text-xs font-medium rounded-md hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
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
                        Migrate {formatBalance(localWalletBalance, 'sats')}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setShowMigrationBanner(false)}
                    className="text-xs text-white/60 hover:text-white/80 cursor-pointer"
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
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-sm font-medium text-white/80 mr-1">Mints</h3>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={() => setShowAddMintInput(!showAddMintInput)}
                  className={`p-1.5 rounded-md border border-white/20 ${showAddMintInput ? 'bg-white/15 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'} cursor-pointer`}
                  aria-label="Add new mint"
                  title={showAddMintInput ? 'Close add mint' : 'Add new mint'}
                  type="button"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setShowRemoveMintMode(!showRemoveMintMode)}
                  className={`p-1.5 rounded-md border ${showRemoveMintMode ? 'border-red-500/40 bg-red-500/20 text-red-200' : 'border-white/20 bg-white/5 text-white/80 hover:bg-white/10' } cursor-pointer`}
                  aria-label="Toggle remove mint mode"
                  title={showRemoveMintMode ? 'Exit remove mode' : 'Remove mint'}
                  type="button"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {wallet.mints.map((mint) => {
                const mintBalance = mintBalances[mint] || 0;
                const isActive = cashuStore.activeMintUrl === mint;
                const unit = mintUnits[mint] || 'sat';
                return (
                  <div key={mint} className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <input
                        type="radio"
                        id={`mint-${mint}`}
                        name="activeMint"
                        value={mint}
                        checked={isActive}
                        onChange={() => cashuStore.setActiveMintUrl(mint)}
                        className="form-radio h-4 w-4 text-white bg-white/10 border-white/30 focus:ring-white/50 shrink-0"
                      />
                      <label htmlFor={`mint-${mint}`} className={cn("text-sm cursor-pointer truncate max-w-[70vw] sm:max-w-[28rem]", isActive ? "text-white" : "text-white/70")}> 
                        {cleanMintUrl(mint)}
                      </label>
                    </div>
                    <div className="flex items-center gap-2 sm:justify-end">
                      <span className={cn("text-sm font-medium", isActive ? "text-white" : "text-white/70")}> 
                        {formatBalance(mintBalance, unit+'s')}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => cleanSpentProofs(mint)}
                          className="p-1.5 rounded-md border border-white/20 bg-white/5 hover:bg-white/10 text-white/80 cursor-pointer"
                          aria-label="Clean spent proofs"
                          title="Clean spent proofs"
                          type="button"
                        >
                          <Eraser className="h-4 w-4" />
                        </button>
                        {showRemoveMintMode && (
                          <button
                            onClick={() => handleRemoveMint(mint)}
                            disabled={isRemovingMint || wallet.mints.length <= 1}
                            className="p-1.5 rounded-md border border-red-500/30 bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            aria-label="Delete mint"
                            title={wallet.mints.length <= 1 ? 'Cannot remove the last mint' : 'Remove this mint'}
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {showAddMintInput && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <h3 className="text-sm font-medium text-white/80 mb-2">Add Custom Mint</h3>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={customMintUrl}
                    onChange={(e) => setCustomMintUrl(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                    placeholder="Enter new mint URL"
                  />
                  <button
                    onClick={handleAddCustomMint}
                    disabled={isAddingMint || !customMintUrl.trim()}
                    className="bg-white/10 border border-white/10 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
                    type="button"
                  >
                    {isAddingMint ? 'Adding...' : 'Add Mint'}
                  </button>
                </div>
              </div>
            )}
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
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-white bg-white/5 border-b-2 border-white/30'
                : 'text-white/70 hover:text-white/90 hover:bg-white/5'
            }`}
            type="button"
          >
            Invoices
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
                        {amount} {currentMintUnit}s
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
                      placeholder={`Amount in ${currentMintUnit}s`}
                    />
                    <button
                      onClick={() => handleCreateInvoice()}
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
                    <div className="bg-white/5 border border-white/10 rounded-md p-4">
                      <div className="mb-2 flex justify-between items-center">
                        <span className="text-sm text-white/70">Lightning Invoice</span>
                        <button
                          onClick={() => setShowInvoiceModal(true)}
                          className="text-xs text-white/70 hover:text-white cursor-pointer"
                          type="button"
                        >
                          Show QR Code
                        </button>
                      </div>
                      <div className="font-mono text-xs break-all text-white/70">
                        {invoice}
                      </div>
                    </div>

                    <button
                      onClick={handleCancel}
                      className="w-full bg-white/10 border border-white/10 text-white py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors cursor-pointer"
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
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-white/70 hover:text-white"
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
                      {formatBalance(invoiceAmount, `${currentMintUnit}s `)}
                      {invoiceFeeReserve !== null && invoiceFeeReserve !== 0 && (
                        <>
                          <span className="text-xs font-bold pl-2 text-white/50">
                            + max {formatBalance(invoiceFeeReserve, 'sats')} fee
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
                    placeholder={`Amount in ${currentMintUnit}s`}
                  />
                  <button
                    onClick={handlesendToken}
                    disabled={isGeneratingSendToken || !sendAmount}
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
                        className="text-xs text-white/70 hover:text-white cursor-pointer"
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

          {/* History Tab Content */}
          {activeTab === 'history' && (
            <div className="h-full">
              <InvoiceHistory mintUrl={cashuStore.activeMintUrl} />
            </div>
          )}
        </div>
      </div>

      {/* Invoice Modal */}
      <InvoiceModal
        showInvoiceModal={showInvoiceModal}
        mintInvoice={invoice}
        mintAmount={receiveAmount}
        mintUnit={currentMintUnit}
        isAutoChecking={false}
        countdown={0}
        setShowInvoiceModal={setShowInvoiceModal}
        setMintInvoice={(value: string) => setInvoice(value)}
        setMintQuote={() => {}}
        checkIntervalRef={{ current: null }}
        countdownIntervalRef={{ current: null }}
        setIsAutoChecking={() => {}}
        checkMintQuote={() => Promise.resolve()}
      />
    </div>
  );
};

export default SixtyWallet;