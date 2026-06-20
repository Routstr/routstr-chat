"use client";

import { useState, useCallback, useRef } from "react";
import { MeltQuoteState } from "@cashu/cashu-ts";
import { useInvoiceSync } from "@/hooks/useInvoiceSync";
import { useChat } from "@/context/ChatProvider";
import {
  useCashuToken,
  useCashuStore,
  formatBalance,
  calculateBalanceByMint,
} from "@/features/wallet";
import { getCurrentMintBalance as utilGetCurrentMintBalance } from "@/utils/walletUtils";
import { payMeltQuote, createMeltQuote } from "@/lib/cashuLightning";
import { useCashuWithXYZ } from "@/hooks/useCashuWithXYZ";
import { useCashuWallet } from "@/features/wallet";
import { toast } from "sonner";

export function useWalletSend() {
  const { currentMintUnit } = useChat();
  const { addInvoice, updateInvoice } = useInvoiceSync();
  const { cleanSpentProofs, confirmTokenSent } = useCashuToken();
  const cashuStore = useCashuStore();
  const { wallet, updateProofs } = useCashuWallet();
  const { spendCashu } = useCashuWithXYZ();

  // Send tab state
  const [sendTab, setSendTab] = useState<"token" | "lightning">("token");
  const [sendAmount, setSendAmount] = useState("");
  const [isGeneratingSendToken, setIsGeneratingSendToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Lightning send state
  const [nip60SendInvoice, setNip60SendInvoice] = useState("");
  const [nip60MeltQuoteId, setNip60MeltQuoteId] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState<number | null>(null);
  const [invoiceFeeReserve, setInvoiceFeeReserve] = useState<number | null>(null);
  const [isNip60Processing, setIsNip60Processing] = useState(false);
  const [isNip60LoadingInvoice, setIsNip60LoadingInvoice] = useState(false);
  const nip60ProcessingInvoiceRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    setSendAmount("");
    setGeneratedToken("");
    setSendTab("token");
    setError("");
    setSuccessMessage("");
    setCopySuccess(false);
    setIsGeneratingSendToken(false);
    setNip60SendInvoice("");
    setNip60MeltQuoteId("");
    setInvoiceAmount(null);
    setInvoiceFeeReserve(null);
    setIsNip60Processing(false);
    setIsNip60LoadingInvoice(false);
    nip60ProcessingInvoiceRef.current = null;
  }, []);

  const copyToClipboard = useCallback(async (text: string, label = "Text") => {
    try {
      await navigator.clipboard.writeText(text);
      // When the copied text is the generated send token, the user has taken
      // custody of it: confirm the send so the pending-proof backup is cleared
      // and recovery won't re-credit (and thus invalidate) it.
      if (text && text === generatedToken) {
        confirmTokenSent(text);
      }
      setCopySuccess(true);
      setSuccessMessage(`${label} copied to clipboard!`);
      setTimeout(() => {
        setCopySuccess(false);
        setSuccessMessage("");
      }, 2000);
    } catch {
      setError("Failed to copy to clipboard");
    }
  }, [generatedToken, confirmTokenSent]);

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
      setGeneratedToken("");
      setIsGeneratingSendToken(true);
      const amountValue =
        currentMintUnit === "msat" ? parseInt(sendAmount) / 1000 : parseInt(sendAmount);
      const result = await spendCashu(mintUrl, amountValue, "");
      if (result.status === "success" && result.token) {
        setGeneratedToken(result.token);
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
      const result = await payMeltQuote(mintUrl, nip60MeltQuoteId, selectedProofs, cleanSpentProofs);
      if (result.success) {
        await updateProofs({
          mintUrl,
          proofsToAdd: [...result.keep, ...result.change],
          proofsToRemove: selectedProofs,
        });
        await updateInvoice(nip60MeltQuoteId, { state: MeltQuoteState.PAID, paidAt: Date.now() });
        setSuccessMessage(`Paid ${formatBalance(invoiceAmount, currentMintUnit)}s!`);
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
    updateProofs,
    error,
    currentMintUnit,
    handleNip60InvoiceInput,
    handleNip60PaymentCancel,
    cleanSpentProofs,
    updateInvoice,
  ]);

  return {
    // state
    sendTab, setSendTab,
    sendAmount, setSendAmount,
    isGeneratingSendToken,
    generatedToken,
    copySuccess,
    error, setError,
    successMessage,
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
    handleNip60InvoiceInput,
    handleNip60PaymentCancel,
    handlePayLightningInvoice,
  };
}
