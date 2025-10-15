import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AlertCircle, Copy, Loader2, QrCode, Zap, ArrowRight, Info } from "lucide-react";
import QRCode from "react-qr-code";
import { useCashuWallet } from "@/hooks/useCashuWallet";
import { useCashuToken } from "@/hooks/useCashuToken";
import { useCashuStore } from "@/stores/cashuStore";
import { formatBalance, calculateBalance } from "@/lib/cashu";
import {
  createLightningInvoice,
  mintTokensFromPaidInvoice,
} from "@/lib/cashuLightning";
import {
  useTransactionHistoryStore,
  PendingTransaction,
} from "@/stores/transactionHistoryStore";
import { useInvoiceSync } from "@/hooks/useInvoiceSync";
import { useInvoiceChecker } from "@/hooks/useInvoiceChecker";
import { MintQuoteState } from "@cashu/cashu-ts";

// Helper function to generate unique IDs
const generateId = () => crypto.randomUUID();

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  mintUrl: string;
  balance: number;
  setBalance: React.Dispatch<React.SetStateAction<number>>;
  usingNip60: boolean;
  initialAmount?: number;
  autoCreate?: boolean;
}

const DepositModal: React.FC<DepositModalProps> = ({ isOpen, onClose, mintUrl, balance, setBalance, usingNip60, initialAmount, autoCreate }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const hasAutoCreatedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);


  const popularAmounts = [100, 500, 1000];

  const [receiveAmount, setReceiveAmount] = useState("");
  const [invoice, setInvoice] = useState("");
  const [currentMeltQuoteId, setcurrentMeltQuoteId] = useState("");
  const [paymentRequest, setPaymentRequest] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(false);
  const [pendingTransactionId, setPendingTransactionId] = useState<string | null>(null);
  const processingInvoiceRef = useRef<string | null>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { wallet, isLoading, updateProofs } = useCashuWallet();
  const cashuStore = useCashuStore();
  const { receiveToken, isLoading: isTokenLoading, error: hookError } = useCashuToken();
  const transactionHistoryStore = useTransactionHistoryStore();
  const { addInvoice, updateInvoice } = useInvoiceSync();
  const { triggerCheck } = useInvoiceChecker();

  useEffect(() => {
    if (hookError) {
      setError(hookError);
    }
  }, [hookError]);

  // Initialize amount and optionally auto-create invoice when opened
  useEffect(() => {
    if (!isOpen) {
      hasAutoCreatedRef.current = false;
      return;
    }
    if (initialAmount && initialAmount > 0) {
      setReceiveAmount(String(initialAmount));
    }
    if (autoCreate && initialAmount && initialAmount > 0 && !hasAutoCreatedRef.current) {
      hasAutoCreatedRef.current = true;
      void handleCreateInvoice(initialAmount);
    }
  }, [isOpen, autoCreate, initialAmount]);

  const { balances: mintBalances, units: mintUnits } = React.useMemo(() => {
    if (!cashuStore.proofs) return { balances: {}, units: {} };
    return calculateBalance(cashuStore.proofs);
  }, [cashuStore.proofs]);

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
    setBalance(totalBalance);
  }, [mintBalances, mintUnits, setBalance]);

  const handleCreateInvoice = async (quickMintAmount?: number) => {
    if (!cashuStore.activeMintUrl) {
      setError(
        "No active mint selected. Please select a mint in your wallet settings."
      );
      return;
    }

    const amount = quickMintAmount !== undefined ? quickMintAmount : parseInt(receiveAmount);

    if (isNaN(amount) || amount <= 0) {
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

      transactionHistoryStore.addPendingTransaction(pendingTransaction);
      setPendingTransactionId(pendingTxId);

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

  const handleQuickMint = async (amount: number) => {
    setReceiveAmount(amount.toString());
    await handleCreateInvoice(amount);
  };

  const checkPaymentStatus = async (
    mintUrl: string,
    quoteId: string,
    amount: number,
    pendingTxId: string
  ) => {
    try {
      const proofs = await mintTokensFromPaidInvoice(mintUrl, quoteId, amount);

      if (proofs.length > 0) {
        await updateProofs({
          mintUrl,
          proofsToAdd: proofs,
          proofsToRemove: [],
        });

        // Update stored invoice status
        await updateInvoice(quoteId, {
          state: MintQuoteState.PAID,
          paidAt: Date.now()
        });

        transactionHistoryStore.removePendingTransaction(pendingTxId);
        setPendingTransactionId(null);

        setSuccessMessage(`Received ${formatBalance(amount, 'sats')}!`);
        setInvoice("");
        setcurrentMeltQuoteId("");
        setReceiveAmount("");
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setTimeout(() => {
          if (currentMeltQuoteId === quoteId) {
            checkPaymentStatus(mintUrl, quoteId, amount, pendingTxId);
          }
        }, 5000);
      }
    } catch (error) {
      if (
        !(error instanceof Error && error.message.includes("not been paid"))
      ) {
        console.error("Error checking payment status:", error);
        setError(
          "Failed to check payment status: " +
          (error instanceof Error ? error.message : String(error))
        );
      } else {
        setTimeout(() => {
          if (currentMeltQuoteId === quoteId) {
            checkPaymentStatus(mintUrl, quoteId, amount, pendingTxId);
          }
        }, 5000);
      }
    }
  };

  const copyInvoiceToClipboard = () => {
    navigator.clipboard.writeText(invoice);
    setSuccessMessage("Invoice copied to clipboard");
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleCancel = () => {
    setInvoice("");
    setcurrentMeltQuoteId("");
    setReceiveAmount("");
    processingInvoiceRef.current = null;
  };

  const [tokenToImport, setTokenToImport] = useState('');
  const [isImporting, setIsImporting] = useState(false);

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

      setSuccessMessage(`Received ${formatBalance(totalAmount, 'sats')} successfully!`);
      setTokenToImport("");
    } catch (error) {
      console.error("Error receiving token:", error);
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div ref={modalRef} className="bg-[#181818] border border-white/20 rounded-md p-4 max-w-sm w-full max-h-[90vh] overflow-y-auto relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-white/50 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <h2 className="text-xl font-semibold text-white mb-4">Deposit Funds</h2>
        {initialAmount && initialAmount > 0 && (
          <div className="bg-white/5 border border-white/20 rounded-md p-2 text-white/70 text-xs mb-3">
            Suggested amount: {initialAmount} sats
          </div>
        )}

        {isLoading && (
          <div className="bg-blue-500/10 border border-blue-500/30 text-blue-200 p-3 rounded-md text-sm mb-4 flex items-center">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Wallet is being loaded, please wait...
          </div>
        )}

        {!isLoading && !cashuStore.activeMintUrl && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 p-3 rounded-md text-sm mb-4 flex items-center">
            <Info className="h-4 w-4 mr-2" />
            Configuring your wallet, please wait...
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-3 rounded-md text-sm mb-4">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-200 p-3 rounded-md text-sm mb-4">
            {successMessage}
          </div>
        )}

        <div className="space-y-6">
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
                    disabled={isProcessing || isLoading || !cashuStore.activeMintUrl}
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleCreateInvoice();
                    }
                  }}
                  disabled={isLoading || !cashuStore.activeMintUrl}
                  className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none disabled:opacity-50"
                  placeholder="Amount in sats"
                />
                <button
                  onClick={() => handleCreateInvoice()}
                  disabled={isProcessing || !receiveAmount || !cashuStore.activeMintUrl || isLoading}
                  className="bg-white/10 border border-white/10 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
                  type="button"
                >
                  <Zap className="h-4 w-4 mr-2 inline" />
                  {isProcessing ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>

            {invoice && (
              <div className="space-y-4">
                <div className="bg-white/10 border border-white/20 p-4 rounded-md flex items-center justify-center">
                  <div className="w-48 h-48 flex items-center justify-center p-2 rounded-md">
                    <QRCode
                      value={invoice}
                      size={180}
                      bgColor="transparent"
                      fgColor="#ffffff"
                    />
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
                      <Copy className="h-3 w-3" />
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
                disabled={isLoading}
                className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white h-24 focus:border-white/30 focus:outline-none resize-none disabled:opacity-50"
                placeholder="Paste your Cashu token here..."
              />
              <button
                onClick={handleReceiveToken}
                disabled={isImporting || !tokenToImport.trim() || isLoading}
                className="w-full bg-white/10 border border-white/10 text-white py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
                type="button"
              >
                {isImporting ? 'Importing...' : 'Import Token'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DepositModal;