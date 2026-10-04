"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { getTokenMetadata, MintQuoteState } from "@cashu/cashu-ts";
import { useInvoiceSync } from "@/hooks/useInvoiceSync";
import { useChat } from "@/context/ChatProvider";
import {
  useCashuToken,
  useCashuStore,
  formatBalance,
  useTransactionHistoryStore,
} from "@/features/wallet";
import { useCashuWallet } from "@/features/wallet";
import { createLightningInvoice, mintTokensFromPaidInvoice } from "@/lib/cashuLightning";
import { createPendingTransaction } from "@/utils/transactionUtils";
import { getPendingCashuTokenAmount } from "@/utils/cashuUtils";
import {
  requestBitcoinConnectProvider,
  useBitcoinConnectStatus,
} from "@/hooks/useBitcoinConnect";

export function useWalletReceive(navigateToTab: (tab: "overview" | "invoice") => void) {
  const { balance, currentMintUnit } = useChat();
  const { addInvoice, updateInvoice } = useInvoiceSync();
  const { receiveToken } = useCashuToken();
  const cashuStore = useCashuStore();
  const { updateProofs } = useCashuWallet();
  const transactionHistoryStore = useTransactionHistoryStore();
  const { status: bcStatus, balance: bcBalance, connect: connectWallet } = useBitcoinConnectStatus();

  const [localBalance, setLocalBalance] = useState(0);
  const balanceIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const tick = () => setLocalBalance(balance + getPendingCashuTokenAmount());
    tick();
    if (balanceIntervalRef.current) clearInterval(balanceIntervalRef.current);
    balanceIntervalRef.current = setInterval(tick, 210);
    return () => {
      if (balanceIntervalRef.current) {
        clearInterval(balanceIntervalRef.current);
        balanceIntervalRef.current = null;
      }
    };
  }, [balance]);

  const [receiveTab, setReceiveTab] = useState<"lightning" | "token">("lightning");
  const [mintAmount, setMintAmount] = useState("");
  const [tokenToImport, setTokenToImport] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isNip60Processing, setIsNip60Processing] = useState(false);
  const [isBcPaying, setIsBcPaying] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [nip60Invoice, setNip60Invoice] = useState("");
  const [nip60QuoteId, setNip60QuoteId] = useState("");
  const [nip60ExpiresAt, setNip60ExpiresAt] = useState<number | undefined>(undefined);
  const nip60QuoteIdRef = useRef<string>("");
  const nip60InvoiceIdRef = useRef<string>("");
  const [nip60PendingTxId, setNip60PendingTxId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setReceiveTab("lightning");
    setMintAmount("");
    setTokenToImport("");
    setIsImporting(false);
    setIsNip60Processing(false);
    setIsBcPaying(false);
    setError("");
    setSuccessMessage("");
    setNip60Invoice("");
    setNip60QuoteId("");
    setNip60ExpiresAt(undefined);
    nip60QuoteIdRef.current = "";
    nip60InvoiceIdRef.current = "";
    setNip60PendingTxId(null);
  }, []);

  const checkNip60PaymentStatus = useCallback(
    async (
      mintUrl: string,
      quoteId: string,
      amount: number,
      pendingTxId: string,
      invoiceId: string
    ) => {
      try {
        const proofs = await mintTokensFromPaidInvoice(mintUrl, quoteId, amount);
        if (proofs.length > 0) {
          await updateProofs({ mintUrl, proofsToAdd: proofs, proofsToRemove: [] });
          await updateInvoice(invoiceId, {
            state: MintQuoteState.ISSUED,
            paidAt: Date.now(),
            claimError: undefined,
          });
          transactionHistoryStore.removePendingTransaction(pendingTxId);
          setNip60PendingTxId(null);
          setSuccessMessage(`Received ${formatBalance(amount, currentMintUnit)}s!`);
          setNip60Invoice("");
          setNip60QuoteId("");
          nip60QuoteIdRef.current = "";
          nip60InvoiceIdRef.current = "";
          setMintAmount("");
          navigateToTab("overview");
          setTimeout(() => setSuccessMessage(""), 5000);
        } else {
          setTimeout(() => {
            if (nip60QuoteIdRef.current === quoteId) {
              checkNip60PaymentStatus(mintUrl, quoteId, amount, pendingTxId, invoiceId);
            }
          }, 5000);
        }
      } catch (err) {
        if (!(err instanceof Error && err.message.includes("not been paid"))) {
          setError(
            "Failed to check payment status: " +
              (err instanceof Error ? err.message : String(err))
          );
        } else {
          setTimeout(() => {
            if (nip60QuoteIdRef.current === quoteId) {
              checkNip60PaymentStatus(mintUrl, quoteId, amount, pendingTxId, invoiceId);
            }
          }, 5000);
        }
      }
    },
    [updateProofs, updateInvoice, transactionHistoryStore, currentMintUnit, navigateToTab]
  );

  const createNip60Invoice = useCallback(
    async (amount: number) => {
      if (!cashuStore.activeMintUrl) {
        setError("No active mint selected. Please select a mint in your wallet settings.");
        return;
      }
      try {
        setIsNip60Processing(true);
        setError("");
        const invoiceData = await createLightningInvoice(cashuStore.activeMintUrl, amount);
        setNip60Invoice(invoiceData.paymentRequest);
        setNip60QuoteId(invoiceData.quoteId);
        setNip60ExpiresAt(invoiceData.expiresAt);
        nip60QuoteIdRef.current = invoiceData.quoteId;
        const storedInvoice = await addInvoice({
          type: "mint",
          mintUrl: cashuStore.activeMintUrl,
          quoteId: invoiceData.quoteId,
          paymentRequest: invoiceData.paymentRequest,
          amount,
          state: MintQuoteState.UNPAID,
          expiresAt: invoiceData.expiresAt,
        });
        nip60InvoiceIdRef.current = storedInvoice.id;
        const pendingTransaction = createPendingTransaction({
          direction: "in",
          amount,
          mintUrl: cashuStore.activeMintUrl,
          quoteId: invoiceData.quoteId,
          paymentRequest: invoiceData.paymentRequest,
        });
        transactionHistoryStore.addPendingTransaction(pendingTransaction);
        setNip60PendingTxId(pendingTransaction.id);
        checkNip60PaymentStatus(
          cashuStore.activeMintUrl,
          invoiceData.quoteId,
          amount,
          pendingTransaction.id,
          storedInvoice.id
        );
      } catch (err) {
        setError(
          "Failed to create Lightning invoice: " +
            (err instanceof Error ? err.message : String(err))
        );
      } finally {
        setIsNip60Processing(false);
      }
    },
    [cashuStore.activeMintUrl, transactionHistoryStore, addInvoice, checkNip60PaymentStatus]
  );

  const handleCreateMintQuote = useCallback(async () => {
    const amount = parseInt(mintAmount);
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid amount");
      return;
    }
    await createNip60Invoice(amount);
    navigateToTab("invoice");
  }, [mintAmount, createNip60Invoice, navigateToTab]);

  const handleImportToken = useCallback(async () => {
    if (!tokenToImport) {
      setError("Please enter a token");
      return;
    }
    try {
      setError("");
      setSuccessMessage("");
      setIsImporting(true);
      const unit = getTokenMetadata(tokenToImport).unit;
      const proofs = await receiveToken(tokenToImport);
      const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0);
      setSuccessMessage(
        `Received ${formatBalance(totalAmount, unit ? `${unit}s` : "sats")} successfully!`
      );
      setTokenToImport("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
    }
  }, [tokenToImport, receiveToken]);

  const handlePayWithBitcoinConnect = useCallback(
    async (invoice: string, quoteId: string) => {
      if (!invoice) return;
      setIsBcPaying(true);
      try {
        const provider = await requestBitcoinConnectProvider();
        try {
          await provider.sendPayment(invoice);
        } catch {
          // Some wallets may not return preimage — rely on polling
        }
        if (quoteId && cashuStore.activeMintUrl) {
          const amt = parseInt(mintAmount || "0", 10) || 0;
          if (amt > 0 && nip60PendingTxId) {
            try {
              await checkNip60PaymentStatus(
                cashuStore.activeMintUrl,
                quoteId,
                amt,
                nip60PendingTxId,
                nip60InvoiceIdRef.current
              );
            } catch {}
          }
        }
      } catch {
        // ignore provider errors
      } finally {
        setIsBcPaying(false);
      }
    },
    [cashuStore.activeMintUrl, mintAmount, nip60PendingTxId, checkNip60PaymentStatus]
  );

  return {
    localBalance,
    bcStatus,
    bcBalance,
    connectWallet,
    isBcPaying,
    receiveTab,
    setReceiveTab,
    mintAmount,
    setMintAmount,
    tokenToImport,
    setTokenToImport,
    isImporting,
    isNip60Processing,
    error,
    setError,
    successMessage,
    setSuccessMessage,
    nip60Invoice,
    nip60QuoteId,
    nip60ExpiresAt,
    reset,
    createNip60Invoice,
    handleCreateMintQuote,
    handleImportToken,
    handlePayWithBitcoinConnect,
    checkNip60PaymentStatus,
  };
}
