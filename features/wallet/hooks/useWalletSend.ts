"use client";

import { useState, useCallback, useRef } from "react";
import { MeltQuoteState } from "@cashu/cashu-ts";
import { useInvoiceSync } from "@/hooks/useInvoiceSync";
import { useChat } from "@/context/ChatProvider";
import {
  useCashuToken,
  useCashuStore,
  useUnclaimedTokensStore,
  formatBalance,
  calculateBalanceByMint,
  type UnclaimedToken,
} from "@/features/wallet";
import { getCurrentMintBalance as utilGetCurrentMintBalance } from "@/utils/walletUtils";
import { createMeltQuote } from "@/lib/cashuLightning";
import { dismissToken, useBook } from "./useBook";
import { useCashuWithXYZ } from "@/hooks/useCashuWithXYZ";
import { toast } from "sonner";

export function useWalletSend() {
  const { currentMintUnit } = useChat();
  const { addInvoice, updateInvoice } = useInvoiceSync();
  const { receiveToken } = useCashuToken();
  const cashuStore = useCashuStore();
  const unclaimedTokensStore = useUnclaimedTokensStore();
  const { activeExecutor } = useBook();
  const { spendCashu } = useCashuWithXYZ();

  // Send tab state
  const [sendTab, setSendTab] = useState<"token" | "lightning">("token");
  const [sendAmount, setSendAmount] = useState("");
  const [isGeneratingSendToken, setIsGeneratingSendToken] = useState(false);
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const [reclaimingTokenId, setReclaimingTokenId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [warningMessage, setWarningMessage] = useState("");

  // Lightning send state
  const [nip60SendInvoice, setNip60SendInvoice] = useState("");
  const [nip60MeltQuoteId, setNip60MeltQuoteId] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState<number | null>(null);
  const [invoiceFeeReserve, setInvoiceFeeReserve] = useState<number | null>(null);
  const [isNip60Processing, setIsNip60Processing] = useState(false);
  const [isNip60LoadingInvoice, setIsNip60LoadingInvoice] = useState(false);
  const nip60ProcessingInvoiceRef = useRef<string | null>(null);
  const reclaimsInFlightRef = useRef<Set<string>>(new Set());

  // Unclaimed send tokens live in the wallet book, not this resettable UI state.
  const reset = useCallback(() => {
    setSendAmount("");
    setSendTab("token");
    setError("");
    setSuccessMessage("");
    setWarningMessage("");
    setCopiedTokenId(null);
    setIsGeneratingSendToken(false);
    setNip60SendInvoice("");
    setNip60MeltQuoteId("");
    setInvoiceAmount(null);
    setInvoiceFeeReserve(null);
    setIsNip60Processing(false);
    setIsNip60LoadingInvoice(false);
    nip60ProcessingInvoiceRef.current = null;
  }, []);

  const copyToClipboard = useCallback(
    async (text: string, label = "Text", tokenId: string | null = null) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedTokenId(tokenId);
        setWarningMessage("");
        setSuccessMessage(`${label} copied to clipboard!`);
        setTimeout(() => {
          setCopiedTokenId(null);
          setSuccessMessage("");
        }, 2000);
      } catch {
        setError("Failed to copy to clipboard");
      }
    },
    []
  );

  const generateSendToken = useCallback(async () => {
    if (!sendAmount || isNaN(parseInt(sendAmount))) {
      setError("Please enter a valid amount");
      return;
    }
    const mintUrl = cashuStore.activeMintUrl;
    if (!mintUrl) {
      setError("No active mint selected. Please select a mint first.");
      return;
    }
    try {
      setError("");
      setSuccessMessage("");
      setWarningMessage("");
      setIsGeneratingSendToken(true);
      const amountValue =
        currentMintUnit === "msat" ? parseInt(sendAmount) / 1000 : parseInt(sendAmount);
      const result = await spendCashu(mintUrl, amountValue, "");
      if (result.status === "success" && result.token) {
        setSendAmount("");
        setSuccessMessage(`Token generated for ${formatBalance(amountValue, currentMintUnit)}`);
      } else {
        setError(result.error || "Failed to generate token");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingSendToken(false);
    }
  }, [sendAmount, cashuStore.activeMintUrl, currentMintUnit, spendCashu]);

  const reclaimUnclaimedToken = useCallback(
    async (entry: UnclaimedToken) => {
      // Synchronous guard: the disabled prop renders too late to stop a
      // fast double-click from receiving the same token twice.
      if (reclaimsInFlightRef.current.has(entry.id)) return;
      reclaimsInFlightRef.current.add(entry.id);
      try {
        setReclaimingTokenId(entry.id);
        setError("");
        setWarningMessage("");
        // Strict: only counts as reclaimed once the proofs are stored, so
        // the entry is never removed while the funds are in limbo.
        const proofs = await receiveToken(entry.token, true);
        const total = proofs.reduce((sum, p) => sum + p.amount, 0);
        dismissToken(entry.id);
        setSuccessMessage(`Reclaimed ${formatBalance(total, entry.unit)} back to your wallet`);
        setTimeout(() => setSuccessMessage(""), 5000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already spent|already claimed|already redeemed/i.test(msg)) {
          // Redeemed by the recipient, or by an earlier reclaim whose
          // storage failed (the wallet book stores those funds later).
          dismissToken(entry.id);
          setSuccessMessage("");
          setWarningMessage("Token was already redeemed.");
          setTimeout(() => setWarningMessage(""), 5000);
        } else {
          setError(`Failed to reclaim token: ${msg}`);
        }
      } finally {
        reclaimsInFlightRef.current.delete(entry.id);
        setReclaimingTokenId(null);
      }
    },
    [receiveToken]
  );

  const handleNip60InvoiceInput = useCallback(
    async (value: string) => {
      if (!cashuStore.activeMintUrl) {
        setError("No active mint selected. Please select a mint in your wallet settings.");
        return;
      }
      if (nip60ProcessingInvoiceRef.current === value || nip60MeltQuoteId) return;

      setNip60SendInvoice(value);
      nip60ProcessingInvoiceRef.current = value;

      const mintUrl = cashuStore.activeMintUrl;
      try {
        setIsNip60LoadingInvoice(true);
        const meltQuote = await createMeltQuote(mintUrl, value);
        setNip60MeltQuoteId(meltQuote.quote);
        setInvoiceAmount(meltQuote.amount);
        setInvoiceFeeReserve(meltQuote.fee_reserve);
        await addInvoice({
          type: "melt",
          mintUrl,
          quoteId: meltQuote.quote,
          paymentRequest: value,
          amount: meltQuote.amount,
          state: MeltQuoteState.UNPAID,
          fee: meltQuote.fee_reserve,
        });
      } catch (err) {
        setError("Failed to create melt quote: " + (err instanceof Error ? err.message : String(err)));
        setNip60MeltQuoteId("");
        setNip60SendInvoice("");
        setInvoiceAmount(null);
        setInvoiceFeeReserve(null);
      } finally {
        setIsNip60LoadingInvoice(false);
        nip60ProcessingInvoiceRef.current = null;
      }
    },
    [cashuStore.activeMintUrl, nip60MeltQuoteId, addInvoice]
  );

  const handleNip60PaymentCancel = useCallback(() => {
    setNip60SendInvoice("");
    setNip60MeltQuoteId("");
    setInvoiceAmount(null);
    setInvoiceFeeReserve(null);
    nip60ProcessingInvoiceRef.current = null;
  }, []);

  const handlePayLightningInvoice = useCallback(async () => {
    if (!nip60SendInvoice) {
      setError("Please enter a Lightning invoice");
      return;
    }
    if (error && nip60SendInvoice) {
      await handleNip60InvoiceInput(nip60SendInvoice);
    }
    if (!cashuStore.activeMintUrl) {
      setError("No active mint selected. Please select a mint in your wallet settings.");
      return;
    }
    if (!invoiceAmount) {
      setError("Could not parse invoice amount");
      return;
    }
    try {
      setIsNip60Processing(true);
      setError("");
      setWarningMessage("");
      const mintUrl = cashuStore.activeMintUrl;
      const selectedProofs = await cashuStore.getMintProofs(mintUrl);
      const totalProofsAmount = selectedProofs.reduce((sum, p) => sum + p.amount, 0);
      if (totalProofsAmount < invoiceAmount + (invoiceFeeReserve || 0)) {
        setError(
          `Insufficient balance: have ${formatBalance(totalProofsAmount, currentMintUnit)}s, need ${formatBalance(invoiceAmount + (invoiceFeeReserve || 0), currentMintUnit)}s`
        );
        setIsNip60Processing(false);
        return;
      }
      const executor = activeExecutor();
      if (!executor) throw new Error("User not logged in");
      const quote = cashuStore.getMeltQuote(mintUrl, nip60MeltQuoteId);
      const result = await executor.pay(mintUrl, quote, selectedProofs);
      const amount = `${formatBalance(invoiceAmount, currentMintUnit)}s`;
      if (result.state === "failed") {
        await updateInvoice(nip60MeltQuoteId, { state: MeltQuoteState.UNPAID });
        setError(
          "The payment did not go through. Your sats are back in the wallet."
        );
      } else {
        const paid = result.state === "paid";
        await updateInvoice(
          nip60MeltQuoteId,
          paid
            ? { state: MeltQuoteState.PAID, paidAt: Date.now() }
            : { state: MeltQuoteState.PENDING }
        );
        setSuccessMessage(
          paid
            ? `Paid ${amount}!`
            : `Sending ${amount}, waiting for the network to confirm.`
        );
        handleNip60PaymentCancel();
        setTimeout(() => setSuccessMessage(""), 5000);
      }
    } catch (err) {
      setError("Failed to pay Lightning invoice: " + (err instanceof Error ? err.message : String(err)));
      setNip60MeltQuoteId("");
    } finally {
      setIsNip60Processing(false);
    }
  }, [
    nip60SendInvoice,
    cashuStore.activeMintUrl,
    invoiceAmount,
    invoiceFeeReserve,
    nip60MeltQuoteId,
    activeExecutor,
    error,
    currentMintUnit,
    handleNip60InvoiceInput,
    handleNip60PaymentCancel,
    updateInvoice,
  ]);

  return {
    // state
    sendTab, setSendTab,
    sendAmount, setSendAmount,
    isGeneratingSendToken,
    unclaimedTokens: unclaimedTokensStore.unclaimedTokens,
    copiedTokenId,
    reclaimingTokenId,
    error, setError,
    successMessage,
    warningMessage,
    nip60SendInvoice,
    nip60MeltQuoteId,
    invoiceAmount,
    invoiceFeeReserve,
    isNip60Processing,
    isNip60LoadingInvoice,
    // actions
    reset,
    copyToClipboard,
    generateSendToken,
    dismissUnclaimedToken: dismissToken,
    reclaimUnclaimedToken,
    handleNip60InvoiceInput,
    handleNip60PaymentCancel,
    handlePayLightningInvoice,
  };
}
