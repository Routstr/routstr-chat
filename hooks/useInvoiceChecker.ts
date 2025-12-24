import { useEffect, useRef, useCallback, useState } from "react";
import { useInvoiceSync, StoredInvoice } from "./useInvoiceSync";
import { Mint, Wallet, MintQuoteState, MeltQuoteState } from "@cashu/cashu-ts";
import { useCashuStore } from "@/features/wallet";
import { useCashuToken } from "@/features/wallet";
import { toast } from "sonner";
import { formatBalance } from "@/features/wallet";
import { useTransactionHistoryStore } from "@/features/wallet";

export function useInvoiceChecker() {
  const { invoices, getPendingInvoices, updateInvoice, cleanupOldInvoices } =
    useInvoiceSync();
  const cashuStore = useCashuStore();
  const { receiveToken } = useCashuToken();
  const transactionHistoryStore = useTransactionHistoryStore();
  const [isChecking, setIsChecking] = useState(false);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckRef = useRef<number>(0);

  // Check a single mint invoice
  const checkMintInvoice = useCallback(
    async (invoice: StoredInvoice) => {
      try {
        const mint = new Mint(invoice.mintUrl);
        const wallet = new Wallet(mint);
        await wallet.loadMint();

        const quoteStatus = await wallet.checkMintQuote(invoice.quoteId);

        if (
          (quoteStatus.state === MintQuoteState.PAID ||
            quoteStatus.state === MintQuoteState.ISSUED) &&
          (invoice.state as string) !== "PAID" &&
          (invoice.state as string) !== "ISSUED"
        ) {
          // Invoice has been paid, update state first
          await updateInvoice(invoice.id, {
            state: quoteStatus.state,
            paidAt: Date.now(),
          });

          // Only try to mint if state is PAID (not ISSUED, which means tokens already exist)
          if (quoteStatus.state === MintQuoteState.PAID) {
            try {
              const proofs = await wallet.mintProofs(
                invoice.amount,
                invoice.quoteId
              );

              if (proofs.length > 0) {
                // Add proofs to store
                cashuStore.addProofs(proofs, `invoice-${invoice.id}`);

                // Update to ISSUED state after successful minting
                await updateInvoice(invoice.id, {
                  state: MintQuoteState.ISSUED,
                });

                // Remove any pending transaction for this invoice
                const pendingTx =
                  transactionHistoryStore.pendingTransactions.find(
                    (tx) => tx.quoteId === invoice.quoteId
                  );
                if (pendingTx) {
                  transactionHistoryStore.removePendingTransaction(
                    pendingTx.id
                  );
                }

                // Show success notification
                toast.success(
                  `Lightning invoice paid! Received ${formatBalance(
                    invoice.amount,
                    "sats"
                  )}`,
                  { duration: 5000 }
                );

                return true;
              }
            } catch (mintError) {
              console.error(
                "Error minting tokens for paid invoice:",
                mintError
              );

              // Check if tokens were already issued (in case of race condition)
              try {
                const recheckStatus = await wallet.checkMintQuote(
                  invoice.quoteId
                );
                if (recheckStatus.state === MintQuoteState.ISSUED) {
                  // Tokens were already issued, try to recover them
                  const proofs = await wallet.mintProofs(
                    invoice.amount,
                    invoice.quoteId
                  );
                  if (proofs.length > 0) {
                    cashuStore.addProofs(proofs, `invoice-${invoice.id}`);
                    await updateInvoice(invoice.id, {
                      state: MintQuoteState.ISSUED,
                    });

                    // Remove any pending transaction for this invoice
                    const pendingTx =
                      transactionHistoryStore.pendingTransactions.find(
                        (tx) => tx.quoteId === invoice.quoteId
                      );
                    if (pendingTx) {
                      transactionHistoryStore.removePendingTransaction(
                        pendingTx.id
                      );
                    }

                    toast.success(
                      `Lightning invoice paid! Recovered ${formatBalance(
                        invoice.amount,
                        "sats"
                      )}`,
                      { duration: 5000 }
                    );
                    return true;
                  }
                }
              } catch (recoveryError) {
                console.error("Failed to recover tokens:", recoveryError);
              }

              toast.error(
                "Invoice paid but failed to mint tokens. Will retry automatically."
              );
            }
          } else if (quoteStatus.state === MintQuoteState.ISSUED) {
            // Tokens were already issued, check if we need to recover them
            // Check if we already have these tokens by checking our balance before attempting recovery
            const proofsBefore = cashuStore.proofs;
            const balanceBefore = proofsBefore.reduce(
              (sum, p) => sum + p.amount,
              0
            );

            try {
              const proofs = await wallet.mintProofs(
                invoice.amount,
                invoice.quoteId
              );
              if (proofs.length > 0) {
                cashuStore.addProofs(proofs, `invoice-${invoice.id}`);

                // Only show success if balance actually increased (tokens were recovered)
                const proofsAfter = cashuStore.proofs;
                const balanceAfter = proofsAfter.reduce(
                  (sum, p) => sum + p.amount,
                  0
                );
                if (balanceAfter > balanceBefore) {
                  // Remove any pending transaction for this invoice
                  const pendingTx =
                    transactionHistoryStore.pendingTransactions.find(
                      (tx) => tx.quoteId === invoice.quoteId
                    );
                  if (pendingTx) {
                    transactionHistoryStore.removePendingTransaction(
                      pendingTx.id
                    );
                  }

                  toast.success(
                    `Lightning invoice paid! Recovered ${formatBalance(
                      invoice.amount,
                      "sats"
                    )}`,
                    { duration: 5000 }
                  );
                }
                return true;
              }
            } catch (recoveryError: any) {
              // Silently ignore "already issued" errors - this is normal
              if (!recoveryError?.message?.includes("already issued")) {
                console.error(
                  "Failed to recover issued tokens:",
                  recoveryError
                );
                // Only show warning for actual recovery failures, not for already-claimed tokens
                toast.warning(
                  "Invoice was paid but tokens need manual recovery."
                );
              }
            }
          }
        } else if (quoteStatus.state !== invoice.state) {
          // Just update the state if it changed
          await updateInvoice(invoice.id, { state: quoteStatus.state });
        }

        return false;
      } catch (error) {
        console.error(`Error checking mint invoice ${invoice.id}:`, error);

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
    [cashuStore, updateInvoice]
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
  };
}
