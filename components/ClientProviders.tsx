'use client';

import { ReactNode } from 'react';
// import { NostrProvider } from '@/context/NostrContext';
import NostrProvider from '@/components/NostrProvider'
import dynamic from 'next/dynamic';

const DynamicNostrLoginProvider = dynamic(
  () => import('@nostrify/react/login').then((mod) => mod.NostrLoginProvider),
  { ssr: false }
);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const defaultRelays = [
    'wss://relay.chorus.community',
    'wss://relay.damus.io',
   'wss://relay.nostr.band',
    'wss://nos.lol'
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
  return (
    <DynamicNostrLoginProvider storageKey='nostr:login'>
      <NostrProvider relays={defaultRelays}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </NostrProvider>
    </DynamicNostrLoginProvider>
  );
} 