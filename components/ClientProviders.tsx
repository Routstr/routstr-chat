"use client";

// Initialize logger early to intercept all console calls
import "@/lib/logger";

import { ReactNode, useEffect, useSyncExternalStore } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import dynamic from "next/dynamic";
import { migrateStorageItems } from "@/utils/storageUtils";
import { InvoiceRecoveryProvider } from "@/components/InvoiceRecoveryProvider";
import { session } from "@/runtime";
import { AccountContext } from "@/features/session/view";
import { activeHistory, relays } from "@/runtime/nostr";
import { HistoryContext } from "@/features/history/view";
import { RelaysContext } from "@/features/relays/view";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppProvider } from "./AppProvider";

const accountContext = { manager: session.accounts, session };

export { useAccountManager } from "@/features/session/view";

const presetRelays = [
  { url: "wss://relay.routstr.com", name: "Routstr Relay" },
  { url: "wss://nos.lol", name: "nos.lol" },
  { url: "wss://relay.primal.net", name: "Primal" },
  { url: "wss://relay.damus.io", name: "Damus" },
  { url: "wss://relay.nostr.band", name: "Nostr.Band" },
  { url: "wss://relay.chorus.community", name: "Chorus Relay" },
];

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
      <ThemeProvider>
        <RelaysContext.Provider value={relays}>
          <AppProvider presetRelays={presetRelays}>
            <QueryClientProvider client={queryClient}>
              <HistoryContext.Provider value={history}>
                <InvoiceRecoveryProvider key={generation}>
                  {children}
                </InvoiceRecoveryProvider>
              </HistoryContext.Provider>
            </QueryClientProvider>
          </AppProvider>
        </RelaysContext.Provider>
      </ThemeProvider>
    </AccountContext.Provider>
  );
}
