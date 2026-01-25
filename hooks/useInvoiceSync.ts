/**
 * Hook to fetch and manage user's invoices synced with the cloud
 *
 * Uses the generic config sync system with applesauce relayPool.
 *
 * Features:
 * - Cloud sync via Nostr (NIP-78)
 * - Local storage fallback/merge
 * - Automatic invoice cleanup
 * - Exponential backoff for retries
 */

import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";
import { useAppContext } from "@/hooks/useAppContext";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { MintQuoteState, MeltQuoteState } from "@cashu/cashu-ts";
import {
  invoices$,
  configSyncLoading$,
  genericConfigSync$,
  publishConfig,
  CONFIG_TYPES,
  relayUrls$,
  userPubkey$,
  userSigner$,
  configSyncEose$,
  type UserSignerInfo,
} from "@/hooks/sync";

export interface StoredInvoice {
  id: string;
  type: "mint" | "melt";
  mintUrl: string;
  quoteId: string;
  paymentRequest: string;
  amount: number;
  state: MintQuoteState | MeltQuoteState;
  createdAt: number;
  expiresAt?: number;
  checkedAt?: number;
  paidAt?: number;
  fee?: number;
  retryCount?: number;
  nextRetryAt?: number;
}

interface InvoiceStore {
  invoices: StoredInvoice[];
  lastSync: number;
}

export function useInvoiceSync() {
  const { config } = useAppContext();
  const { manager } = useAccountManager();
  const activeAccount = useObservableState(manager.active$);

  // Subscribe to the generic config sync
  const cloudInvoices = useObservableState(invoices$, []);
  const isLoading = useObservableState(configSyncLoading$, true);
  const syncEose = useObservableState(configSyncEose$, false);

  // Pending state for mutations
  const [isPending, setIsPending] = useState(false);

  // Track whether we've done initial merge
  const hasMergedRef = useRef(false);

  // Cloud sync enabled state (persisted to localStorage)
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("invoice_cloud_sync_enabled") !== "false";
    }
    return true;
  });

  // Persist cloud sync enabled to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "invoice_cloud_sync_enabled",
        String(cloudSyncEnabled)
      );
    }
  }, [cloudSyncEnabled]);

  // Update reactive inputs when account/config changes
  useEffect(() => {
    if (config.relayUrls.length > 0) {
      relayUrls$.next(config.relayUrls);
    }
  }, [config.relayUrls]);

  useEffect(() => {
    if (activeAccount?.pubkey) {
      userPubkey$.next(activeAccount.pubkey);
    } else {
      userPubkey$.next(null);
    }
  }, [activeAccount?.pubkey]);

  useEffect(() => {
    if (activeAccount && activeAccount.nip44 && activeAccount.signEvent) {
      const signerInfo: UserSignerInfo = {
        signer: {
          nip44: {
            encrypt: activeAccount.nip44.encrypt.bind(activeAccount.nip44),
            decrypt: activeAccount.nip44.decrypt.bind(activeAccount.nip44),
          },
          signEvent: activeAccount.signEvent.bind(activeAccount),
        },
        pubkey: activeAccount.pubkey,
      };
      userSigner$.next(signerInfo);
    } else {
      userSigner$.next(null);
    }
  }, [activeAccount]);

  // Subscribe to generic config sync to keep it active
  useEffect(() => {
    if (!cloudSyncEnabled || !activeAccount) return;

    const subscription = genericConfigSync$.subscribe({
      error: (err) => {
        console.error("[useInvoiceSync] Sync error:", err);
      },
    });

    return () => subscription.unsubscribe();
  }, [cloudSyncEnabled, activeAccount]);

  // Local storage operations
  const getLocalInvoices = useCallback((): StoredInvoice[] => {
    if (typeof window === "undefined") return [];
    const stored = localStorage.getItem("lightning_invoices");
    if (!stored) return [];
    try {
      const data = JSON.parse(stored) as InvoiceStore;
      return data.invoices || [];
    } catch {
      return [];
    }
  }, []);

  const saveLocalInvoices = useCallback((invoices: StoredInvoice[]) => {
    if (typeof window === "undefined") return;
    const store: InvoiceStore = {
      invoices,
      lastSync: Date.now(),
    };
    localStorage.setItem("lightning_invoices", JSON.stringify(store));
  }, []);

  // Merge cloud and local invoices
  const mergedInvoices = useMemo(() => {
    const localInvoices = getLocalInvoices();

    if (!cloudSyncEnabled || !activeAccount) {
      return localInvoices;
    }

    // Merge cloud and local invoices
    const mergedMap = new Map<string, StoredInvoice>();

    // Add all cloud invoices
    cloudInvoices.forEach((inv) => mergedMap.set(inv.id, inv));

    // Add/update with local invoices (local takes precedence for newer data)
    localInvoices.forEach((inv) => {
      const existing = mergedMap.get(inv.id);
      if (!existing || (inv.checkedAt || 0) > (existing.checkedAt || 0)) {
        mergedMap.set(inv.id, inv);
      }
    });

    return Array.from(mergedMap.values());
  }, [cloudInvoices, cloudSyncEnabled, activeAccount, getLocalInvoices]);

  // Save merged invoices to local storage after initial sync
  useEffect(() => {
    if (
      syncEose &&
      !hasMergedRef.current &&
      cloudSyncEnabled &&
      activeAccount
    ) {
      hasMergedRef.current = true;
      saveLocalInvoices(mergedInvoices);
    }
  }, [
    syncEose,
    cloudSyncEnabled,
    activeAccount,
    mergedInvoices,
    saveLocalInvoices,
  ]);

  // Reset merge flag when account changes
  useEffect(() => {
    hasMergedRef.current = false;
  }, [activeAccount?.pubkey]);

  // Get current signer info for publishing
  const getSignerInfo = useCallback((): UserSignerInfo | null => {
    return userSigner$.getValue();
  }, []);

  // Internal sync helper
  const syncToCloud = useCallback(
    async (invoices: StoredInvoice[]): Promise<void> => {
      if (!activeAccount || !cloudSyncEnabled) return;

      const signerInfo = getSignerInfo();
      if (!signerInfo) return;

      // Filter out expired invoices older than 7 days
      const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const relevantInvoices = invoices.filter((inv) => {
        if (
          (inv.state as string) === "PAID" ||
          (inv.state as string) === "ISSUED"
        ) {
          return true;
        }
        return inv.createdAt > cutoffTime;
      });

      setIsPending(true);
      try {
        await publishConfig(
          CONFIG_TYPES.INVOICES,
          relevantInvoices,
          signerInfo,
          config.relayUrls
        );
      } finally {
        setIsPending(false);
      }
    },
    [activeAccount, cloudSyncEnabled, config.relayUrls, getSignerInfo]
  );

  // Add new invoice
  const addInvoice = useCallback(
    async (invoice: Omit<StoredInvoice, "id" | "createdAt" | "checkedAt">) => {
      const newInvoice: StoredInvoice = {
        ...invoice,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        checkedAt: Date.now(),
      };

      // Update local storage
      const existing = getLocalInvoices();
      const updated = [
        ...existing.filter((inv) => inv.id !== newInvoice.id),
        newInvoice,
      ];
      saveLocalInvoices(updated);

      // Sync to cloud
      await syncToCloud(updated);

      return newInvoice;
    },
    [getLocalInvoices, saveLocalInvoices, syncToCloud]
  );

  // Update invoice
  const updateInvoice = useCallback(
    async (id: string, updates: Partial<StoredInvoice>) => {
      const existing = getLocalInvoices();
      const updated = existing.map((inv) =>
        inv.id === id ? { ...inv, ...updates, checkedAt: Date.now() } : inv
      );
      saveLocalInvoices(updated);

      // Sync to cloud
      await syncToCloud(updated);
    },
    [getLocalInvoices, saveLocalInvoices, syncToCloud]
  );

  // Get pending invoices that need checking
  const getPendingInvoices = useCallback((): StoredInvoice[] => {
    const now = Date.now();
    const MAX_RETRIES = 10;

    return mergedInvoices.filter((inv) => {
      // Skip if already successfully issued (tokens minted)
      if ((inv.state as string) === "ISSUED") {
        return false;
      }

      // Skip if max retries exceeded
      if ((inv.retryCount || 0) >= MAX_RETRIES) {
        return false;
      }

      // Skip if expired (assuming 1 hour expiry if not specified)
      const expiryTime = inv.expiresAt || inv.createdAt + 3600000;
      if (now > expiryTime) {
        return false;
      }

      // Respect exponential backoff timing
      if (inv.nextRetryAt && now < inv.nextRetryAt) {
        return false;
      }

      // Initial check or retry based on backoff
      const retryCount = inv.retryCount || 0;
      const lastCheck = inv.checkedAt || inv.createdAt;
      const baseInterval = 30000; // 30 seconds
      const backoffInterval = Math.min(
        baseInterval * Math.pow(2, retryCount),
        300000
      ); // Max 5 minutes

      return now - lastCheck > backoffInterval;
    });
  }, [mergedInvoices]);

  // Clean up old invoices
  const cleanupOldInvoices = useCallback(async () => {
    const invoices = getLocalInvoices();
    const cutoffTime = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
    const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days for PAID

    const cleaned = invoices.filter((inv) => {
      // Keep all ISSUED invoices from last 30 days
      if ((inv.state as string) === "ISSUED") {
        return inv.createdAt > cutoffTime;
      }
      // Keep PAID invoices from last 7 days (might need token recovery)
      if ((inv.state as string) === "PAID") {
        return inv.createdAt > recentCutoff;
      }
      // Keep unpaid invoices from last 24 hours
      return inv.createdAt > Date.now() - 86400000;
    });

    if (cleaned.length !== invoices.length) {
      saveLocalInvoices(cleaned);
      await syncToCloud(cleaned);
    }
  }, [getLocalInvoices, saveLocalInvoices, syncToCloud]);

  // Delete invoice
  const deleteInvoice = useCallback(
    async (id: string) => {
      const invoices = getLocalInvoices();
      const filtered = invoices.filter((inv) => inv.id !== id);
      saveLocalInvoices(filtered);
      await syncToCloud(filtered);
    },
    [getLocalInvoices, saveLocalInvoices, syncToCloud]
  );

  // Reset retry count for an invoice
  const resetInvoiceRetry = useCallback(
    async (id: string) => {
      await updateInvoice(id, {
        retryCount: 0,
        nextRetryAt: undefined,
        checkedAt: undefined,
      });
    },
    [updateInvoice]
  );

  // Manual refetch (triggers sync re-subscription)
  const refetch = useCallback(() => {
    // Reset EOSE to trigger new sync
    configSyncEose$.next(false);
    hasMergedRef.current = false;
  }, []);

  return {
    invoices: mergedInvoices,
    isLoading,
    isSyncing: isPending,
    addInvoice,
    updateInvoice,
    deleteInvoice,
    resetInvoiceRetry,
    getPendingInvoices,
    cleanupOldInvoices,
    cloudSyncEnabled,
    setCloudSyncEnabled,
    refetch,
  };
}
