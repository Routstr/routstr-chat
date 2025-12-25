import { useNostr } from "@/hooks/useNostr";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { KINDS } from "@/lib/nostr-kinds";
import { useState, useEffect, useCallback } from "react";
import { MintQuoteState, MeltQuoteState } from "@cashu/cashu-ts";

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
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const [cloudSyncEnabled, setCloudSyncEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("invoice_cloud_sync_enabled") !== "false";
    }
    return true;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "invoice_cloud_sync_enabled",
        String(cloudSyncEnabled),
      );
    }
  }, [cloudSyncEnabled]);

  const INVOICES_D_TAG = "routstr-chat-invoices-v1";

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

  const addLocalInvoice = useCallback(
    (invoice: StoredInvoice) => {
      const existing = getLocalInvoices();
      const updated = existing.filter((inv) => inv.id !== invoice.id);
      updated.push(invoice);
      saveLocalInvoices(updated);
    },
    [getLocalInvoices, saveLocalInvoices],
  );

  const updateLocalInvoice = useCallback(
    (id: string, updates: Partial<StoredInvoice>) => {
      const existing = getLocalInvoices();
      const updated = existing.map((inv) =>
        inv.id === id ? { ...inv, ...updates, checkedAt: Date.now() } : inv,
      );
      saveLocalInvoices(updated);
    },
    [getLocalInvoices, saveLocalInvoices],
  );

  // Cloud sync mutations
  const syncInvoicesMutation = useMutation({
    mutationFn: async (invoices: StoredInvoice[]) => {
      if (!user || !cloudSyncEnabled) {
        return null;
      }
      if (!user.signer.nip44) {
        throw new Error("NIP-44 encryption not supported");
      }

      // Filter out expired invoices older than 7 days
      const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const relevantInvoices = invoices.filter((inv) => {
        if (
          (inv.state as string) === "PAID" ||
          (inv.state as string) === "ISSUED"
        ) {
          return true; // Keep all paid/issued invoices
        }
        return inv.createdAt > cutoffTime;
      });

      const content = await user.signer.nip44.encrypt(
        user.pubkey,
        JSON.stringify(relevantInvoices),
      );

      const event = await user.signer.signEvent({
        kind: KINDS.ARBITRARY_APP_DATA,
        content,
        tags: [["d", INVOICES_D_TAG]],
        created_at: Math.floor(Date.now() / 1000),
      });

      await nostr.event(event);
      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["invoices", user?.pubkey, INVOICES_D_TAG],
      });
    },
  });

  // Query to fetch invoices from Nostr
  const invoicesQuery = useQuery({
    queryKey: ["invoices", user?.pubkey, INVOICES_D_TAG],
    queryFn: async ({ signal }) => {
      if (!user || !cloudSyncEnabled) {
        return getLocalInvoices();
      }
      if (!user.signer.nip44) {
        return getLocalInvoices();
      }

      try {
        const filter = {
          kinds: [KINDS.ARBITRARY_APP_DATA],
          authors: [user.pubkey],
          "#d": [INVOICES_D_TAG],
          limit: 1,
        };

        const events = await nostr.query([filter], { signal });

        if (events.length === 0) {
          return getLocalInvoices();
        }

        const latestEvent = events[0];
        const decrypted = await user.signer.nip44.decrypt(
          user.pubkey,
          latestEvent.content,
        );
        const cloudInvoices: StoredInvoice[] = JSON.parse(decrypted);

        // Merge cloud and local invoices
        const localInvoices = getLocalInvoices();
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

        const merged = Array.from(mergedMap.values());
        saveLocalInvoices(merged);
        return merged;
      } catch (error) {
        console.error("Failed to fetch cloud invoices:", error);
        return getLocalInvoices();
      }
    },
    enabled: true,
    refetchInterval: 60000, // Refetch every minute
  });

  // Add new invoice
  const addInvoice = useCallback(
    async (invoice: Omit<StoredInvoice, "id" | "createdAt" | "checkedAt">) => {
      const newInvoice: StoredInvoice = {
        ...invoice,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        checkedAt: Date.now(),
      };

      addLocalInvoice(newInvoice);

      if (user && cloudSyncEnabled) {
        const allInvoices = [
          ...getLocalInvoices().filter((inv) => inv.id !== newInvoice.id),
          newInvoice,
        ];
        await syncInvoicesMutation.mutateAsync(allInvoices);
      }

      return newInvoice;
    },
    [
      addLocalInvoice,
      getLocalInvoices,
      user,
      cloudSyncEnabled,
      syncInvoicesMutation,
    ],
  );

  // Update invoice
  const updateInvoice = useCallback(
    async (id: string, updates: Partial<StoredInvoice>) => {
      updateLocalInvoice(id, updates);

      if (user && cloudSyncEnabled) {
        const allInvoices = getLocalInvoices();
        await syncInvoicesMutation.mutateAsync(allInvoices);
      }
    },
    [
      updateLocalInvoice,
      getLocalInvoices,
      user,
      cloudSyncEnabled,
      syncInvoicesMutation,
    ],
  );

  // Get pending invoices that need checking
  const getPendingInvoices = useCallback((): StoredInvoice[] => {
    const invoices = invoicesQuery.data || getLocalInvoices();
    const now = Date.now();
    const MAX_RETRIES = 10;

    return invoices.filter((inv) => {
      // Skip if already successfully issued (tokens minted)
      if ((inv.state as string) === "ISSUED") {
        return false;
      }

      // Skip if max retries exceeded
      if ((inv.retryCount || 0) >= MAX_RETRIES) {
        return false;
      }

      // Include PAID invoices for retry (in case minting failed)
      // They will be checked to see if they can be converted to ISSUED

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
        300000,
      ); // Max 5 minutes

      return now - lastCheck > backoffInterval;
    });
  }, [invoicesQuery.data, getLocalInvoices]);

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
      if (user && cloudSyncEnabled) {
        await syncInvoicesMutation.mutateAsync(cleaned);
      }
    }
  }, [
    getLocalInvoices,
    saveLocalInvoices,
    user,
    cloudSyncEnabled,
    syncInvoicesMutation,
  ]);

  // Delete invoice
  const deleteInvoice = useCallback(
    async (id: string) => {
      const invoices = getLocalInvoices();
      const filtered = invoices.filter((inv) => inv.id !== id);
      saveLocalInvoices(filtered);

      if (user && cloudSyncEnabled) {
        await syncInvoicesMutation.mutateAsync(filtered);
      }

      queryClient.invalidateQueries({
        queryKey: ["invoices", user?.pubkey, INVOICES_D_TAG],
      });
    },
    [
      getLocalInvoices,
      saveLocalInvoices,
      user,
      cloudSyncEnabled,
      syncInvoicesMutation,
      queryClient,
    ],
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
    [updateInvoice],
  );

  return {
    invoices: invoicesQuery.data || [],
    isLoading: invoicesQuery.isLoading,
    isSyncing: syncInvoicesMutation.isPending,
    addInvoice,
    updateInvoice,
    deleteInvoice,
    resetInvoiceRetry,
    getPendingInvoices,
    cleanupOldInvoices,
    cloudSyncEnabled,
    setCloudSyncEnabled,
    refetch: invoicesQuery.refetch,
  };
}
