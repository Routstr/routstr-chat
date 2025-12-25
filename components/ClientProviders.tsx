"use client";

import { ReactNode, useEffect, useState } from "react";
import { useEffect as useReactEffect } from "react";
import { useNostrLogin } from "@nostrify/react/login";
import { useLoginActions } from "@/hooks/useLoginActions";
import { generateSecretKey, nip19 } from "nostr-tools";
import NostrProvider from "@/components/NostrProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import dynamic from "next/dynamic";
import { migrateStorageItems, saveRelays } from "@/utils/storageUtils";
import { InvoiceRecoveryProvider } from "@/components/InvoiceRecoveryProvider";

const DynamicNostrLoginProvider = dynamic(
  () => import("@nostrify/react/login").then((mod) => mod.NostrLoginProvider),
  { ssr: false },
);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppProvider } from "./AppProvider";
import { AppConfig } from "@/context/AppContext";

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
    presetRelays.slice(0, 3).map((relay) => relay.url),
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
  saveRelays(relayUrls);

  const defaultConfig: AppConfig = {
    relayUrls: relayUrls,
  };

  function AutoLogin() {
    const { logins } = useNostrLogin();
    const loginActions = useLoginActions();

    useReactEffect(() => {
      if (logins.length === 0) {
        try {
          // const sk = generateSecretKey();
          // const nsec = nip19.nsecEncode(sk);
          // console.log("RTRUE nsse", nsec)
          // loginActions.nsec(nsec);
        } catch (err) {
          // no-op
        }
      }
    }, [logins.length]);

    return null;
  }
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
    <ThemeProvider>
      <AppProvider
        storageKey="nostr:app-config"
        defaultConfig={defaultConfig}
        presetRelays={presetRelays}
      >
        <DynamicNostrLoginProvider storageKey="nostr:login">
          <NostrProvider>
            <AutoLogin />
            <QueryClientProvider client={queryClient}>
              <InvoiceRecoveryProvider>{children}</InvoiceRecoveryProvider>
            </QueryClientProvider>
          </NostrProvider>
        </DynamicNostrLoginProvider>
      </AppProvider>
    </ThemeProvider>
  );
}
