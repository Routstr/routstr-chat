import { useNostr } from '@/hooks/useNostr';
import { toast } from 'sonner';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DEFAULT_MINT_URL } from '@/lib/utils';
import { CASHU_EVENT_KINDS, CashuWalletStruct, CashuToken, activateMint, updateMintKeys, defaultMints } from '@/lib/cashu';
import { NostrEvent, getPublicKey } from 'nostr-tools';
import { useCashuStore, Nip60TokenEvent } from '@/stores/cashuStore';
import { Proof } from '@cashu/cashu-ts';
import { NSchema as n } from '@nostrify/nostrify';
import { z } from 'zod';
import { useNutzaps } from '@/hooks/useNutzaps';
import { hexToBytes } from '@noble/hashes/utils';
import { useLocalStorage } from '@/hooks/useLocalStorage';

/**
 * Type for storing deleted events with timestamp
 */
export interface DeletedEvents {
  eventId: string;
  timestamp: number;
}

/**
 * Hook to fetch and manage the user's Cashu wallet
 */
export function useCashuWallet() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const cashuStore = useCashuStore();
  const { createNutzapInfo } = useNutzaps();
  const [showQueryTimeoutModal, setShowQueryTimeoutModal] = useState(false);
  const [didRelaysTimeout, setDidRelaysTimeout] = useState(false);
  const [deletedEvents, setDeletedEvents] = useLocalStorage<DeletedEvents[]>('nip60-deleted-events', []);

  // Fetch wallet information (kind 17375)
  const walletQuery = useQuery<{ id: string; wallet: CashuWalletStruct; createdAt: number; } | null, Error, { id: string; wallet: CashuWalletStruct; createdAt: number; } | null, any[]>(
    {
      queryKey: ['cashu', 'wallet', user?.pubkey],
    queryFn: async ({ signal }) => {
      if (!user) {
        return null;
      }
      try {
        
        // Add timeout to prevent hanging queries
        const queryPromise = nostr.query([
          { kinds: [CASHU_EVENT_KINDS.WALLET], authors: [user.pubkey], limit: 1 }
        ], { signal });

        
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Query timeout')), 10000);
        });
        
        const events = await Promise.race([queryPromise, timeoutPromise]);
        console.log("rdlogs:  l wtf", events, queryPromise, nostr.relays)

        if ((events as any[]).length === 0) {
          // No events found, but query completed successfully: clear timeout indicators
          try { localStorage.setItem('cashu_relays_timeout', 'false'); } catch {}
          setShowQueryTimeoutModal(false);
          setDidRelaysTimeout(false);
          return null;
        }

        try { localStorage.setItem('cashu_relays_timeout', 'false'); } catch {}
        setShowQueryTimeoutModal(false);
        setDidRelaysTimeout(false);

        const event = (events as any[])[0];

        // Decrypt wallet content
        if (!user.signer.nip44) {
          throw new Error('NIP-44 encryption not supported by your signer');
        }
        const decrypted = await user.signer.nip44.decrypt(user.pubkey, event.content);
        const data = n.json().pipe(z.string().array().array()).parse(decrypted);

        const privkey = data.find(([key]) => key === 'privkey')?.[1];

        if (!privkey) {
          throw new Error('Private key not found in wallet data');
        }

        const walletData: CashuWalletStruct = {
          privkey,
          mints: data
            .filter(([key]) => key === 'mint')
            .map(([, mint]) => mint)
        };

        // if the default mint is not in the wallet, add it
        for (const mint of defaultMints) {
          if (!walletData.mints.includes(mint)) {
            walletData.mints.push(mint);
          }
        }

        // remove trailing slashes from mints
        walletData.mints = walletData.mints.map(mint => mint.replace(/\/$/, ''));
        // reduce mints to unique values
        walletData.mints = [...new Set(walletData.mints)];


        // fetch the mint info and keysets for each mint
        await Promise.all(walletData.mints.map(async (mint) => {
          try {
            const { mintInfo, keysets } = await activateMint(mint);
            cashuStore.addMint(mint);
            cashuStore.setMintInfo(mint, mintInfo);
            cashuStore.setKeysets(mint, keysets);
            const { keys } = await updateMintKeys(mint, keysets);
            cashuStore.setKeys(mint, keys);
          } catch (error) {
            console.error(`Failed to activate or update mint ${mint}:`, error);
            // Skip this mint and continue with others
          }
        }));

        cashuStore.setPrivkey(walletData.privkey);

        const currentActiveMintUrl = cashuStore.getActiveMintUrl();
        // Only set active mint URL if it's not already set or if current one is not in wallet mints
        if (!currentActiveMintUrl || !walletData.mints?.includes(currentActiveMintUrl)) {
          if (walletData.mints?.includes(DEFAULT_MINT_URL)) {
            cashuStore.setActiveMintUrl(DEFAULT_MINT_URL);
          } else if (walletData.mints && walletData.mints.length > 0) {
            cashuStore.setActiveMintUrl(walletData.mints[0]);
          }
        }

        // trigger getNip60TokensQuery refetch without awaiting to avoid circular dependency
        getNip60TokensQuery.refetch();
        return {
          id: event.id,
          wallet: walletData,
          createdAt: event.created_at
        };
      } catch (error) {
        if (error instanceof Error && error.message === 'Query timeout') {
          setShowQueryTimeoutModal(true);
          // Log failed/disconnected relays
          const relayEntries = nostr.relays ? Array.from(nostr.relays.entries()) : [];
          const failedRelays = relayEntries.filter(([url, relay]: [string, any]) => {
            const readyState = relay.socket?._underlyingWebsocket?.readyState;
            return readyState !== 1; // 1 = connected, 3 = closed/failed
          });
          console.log('rdlogs: wallet query timed out', {
            totalRelays: nostr.relays?.size || 0,
            failedRelays: failedRelays.map(([url, relay]: [string, any]) => {
              const readyState = relay.socket?._underlyingWebsocket?.readyState;
              const getReadyStateText = (state: number) => {
                switch (state) {
                  case 0: return 'CONNECTING';
                  case 1: return 'OPEN';
                  case 2: return 'CLOSING';
                  case 3: return 'CLOSED';
                  default: return 'UNKNOWN';
                }
              };
              return {
                url: url,
                readyState: readyState,
                readyStateText: getReadyStateText(readyState),
                closedByUser: relay.closedByUser,
                lastConnection: relay.socket?._lastConnection
              };
            }),
            workingRelays: relayEntries.filter(([url, relay]: [string, any]) => {
              return relay.socket?._underlyingWebsocket?.readyState === 1;
            }).map(([url]) => url)
          });

          setDidRelaysTimeout(true);
          // Store timeout status in localStorage for persistence across hook instances
          localStorage.setItem('cashu_relays_timeout', 'true');
        }
        else {
          console.error('walletQuery: Error in queryFn', error);
        }
        return null;
      }
    },
    enabled: !!user,
    staleTime: Infinity, // Prevent refetching on window focus or component re-mount
    retry: false, // Do not retry on failure, as the connection issue is persistent
  });

  // Create or update wallet
  const createWalletMutation = useMutation({
    mutationFn: async (walletData: CashuWalletStruct) => {
      if (!user) throw new Error('User not logged in');
      if (!user.signer.nip44) {
        throw new Error('NIP-44 encryption not supported by your signer');
      }

      // remove trailing slashes from mints
      walletData.mints = walletData.mints.map(mint => mint.replace(/\/$/, ''));
      // reduce mints to unique values
      walletData.mints = [...new Set(walletData.mints)];

      const tags = [
        ['privkey', walletData.privkey],
        ...walletData.mints.map(mint => ['mint', mint])
      ]

      // Encrypt wallet data
      const content = await user.signer.nip44.encrypt(
        user.pubkey,
        JSON.stringify(tags)
      );

      // Create wallet event
      const event = await user.signer.signEvent({
        kind: CASHU_EVENT_KINDS.WALLET,
        content,
        tags: [],
        created_at: Math.floor(Date.now() / 1000)
      });

      // Publish event
      await nostr.event(event);

      // Also create or update the nutzap informational event
      try {
        await createNutzapInfo({
          mintOverrides: walletData.mints.map(mint => ({
            url: mint,
            units: ['sat']
          })),
          p2pkPubkey: "02" + getPublicKey(hexToBytes(walletData.privkey))
        });
      } catch (error) {
        console.error('Failed to create nutzap informational event:', error);
        // Continue even if nutzap info creation fails
      }

      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for event to be published

      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashu', 'wallet', user?.pubkey] });
      queryClient.invalidateQueries({ queryKey: ['nutzap', 'info', user?.pubkey] });
    }
  });

  // Fetch token events (kind 7375)
  const getNip60TokensQuery = useQuery<Nip60TokenEvent[], Error, Nip60TokenEvent[], any[]>(
    {
      queryKey: ['cashu', 'tokens', user?.pubkey],
    queryFn: async ({ signal }) => {
      if (!user) {
        return [];
      }
      try {

      // Get the last stored timestamp for the TOKEN event kind
      // const lastTimestamp = getLastEventTimestamp(user.pubkey, CASHU_EVENT_KINDS.TOKEN);
      let lastTimestamp; // Commneted out because if a different client changes balance there seems to be problems with it loading. Now every reload is like loading with a new login. 

      // Create the filter with 'since' if a timestamp exists
      const filter = {
        kinds: [CASHU_EVENT_KINDS.TOKEN],
        authors: [user.pubkey],
        limit: 100
      };

      // Add the 'since' property if we have a previous timestamp
      if (lastTimestamp) {
        Object.assign(filter, { since: lastTimestamp + 1 });
      }

      
      // Add timeout to prevent hanging queries
      const queryPromise = nostr.query([filter], { signal });
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout')), 15000);
      });
      
      const events = await Promise.race([queryPromise, timeoutPromise]);

      if (events.length === 0) {
        return [];
      }

      const nip60TokenEvents: Nip60TokenEvent[] = [];
      const deletedEventsTemp = new Set<DeletedEvents>();

      // First pass: collect all deleted event IDs from del arrays
      for (const event of events) {
        try {
          if (!user.signer.nip44) {
            throw new Error('NIP-44 encryption not supported by your signer');
          }

          let decrypted: string;
          try {
            decrypted = await user.signer.nip44.decrypt(user.pubkey, event.content);
          } catch (error) {
            if (error instanceof Error && error.message.includes('invalid MAC')) {
              toast.error('Nostr Extention: invalid MAC. Please switch to your previously connected account on the extension OR sign out and login. .');
            }
            throw error;
          }
          const tokenData = JSON.parse(decrypted) as CashuToken;

          // Collect deleted event IDs
          if (tokenData.del && Array.isArray(tokenData.del)) {
            tokenData.del.forEach(id => deletedEventsTemp.add({
              eventId: id,
              timestamp: event.created_at
          }));
          }

          nip60TokenEvents.push({
            id: event.id,
            token: tokenData,
            createdAt: event.created_at
          });

        } catch (error) {
          console.error('Failed to decrypt token data:', error);
        }
      }

      // Get existing deleted events from local storage
      const existingDeletedEvents = Array.isArray(deletedEvents) ? deletedEvents : [];
      
      const newDeletedEvents = Array.from(deletedEventsTemp);
      
      let allDeletedEvents = newDeletedEvents;
      // Update local storage with combined events (existing + new)
      if (newDeletedEvents.length > 0) {
        allDeletedEvents = [...existingDeletedEvents, ...newDeletedEvents];
        setDeletedEvents(allDeletedEvents);
      }

      // Second pass: filter out deleted events and add proofs to store
      const deletedEventIds = new Set(allDeletedEvents.map(deletedEvent => deletedEvent.eventId));
      const filteredEvents = nip60TokenEvents.filter(event => !deletedEventIds.has(event.id));
      
      // Add proofs to store only for non-deleted events
      filteredEvents.forEach(event => {
        cashuStore.addProofs(event.token.proofs, event.id);
      });

      // console.log('rdlogs ', deletedEventIds);

      // console.log('rdlogs events: \n' + filteredEvents.map(event =>
      //   `eventId: ${event.id}\nproofsCount: ${event.token.proofs.length}\ncreatedAt: ${event.createdAt}`
      // ).join('\n\n'));

      return filteredEvents;
      } catch (error) {
        console.error('getNip60TokensQuery: Error in queryFn', error);
        if (error instanceof Error && error.message === 'Query timeout') {
          setShowQueryTimeoutModal(true);
          setDidRelaysTimeout(true);
          // Store timeout status in localStorage for persistence across hook instances
          localStorage.setItem('cashu_relays_timeout', 'true');
        }
        return [];
      }
    },
    enabled: !!user,
    staleTime: Infinity, // Prevent refetching on window focus or component re-mount
    retry: false, // Do not retry on failure, as the connection issue is persistent
  });

  const updateProofsMutation = useMutation({
    mutationFn: async ({ mintUrl, proofsToAdd, proofsToRemove }: { mintUrl: string, proofsToAdd: Proof[], proofsToRemove: Proof[] }): Promise<NostrEvent | null> => {
      if (!user) throw new Error('User not logged in');
      if (!user.signer.nip44) {
        throw new Error('NIP-44 encryption not supported by your signer');
      }

      // get all event IDs of proofsToRemove 
      const eventIdsToRemoveUnfiltered = proofsToRemove.map(proof => cashuStore.getProofEventId(proof));
      const eventIdsToRemove = [...new Set(eventIdsToRemoveUnfiltered.filter(id => id !== undefined) as string[])];

      // get all proofs with eventIdsToRemove
      const allProofsWithEventIds = eventIdsToRemove.map(id => cashuStore.getProofsByEventId(id)).flat();

      // and filter out those that we want to keep to roll them over to a new event
      const proofsToKeepWithEventIds = allProofsWithEventIds.filter(proof => !proofsToRemove.includes(proof));

      // combine proofsToAdd and proofsToKeepWithEventIds
      const newProofs = [...proofsToAdd, ...proofsToKeepWithEventIds];

      let eventToReturn: NostrEvent | null = null;



      if (newProofs.length) {
        // generate a new token event
        const newToken: CashuToken = {
          mint: mintUrl,
          proofs: newProofs,
          del: eventIdsToRemove
        }

        // encrypt token event
        const newTokenEventContent = await user.signer.nip44.encrypt(
          user.pubkey,
          JSON.stringify(newToken)
        );

        // create token event
        const newTokenEvent = await user.signer.signEvent({
          kind: CASHU_EVENT_KINDS.TOKEN,
          content: newTokenEventContent,
          tags: [],
          created_at: Math.floor(Date.now() / 1000)
        });

        // add proofs to store
        cashuStore.addProofs(newProofs, newTokenEvent?.id || '');

        // publish token event
        try {
          await nostr.event(newTokenEvent);
        } catch (error) {
          console.error('Failed to publish token event:', error);
        }

        // update local event IDs on all newProofs
        newProofs.forEach(proof => {
          cashuStore.setProofEventId(proof, newTokenEvent.id);
        });

        eventToReturn = newTokenEvent;
      }

      // delete nostr events
      if (eventIdsToRemove.length) {
        // create deletion event
        const deletionEvent = await user.signer.signEvent({
          kind: 5,
          content: 'Deleted token event',
          tags: eventIdsToRemove.map(id => ['e', id]),
          created_at: Math.floor(Date.now() / 1000)
        });

        // remove proofs from store
        const proofsToRemoveFiltered = proofsToRemove.filter(proof => !newProofs.map(p => p.secret).includes(proof.secret));
        cashuStore.removeProofs(proofsToRemoveFiltered);
        console.log('rdlogs dleted ', deletionEvent)

        // publish deletion event
        try {
          await nostr.event(deletionEvent);
        } catch (error) {
          console.error('Failed to publish deletion event:', error);
        }
      }

      return eventToReturn;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashu', 'tokens', user?.pubkey] });
    }
  });
  
  // Check localStorage for timeout status to ensure consistency across hook instances
  const hasTimedOut = didRelaysTimeout || localStorage.getItem('cashu_relays_timeout') === 'true';
  
  return {
    wallet: walletQuery.data?.wallet,
    walletId: walletQuery.data?.id,
    tokens: getNip60TokensQuery.data || [],
    isLoading: walletQuery.isLoading || getNip60TokensQuery.isLoading,
    createWallet: createWalletMutation.mutate,
    updateProofs: updateProofsMutation.mutateAsync,
    showQueryTimeoutModal,
    setShowQueryTimeoutModal,
    didRelaysTimeout: hasTimedOut,
  };
}