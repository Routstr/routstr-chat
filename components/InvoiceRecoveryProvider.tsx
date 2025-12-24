"use client";

import React, { useEffect, useRef, useState } from "react";
import { useInvoiceChecker } from "@/hooks/useInvoiceChecker";
import { useInvoiceSync, StoredInvoice } from "@/hooks/useInvoiceSync";
import { toast } from "sonner";
import { MintQuoteState, MeltQuoteState } from "@cashu/cashu-ts";
import { formatBalance } from "@/features/wallet";

interface InvoiceRecoveryProviderProps {
  children: React.ReactNode;
}

export const InvoiceRecoveryProvider: React.FC<
  InvoiceRecoveryProviderProps
> = ({ children }) => {
  const { invoices, getPendingInvoices } = useInvoiceSync();
  const { triggerCheck } = useInvoiceChecker();
  const hasCheckedOnMount = useRef(false);
  const hasShownRecoveryToast = useRef(false);
  const [trackingInvoices, setTrackingInvoices] = useState<Set<string>>(
    new Set()
  );
  const previousInvoiceStates = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    // Only run once on mount
    if (hasCheckedOnMount.current) return;
    hasCheckedOnMount.current = true;

    // Small delay to let the app initialize
    const checkTimer = setTimeout(async () => {
      const pending = getPendingInvoices();

      if (pending.length > 0 && !hasShownRecoveryToast.current) {
        hasShownRecoveryToast.current = true;

        // Track which invoices we're recovering
        const invoiceIds = new Set(pending.map((inv) => inv.id));
        setTrackingInvoices(invoiceIds);

        // Store initial states
        pending.forEach((inv) => {
          previousInvoiceStates.current.set(inv.id, inv.state as string);
        });

        // Show recovery toast
        toast.info(
          `Found ${pending.length} pending invoice${
            pending.length > 1 ? "s" : ""
          } from previous session. Checking status...`,
          { duration: 5000 }
        );

        // Trigger check
        await triggerCheck();
      }
    }, 2000);

    return () => clearTimeout(checkTimer);
  }, [getPendingInvoices, triggerCheck]);

  // Track recovered invoices
  useEffect(() => {
    if (trackingInvoices.size === 0) return;

    const recoveredInvoices: StoredInvoice[] = [];

    invoices.forEach((inv) => {
      if (trackingInvoices.has(inv.id)) {
        const previousState = previousInvoiceStates.current.get(inv.id);
        const currentState = inv.state as string;

        if (previousState && previousState !== currentState) {
          if (currentState === "PAID" || currentState === "ISSUED") {
            recoveredInvoices.push(inv);
            trackingInvoices.delete(inv.id);
            previousInvoiceStates.current.delete(inv.id);
          }
        }
      }
    });

    if (recoveredInvoices.length > 0) {
      setTrackingInvoices(new Set(trackingInvoices));

      recoveredInvoices.forEach((inv) => {
        const action = inv.type === "mint" ? "Received" : "Sent";
        toast.success(
          `${action} ${formatBalance(
            inv.amount,
            "sats"
          )} - Invoice recovered from previous session`,
          { duration: 6000 }
        );
      });
    }
  }, [invoices, trackingInvoices]);

  // Check for recently paid invoices on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Check if any invoices were recently paid
        const recentlyPaid = invoices.filter((inv) => {
          const isPaid =
            (inv.state as string) === "PAID" ||
            (inv.state as string) === "ISSUED";
          const wasRecentlyPaid = inv.paidAt && Date.now() - inv.paidAt < 60000; // Within last minute
          return isPaid && wasRecentlyPaid && !trackingInvoices.has(inv.id);
        });

        if (recentlyPaid.length > 0) {
          recentlyPaid.forEach((inv) => {
            const type = inv.type === "mint" ? "received" : "sent";
            toast.success(`Invoice ${type} successfully (${inv.amount} sats)`);
          });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [invoices, trackingInvoices]);

  return <>{children}</>;
};
