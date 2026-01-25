"use client";

import {
  ReactNode,
  useEffect,
  useState,
  createContext,
  useContext,
} from "react";
import NostrProvider from "@/components/NostrProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import dynamic from "next/dynamic";
import { migrateStorageItems, saveRelays } from "@/utils/storageUtils";
import { InvoiceRecoveryProvider } from "@/components/InvoiceRecoveryProvider";
import { AccountManager } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";
import { merge, Subject } from "rxjs";
import { relayPool } from "@/lib/applesauce-core";

const DynamicNostrLoginProvider = dynamic(
  () => import("@nostrify/react/login").then((mod) => mod.NostrLoginProvider),
  { ssr: false }
);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppProvider } from "./AppProvider";
import { AppConfig } from "@/context/AppContext";

export interface AccountMetadata {
  name: string;
}

// Initialize shared state at the top level
const manager = new AccountManager<AccountMetadata>();
registerCommonAccountTypes(manager);
const manualSave = new Subject<void>();

interface AccountContextType {
  manager: AccountManager<AccountMetadata>;
  manualSave: Subject<void>;
}

const AccountContext = createContext<AccountContextType>({
  manager,
  manualSave,
});

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

  // Account persistence
  useEffect(() => {
    // Load accounts from localStorage
    const savedAccounts = JSON.parse(localStorage.getItem("accounts") || "[]");
    manager.fromJSON(savedAccounts);

    // Restore active account if it exists
    const activeAccountId = localStorage.getItem("activeAccount");
    if (activeAccountId) {
      const account = manager.getAccount(activeAccountId);
      if (account) manager.setActive(account);
    }

    // Save accounts whenever they change
    const sub1 = merge(manualSave, manager.accounts$).subscribe(() => {
      localStorage.setItem("accounts", JSON.stringify(manager.toJSON()));
    });

    // Save active account whenever it changes
    const sub2 = manager.active$.subscribe((account) => {
      if (account) localStorage.setItem("activeAccount", account.id);
      else localStorage.removeItem("activeAccount");
    });

    return () => {
      sub1.unsubscribe();
      sub2.unsubscribe();
    };
  }, []);

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
    <AccountContext.Provider value={{ manager, manualSave }}>
      <ThemeProvider>
        <AppProvider
          storageKey="nostr:app-config"
          defaultConfig={defaultConfig}
          presetRelays={presetRelays}
        >
          <DynamicNostrLoginProvider storageKey="nostr:login">
            <NostrProvider>
              <QueryClientProvider client={queryClient}>
                <InvoiceRecoveryProvider>{children}</InvoiceRecoveryProvider>
              </QueryClientProvider>
            </NostrProvider>
          </DynamicNostrLoginProvider>
        </AppProvider>
      </ThemeProvider>
    </AccountContext.Provider>
  );
}
