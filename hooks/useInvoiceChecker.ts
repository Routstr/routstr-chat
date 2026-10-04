import { useEffect, useRef, useCallback, useState } from "react";
import { useInvoiceSync, StoredInvoice } from "./useInvoiceSync";
import { Mint, Wallet, MintQuoteState, MeltQuoteState } from "@cashu/cashu-ts";
import { toast } from "sonner";
import { formatBalance } from "@/features/wallet";
import { useTransactionHistoryStore } from "@/features/wallet";
import { mintTokensFromPaidInvoice } from "@/lib/cashuLightning";
import { MintRecoveryUnavailableError } from "@/lib/mintQuoteRecovery";

export function useInvoiceChecker() {
  const { getPendingInvoices, updateInvoice, cleanupOldInvoices } =
    useInvoiceSync();
  const transactionHistoryStore = useTransactionHistoryStore();
  const [isChecking, setIsChecking] = useState(false);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckRef = useRef<number>(0);

  // Check a single mint invoice
  const checkMintInvoice = useCallback(
    async (invoice: StoredInvoice) => {
      let remoteState: MintQuoteState | undefined;

      try {
        const mint = new Mint(invoice.mintUrl);
        const quoteStatus = await mint.checkMintQuoteBolt11(invoice.quoteId);
        remoteState = quoteStatus.state;

        if (quoteStatus.state === MintQuoteState.UNPAID) {
          if (quoteStatus.state !== invoice.state) {
            await updateInvoice(invoice.id, { state: quoteStatus.state });
          }
          return false;
        }

        if (quoteStatus.state === MintQuoteState.PAID) {
          await updateInvoice(invoice.id, {
            state: MintQuoteState.PAID,
            paidAt: invoice.paidAt || Date.now(),
            claimError: undefined,
          });
        }

        const proofs = await mintTokensFromPaidInvoice(
          invoice.mintUrl,
          invoice.quoteId,
          invoice.amount,
          1
        );
        if (proofs.length === 0) {
          throw new Error("Mint returned no proofs for the paid quote");
        }

        await updateInvoice(invoice.id, {
          state: MintQuoteState.ISSUED,
          paidAt: invoice.paidAt || Date.now(),
          retryCount: 0,
          nextRetryAt: undefined,
          claimError: undefined,
        });

        const pendingTx = transactionHistoryStore.pendingTransactions.find(
          (tx) => tx.quoteId === invoice.quoteId
        );
        if (pendingTx) {
          transactionHistoryStore.removePendingTransaction(pendingTx.id);
        }
        toast.success(
          `Received ${formatBalance(invoice.amount, "sats")} from Lightning`,
          { duration: 5000 }
        );
        return true;
      } catch (error) {
        console.error(`Error checking mint invoice ${invoice.id}:`, error);

        const retryCount = (invoice.retryCount || 0) + 1;
        await updateInvoice(invoice.id, {
          state:
            remoteState === MintQuoteState.ISSUED
              ? MintQuoteState.ISSUED
              : remoteState === MintQuoteState.PAID
                ? MintQuoteState.PAID
                : invoice.state,
          paidAt:
            remoteState === MintQuoteState.PAID ||
            remoteState === MintQuoteState.ISSUED
              ? invoice.paidAt || Date.now()
              : invoice.paidAt,
          retryCount,
          claimError:
            remoteState === MintQuoteState.ISSUED
              ? error instanceof MintRecoveryUnavailableError
                ? "missing_preview"
                : "recovery_pending"
              : invoice.claimError,
        });

        if (
          remoteState === MintQuoteState.PAID ||
          remoteState === MintQuoteState.ISSUED
        ) {
          toast.error(
            error instanceof MintRecoveryUnavailableError
              ? "Payment was issued, but its local recovery data is missing."
              : "Payment confirmed, but sats have not reached the wallet. Retry from invoice history."
          );
        }
        return false;
      }
    },
    [transactionHistoryStore, updateInvoice]
  );

  // Check a single melt invoice
  const checkMeltInvoice = useCallback(
    async (invoice: StoredInvoice) => {
      try {
        const mint = new Mint(invoice.mintUrl);
        const wallet = new Wallet(mint);
        await wallet.loadMint();

        const quoteStatus = await wallet.checkMeltQuote(invoice.quoteId);

        if (
          quoteStatus.state === MeltQuoteState.PAID &&
          (invoice.state as string) !== "PAID"
        ) {
          // Payment succeeded
          await updateInvoice(invoice.id, {
            state: MeltQuoteState.PAID,
            paidAt: Date.now(),
            fee: quoteStatus.fee_reserve,
          });

          toast.success(
            `Lightning payment sent successfully! Amount: ${formatBalance(
              invoice.amount,
              "sats"
            )}`,
            { duration: 5000 }
          );

          return true;
        } else if (quoteStatus.state !== invoice.state) {
          // Just update the state if it changed
          await updateInvoice(invoice.id, { state: quoteStatus.state });
        }

        return false;
      } catch (error) {
        console.error(`Error checking melt invoice ${invoice.id}:`, error);

        // Update retry count and next retry time
        const retryCount = (invoice.retryCount || 0) + 1;
        const baseInterval = 30000; // 30 seconds
        const nextRetryDelay = Math.min(
          baseInterval * Math.pow(2, retryCount),
          300000
        ); // Max 5 minutes

        await updateInvoice(invoice.id, {
          retryCount,
          nextRetryAt: Date.now() + nextRetryDelay,
        });

        return false;
      }
    },
    [updateInvoice]
  );

  // Check all pending invoices
  const checkPendingInvoices = useCallback(async () => {
    if (isChecking) return;

    const now = Date.now();
    // Don't check more than once per 10 seconds
    if (now - lastCheckRef.current < 10000) return;

    const pending = getPendingInvoices();
    if (pending.length === 0) return;

    setIsChecking(true);
    lastCheckRef.current = now;

    try {
      const checkPromises = pending.map(async (invoice) => {
        if (invoice.type === "mint") {
          return checkMintInvoice(invoice);
        } else {
          return checkMeltInvoice(invoice);
        }
      });

      const results = await Promise.allSettled(checkPromises);
      const successCount = results.filter(
        (r) => r.status === "fulfilled" && r.value
      ).length;

      if (successCount > 0) {
      }
    } catch (error) {
      console.error("Error checking pending invoices:", error);
    } finally {
      setIsChecking(false);
    }
  }, [isChecking, getPendingInvoices, checkMintInvoice, checkMeltInvoice]);

  // Manual check trigger
  const triggerCheck = useCallback(async () => {
    lastCheckRef.current = 0; // Reset last check time
    await checkPendingInvoices();
  }, [checkPendingInvoices]);

  const retryInvoice = useCallback(
    async (invoice: StoredInvoice) => {
      if (isChecking) return false;
      setIsChecking(true);
      try {
        return invoice.type === "mint"
          ? await checkMintInvoice(invoice)
          : await checkMeltInvoice(invoice);
      } finally {
        setIsChecking(false);
      }
    },
    [isChecking, checkMintInvoice, checkMeltInvoice]
  );

  // Set up automatic checking interval
  useEffect(() => {
    // Check immediately on mount
    checkPendingInvoices();

    // Clean up old invoices on mount
    cleanupOldInvoices();

    // Set up interval for checking (every minute)
    checkIntervalRef.current = setInterval(() => {
      checkPendingInvoices();
    }, 60000);

    // Clean up on unmount
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [checkPendingInvoices, cleanupOldInvoices]);

  // Check on app resume/focus
  useEffect(() => {
    const handleFocus = () => {
      // Check invoices when app comes back to focus
      triggerCheck();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        triggerCheck();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [triggerCheck]);

  return {
    isChecking,
    pendingCount: getPendingInvoices().length,
    triggerCheck,
    retryInvoice,
  };
}
