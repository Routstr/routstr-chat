"use client";

// Initialize logger early to intercept all console calls
import "@/lib/logger";

import { ReactNode, useEffect, useSyncExternalStore } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import dynamic from "next/dynamic";
import { migrateStorageItems } from "@/utils/storageUtils";
import { InvoiceRecoveryProvider } from "@/components/InvoiceRecoveryProvider";
import { routing, session } from "@/runtime";
import { node } from "@/runtime/node";
import { NodeContext } from "@/features/node/view";
import { CatalogContext } from "@/features/catalog/view";
import { AccountContext } from "@/features/session/view";
import { activeHistory, relays } from "@/runtime/nostr";
import { purseFor } from "@/runtime/wallet";
import { HistoryContext } from "@/features/history/view";
import { RelaysContext } from "@/features/relays/view";
import { PurseContext } from "@/features/wallet/view";
import { PurseContext as KeysPurseContext } from "@/features/keys/view";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppProvider } from "./AppProvider";

const accountContext = { manager: session.accounts, session };

export { useAccountManager } from "@/features/session/view";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60000, // 1 minute
      gcTime: Infinity,
    },
  },
});

export default function ClientProviders({ children }: { children: ReactNode }) {
  // a new person gets a fresh app: nothing on screen outlives the account
  const { generation } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  );
  const history = useSyncExternalStore(
    activeHistory.subscribe,
    activeHistory.get,
    activeHistory.get
  );
  // Run storage migration on app startup
  useEffect(() => {
    migrateStorageItems();
  }, []);

  // Start MSW in development only
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      // dynamic import to avoid including in prod bundles
      import("@/mocks/browser")
        .then(({ worker }) => {
          worker.start({
            onUnhandledRequest: "bypass",
            serviceWorker: {
              url: "/mockServiceWorker.js",
            },
          });
        })
        .catch(() => {
          // no-op if MSW is not available
        });
    }
  }, []);

  return (
    <AccountContext.Provider value={accountContext}>
      <NodeContext.Provider value={node}>
      <CatalogContext.Provider value={routing.catalog}>
      <ThemeProvider>
        <RelaysContext.Provider value={relays}>
          <AppProvider>
            <QueryClientProvider client={queryClient}>
              <HistoryContext.Provider value={history}>
                <PurseContext.Provider value={purseFor}>
                <KeysPurseContext.Provider value={purseFor}>
                  <InvoiceRecoveryProvider key={generation}>
                    {children}
                  </InvoiceRecoveryProvider>
                </KeysPurseContext.Provider>
                </PurseContext.Provider>
              </HistoryContext.Provider>
            </QueryClientProvider>
          </AppProvider>
        </RelaysContext.Provider>
      </ThemeProvider>
      </CatalogContext.Provider>
      </NodeContext.Provider>
    </AccountContext.Provider>
  );
}
