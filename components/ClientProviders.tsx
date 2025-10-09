'use client';

import { ReactNode, useEffect } from 'react';
import NostrProvider from '@/components/NostrProvider'
import dynamic from 'next/dynamic';
import { migrateStorageItems } from '@/utils/storageUtils';
import { InvoiceRecoveryProvider } from '@/components/InvoiceRecoveryProvider';

const DynamicNostrLoginProvider = dynamic(
  () => import('@nostrify/react/login').then((mod) => mod.NostrLoginProvider),
  { ssr: false }
);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppProvider } from './AppProvider';
import { AppConfig } from '@/context/AppContext';

const presetRelays = [
  { url: 'wss://relay.chorus.community', name: 'Chorus' },
  { url: 'wss://relay.damus.io', name: 'Damus' },
  { url: 'wss://nos.lol', name: 'nos.lol' },
  { url: 'wss://relay.nostr.band', name: 'Nostr.Band' },
  { url: 'wss://relay.primal.net', name: 'Primal' },
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

const defaultConfig: AppConfig = {
  relayUrls: [
...presetRelays.slice(0, 3).map(relay => relay.url),
  ]
};

export default function ClientProviders({ children }: { children: ReactNode }) {
  // Run storage migration on app startup
  useEffect(() => {
    migrateStorageItems();
  }, []); 

  return (
    <AppProvider storageKey="nostr:app-config" defaultConfig={defaultConfig} presetRelays={presetRelays}>
      <DynamicNostrLoginProvider storageKey='nostr:login'>
        <NostrProvider>
          <QueryClientProvider client={queryClient}>
            <InvoiceRecoveryProvider>
            {children}
            </InvoiceRecoveryProvider>
        </QueryClientProvider>
        </NostrProvider>
      </DynamicNostrLoginProvider>
    </AppProvider>
  );
}