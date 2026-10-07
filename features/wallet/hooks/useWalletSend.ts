"use client";

import { useState, useCallback, useContext, useRef } from "react";
import { MeltQuoteState } from "@cashu/cashu-ts";
import { useInvoiceSync } from "@/hooks/useInvoiceSync";
import { currentOwner } from "@/features/session/owned";
import {
  useCashuStore,
  useUnclaimedTokensStore,
  formatBalance,
  calculateBalanceByMint,
  type UnclaimedToken,
} from "@/features/wallet";
import { getCurrentMintBalance as utilGetCurrentMintBalance } from "@/utils/walletUtils";
import { createMeltQuote, quoteInSats } from "@/lib/cashuLightning";
import { toSats } from "../purse";
import { reclaim } from "../reclaim";
import { AdoptContext, usePurse } from "../view";
import { useActiveMintUnit } from "./useActiveMintUnit";
import { dismissToken } from "./useBook";
import { toast } from "sonner";

export function useWalletSend() {
  const currentMintUnit = useActiveMintUnit();
  const { addInvoice, updateInvoice } = useInvoiceSync();
  const cashuStore = useCashuStore();
  const unclaimedTokensStore = useUnclaimedTokensStore();
  const purse = usePurse();
  const adopt = useContext(AdoptContext);

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
      // typed in the mint's unit
      const sats = toSats(parseInt(sendAmount), currentMintUnit);
      const from = purse();
      if (!from) throw new Error("There is no account to send from.");
      // no handoff: the token stays listed until it is taken back or let go
      await from.send(mintUrl, sats);
      setSendAmount("");
      setSuccessMessage(`Token generated for ${formatBalance(sats, "sat")}s`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingSendToken(false);
    }
  }, [sendAmount, cashuStore.activeMintUrl, currentMintUnit, purse]);

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
        const from = purse();
        const owner = currentOwner();
        if (!from || !owner) throw new Error("User not logged in");
        // settled once this resolves, so the listed token can go
        const done = await reclaim(entry, {
          take: from.take,
          adopt: adopt
            ? (token, baseUrl) => adopt(owner, token, baseUrl)
            : undefined,
        });
        dismissToken(entry.id);
        if (done.kind === "spent") {
          // Redeemed by the recipient, or by an earlier reclaim whose
          // storage failed (the wallet book stores those funds later).
          setSuccessMessage("");
          setWarningMessage("Token was already redeemed.");
          setTimeout(() => setWarningMessage(""), 5000);
        } else {
          setSuccessMessage(
            done.kind === "waiting"
              ? `${formatBalance(done.sats, "sat")}s wait for their mint, and land once it answers`
              : done.kind === "key"
                ? `It became an API key holding ${formatBalance(done.sats, "sat")}s, kept with your keys`
                : `Reclaimed ${formatBalance(done.sats, "sat")}s back to your wallet`
          );
          setTimeout(() => setSuccessMessage(""), 5000);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to reclaim token: ${msg}`);
      } finally {
        reclaimsInFlightRef.current.delete(entry.id);
        setReclaimingTokenId(null);
      }
    },
    [purse, adopt]
  );

  const handleNip60InvoiceInput = useCallback(
    async (value: string) => {
      if (!cashuStore.activeMintUrl) {
        setError("No active mint selected. Please select a mint in your wallet settings.");
        return;
      }
      if (nip60ProcessingInvoiceRef.current === value) return;

      setNip60SendInvoice(value);
      // a quote made for another invoice is never paid for this one
      setNip60MeltQuoteId("");
      setInvoiceAmount(null);
      setInvoiceFeeReserve(null);
      nip60ProcessingInvoiceRef.current = value;

      const mintUrl = cashuStore.activeMintUrl;
      // another invoice can replace this one while its quote is made: then
      // this quote is dropped, and nothing here touches the other's state
      const current = () => nip60ProcessingInvoiceRef.current === value;
      try {
        setIsNip60LoadingInvoice(true);
        const meltQuote = await createMeltQuote(mintUrl, value);
        if (!current()) return;
        setNip60MeltQuoteId(meltQuote.quote);
        // what Send shows and checks is in sats; the quote paid stays in the mint's unit
        const { amount, feeReserve } = quoteInSats(meltQuote);
        setInvoiceAmount(amount);
        setInvoiceFeeReserve(feeReserve);
        await addInvoice({
          type: "melt",
          mintUrl,
          quoteId: meltQuote.quote,
          paymentRequest: value,
          amount,
          state: MeltQuoteState.UNPAID,
          fee: feeReserve,
        });
      } catch (err) {
        if (!current()) return;
        setError("Failed to create melt quote: " + (err instanceof Error ? err.message : String(err)));
        setNip60MeltQuoteId("");
        setNip60SendInvoice("");
        setInvoiceAmount(null);
        setInvoiceFeeReserve(null);
      } finally {
        if (current()) {
          setIsNip60LoadingInvoice(false);
          nip60ProcessingInvoiceRef.current = null;
        }
      }
    },
    [cashuStore.activeMintUrl, addInvoice]
  );

  const handleNip60PaymentCancel = useCallback(() => {
    setNip60SendInvoice("");
    setNip60MeltQuoteId("");
    setInvoiceAmount(null);
    setInvoiceFeeReserve(null);
    // a quote still being made for it is dropped when it answers
    setIsNip60LoadingInvoice(false);
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
      // read before the balance, which reloads the store from what is saved
      const quote = cashuStore.getMeltQuote(mintUrl, nip60MeltQuoteId);
      const from = purse();
      if (!from) throw new Error("User not logged in");
      const have = (await from.balances())[mintUrl] ?? 0;
      if (have < invoiceAmount + (invoiceFeeReserve || 0)) {
        setError(
          `Insufficient balance: have ${formatBalance(have, "sat")}s, need ${formatBalance(invoiceAmount + (invoiceFeeReserve || 0), "sat")}s`
        );
        setIsNip60Processing(false);
        return;
      }
      // the coins are read once the account's lock is held, never before
      const state = await from.pay(mintUrl, quote);
      const amount = `${formatBalance(invoiceAmount, "sat")}s`;
      if (state === "failed") {
        await updateInvoice(nip60MeltQuoteId, { state: MeltQuoteState.UNPAID });
        setError(
          "The payment did not go through. Your sats are back in the wallet."
        );
      } else {
        const paid = state === "paid";
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
    purse,
    error,
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
