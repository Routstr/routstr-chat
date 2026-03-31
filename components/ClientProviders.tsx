"use client";

// Initialize logger early to intercept all console calls
import "@/lib/logger";

import {
  ReactNode,
  useEffect,
  useState,
  createContext,
  useContext,
  useCallback,
  useMemo,
} from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import Kind1018ThemeBootstrap from "@/components/Kind1018ThemeBootstrap";
import dynamic from "next/dynamic";
import {
  hasCreatedEphemeralNsec,
  migrateStorageItems,
  saveRelays,
} from "@/utils/storageUtils";
import { InvoiceRecoveryProvider } from "@/components/InvoiceRecoveryProvider";
import { AccountManager } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";
import { merge, Subject } from "rxjs";
import { useObservableState } from "applesauce-react/hooks";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppProvider } from "./AppProvider";
import { AppConfig } from "@/context/AppContext";
import {
  getScopedDbName,
  getScopedStorageKey,
  recoverAnonymousIdentityStorage,
  setCurrentIdentityId,
} from "@/utils/accountScope";
import { useCashuStore } from "@/features/wallet/state/cashuStore";
import { useTransactionHistoryStore } from "@/features/wallet/state/transactionHistoryStore";
import { useNutzapStore } from "@/features/wallet/state/nutzapStore";

export interface AccountMetadata {
  name: string;
}

export interface AccountSession {
  loginId: string;
  identityId: string;
  account: any;
  scope: {
    localKey: (key: string) => string;
    persistName: (name: string) => string;
    dbName: (name: string) => string;
  };
}

// Initialize shared state at the top level
const manager = new AccountManager<AccountMetadata>();
registerCommonAccountTypes(manager);
const manualSave = new Subject<void>();

interface AccountContextType {
  manager: AccountManager<AccountMetadata>;
  manualSave: Subject<void>;
  accounts: any[];
  activeAccount: any | undefined;
  session: AccountSession | null;
  addLogin: (account: any) => void;
  switchLogin: (loginId: string) => Promise<void>;
  removeLogin: (
    loginId: string,
    opts?: { preserveActiveFallback?: boolean }
  ) => Promise<void>;
  signOutActive: () => Promise<void>;
}

const AccountContext = createContext<AccountContextType>({
  manager,
  manualSave,
  accounts: [],
  activeAccount: undefined,
  session: null,
  addLogin: () => {},
  switchLogin: async () => {},
  removeLogin: async () => {},
  signOutActive: async () => {},
});

export const useAccountManager = () => useContext(AccountContext);
export const useAccountSession = () => useContext(AccountContext).session;

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
  const accounts = useObservableState(manager.accounts$) || [];
  const activeAccount = useObservableState(manager.active$);

  const rehydrateScopedStores = useCallback(async () => {
    await Promise.allSettled([
      useCashuStore.persist.rehydrate(),
      useTransactionHistoryStore.persist.rehydrate(),
      useNutzapStore.persist.rehydrate(),
    ]);
  }, []);

  const activateIdentityScope = useCallback(
    (identityId: string | null) => {
      setCurrentIdentityId(identityId);
      queryClient.clear();
      if (
        identityId &&
        (hasCreatedEphemeralNsec() || manager.accounts$.value.length <= 1)
      ) {
        recoverAnonymousIdentityStorage(identityId);
      }
      void rehydrateScopedStores();
    },
    [rehydrateScopedStores]
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
    } else {
      const firstAccount = manager.accounts$.value[0];
      if (firstAccount) {
        manager.setActive(firstAccount);
      }
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

  useEffect(() => {
    activateIdentityScope(activeAccount?.pubkey ?? null);
  }, [activeAccount?.pubkey, activateIdentityScope]);

  const session = useMemo<AccountSession | null>(() => {
    if (!activeAccount?.pubkey) {
      return null;
    }

    return {
      loginId: activeAccount.id,
      identityId: activeAccount.pubkey,
      account: activeAccount,
      scope: {
        localKey: (key: string) => getScopedStorageKey(key, activeAccount.pubkey),
        persistName: (name: string) =>
          getScopedStorageKey(name, activeAccount.pubkey),
        dbName: (name: string) => getScopedDbName(name, activeAccount.pubkey),
      },
    };
  }, [activeAccount]);

  const addLogin = useCallback((account: any) => {
    const existing = manager.accounts$.value.find((entry) => entry.id === account.id);
    const accountToUse = existing || account;

    if (!existing) {
      manager.addAccount(accountToUse);
    }

    activateIdentityScope(accountToUse.pubkey ?? null);
    manager.setActive(accountToUse);
    manualSave.next();
  }, [activateIdentityScope]);

  const switchLogin = useCallback(async (loginId: string) => {
    const account = manager.getAccount(loginId);
    if (!account) return;
    activateIdentityScope(account.pubkey ?? null);
    manager.setActive(account);
    manualSave.next();
  }, [activateIdentityScope]);

  const removeLogin = useCallback(
    async (
      loginId: string,
      opts: { preserveActiveFallback?: boolean } = {
        preserveActiveFallback: true,
      }
    ) => {
      const nextAccounts = manager.accounts$.value.filter(
        (account) => account.id !== loginId
      );
      const wasActive = manager.active$.value?.id === loginId;

      manager.removeAccount(loginId);

      if (wasActive && opts.preserveActiveFallback !== false) {
        const nextActive = nextAccounts[0];
        if (nextActive) {
          activateIdentityScope(nextActive.pubkey ?? null);
          manager.setActive(nextActive);
        } else {
          activateIdentityScope(null);
        }
      }

      manualSave.next();
    },
    [activateIdentityScope]
  );

  const signOutActive = useCallback(async () => {
    const current = manager.active$.value;
    if (!current) return;
    await removeLogin(current.id);
  }, [removeLogin]);

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
    <AccountContext.Provider
      value={{
        manager,
        manualSave,
        accounts,
        activeAccount,
        session,
        addLogin,
        switchLogin,
        removeLogin,
        signOutActive,
      }}
    >
      <ThemeProvider>
        <AppProvider
          key={session?.identityId || "anon"}
          storageKey="nostr:app-config"
          defaultConfig={defaultConfig}
          presetRelays={presetRelays}
        >
          <Kind1018ThemeBootstrap />
          <QueryClientProvider client={queryClient}>
            <InvoiceRecoveryProvider>{children}</InvoiceRecoveryProvider>
          </QueryClientProvider>
        </AppProvider>
      </ThemeProvider>
    </AccountContext.Provider>
  );
}
