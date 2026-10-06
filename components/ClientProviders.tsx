"use client";

// Initialize logger early to intercept all console calls
import "@/lib/logger";

import {
  ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
  createContext,
  useContext,
} from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import Kind1018ThemeBootstrap from "@/components/Kind1018ThemeBootstrap";
import dynamic from "next/dynamic";
import { migrateStorageItems, saveRelays } from "@/utils/storageUtils";
import { InvoiceRecoveryProvider } from "@/components/InvoiceRecoveryProvider";
import { session } from "@/runtime";
import type { Accounts, SessionService } from "@/features/session/service";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppProvider } from "./AppProvider";
import { AppConfig } from "@/context/AppContext";

interface AccountContextType {
  manager: Accounts;
  session: SessionService;
}

const accountContext = { manager: session.accounts, session };
const AccountContext = createContext<AccountContextType>(accountContext);

export const useAccountManager = () => useContext(AccountContext);

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
  const [relayUrls, setRelayUrls] = useState<string[]>(
    presetRelays.slice(0, 3).map((relay) => relay.url)
  );

  // Fetch relay URLs from URL parameters
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const relaysParam = params.get("relays");

    if (relaysParam) {
      // Parse comma-separated relay URLs from URL parameter
      const urlRelays = relaysParam
        .split(",")
        .map((url) => url.trim())
        .filter((url) => url.startsWith("wss://") || url.startsWith("ws://"));

      if (urlRelays.length > 0) {
        setRelayUrls(urlRelays);
      }
    }
  }, []);

  useEffect(() => {
    saveRelays(relayUrls);
  }, [relayUrls]);

  const defaultConfig: AppConfig = {
    relayUrls: relayUrls,
  };

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
        <AppProvider
          storageKey="nostr:app-config"
          defaultConfig={defaultConfig}
          presetRelays={presetRelays}
        >
          <Kind1018ThemeBootstrap />
          <QueryClientProvider client={queryClient}>
            <InvoiceRecoveryProvider key={generation}>
              {children}
            </InvoiceRecoveryProvider>
          </QueryClientProvider>
        </AppProvider>
      </ThemeProvider>
    </AccountContext.Provider>
  );
}
