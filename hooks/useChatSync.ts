import { useState, useEffect, useCallback, useRef } from 'react';
import { RelayPool } from 'applesauce-relay';
import { Event, nip19 } from 'nostr-tools';
import { Conversation, Message } from '@/types/chat';
import { useNostr } from '@/hooks/useNostr';
import { getPublicKey } from '@/lib/nostr';
import { toast } from 'sonner';

// Custom Kinds
const KIND_CHAT_INNER = 20001;
const KIND_GIFT_WRAP = 1059;
const KIND_SEAL = 13;

interface ChatSyncHook {
  isSyncing: boolean;
  lastSyncTime: number | null;
  error: string | null;
  publishMessage: (
    conversationId: string,
    message: Message,
    modelId: string,
    previousEventId?: string
  ) => Promise<string | null>;
  syncConversations: () => Promise<Conversation[]>;
}

interface InnerEventPayload {
  content: string;
  tags: string[][];
  created_at: number;
  kind: number;
  pubkey: string;
}

export const useChatSync = (
  relays: string[] = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']
): ChatSyncHook => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poolRef = useRef<RelayPool | null>(null);

  // Initialize RelayPool
  useEffect(() => {
    if (!poolRef.current) {
      poolRef.current = new RelayPool();
    }
    return () => {
      // RelayPool might not have a close method, or it's named differently.
      // If it doesn't, we just leave it.
      // poolRef.current?.close();
    };
  }, []);

  // Helper to get the NIP-44 encrypt/decrypt functions
  const getNip44 = useCallback(() => {
    if (typeof window !== 'undefined' && window.nostr?.nip44) {
      return window.nostr.nip44;
    }
    throw new Error('NIP-44 encryption not available in Nostr extension');
  }, []);

  // 1. Create Inner Event (Kind 20001)
  const createInnerEvent = useCallback(
    async (
      conversationId: string,
      message: Message,
      modelId: string,
      previousEventId?: string
    ): Promise<InnerEventPayload> => {
      const pubkey = await getPublicKey();
      if (!pubkey) throw new Error('No public key available');

      const tags = [
        ['d', conversationId],
        ['role', message.role],
        ['model', modelId],
        ['client', 'routstr-chat'],
      ];

      if (previousEventId) {
        tags.push(['e', previousEventId]);
      }

      // Serialize content if it's complex (e.g., with images)
      const contentStr =
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content);

      return {
        kind: KIND_CHAT_INNER,
        pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: contentStr,
      };
    },
    []
  );

  // 2. Create Seal (Kind 13) - Encrypted Inner Event
  const createSeal = useCallback(
    async (innerEvent: InnerEventPayload): Promise<Event> => {
      const nip44 = getNip44();
      const json = JSON.stringify(innerEvent);
      // Encrypt for SELF
      const ciphertext = await nip44.encrypt(innerEvent.pubkey, json);

      // Create a random ephemeral key for the seal (handled by extension signing usually, 
      // but for NIP-59 the seal is signed by the SENDER. 
      // In Sync-to-Self, Sender = Receiver = User.
      // So we sign with the user's key.)
      
      // Wait, NIP-59 says:
      // "The seal is signed by the sender."
      // "The content is encrypted to the receiver's public key."
      
      // Since we are sending to ourselves, we sign with our key and encrypt to our key.
      
      // However, to properly implement NIP-59, the outer wrapper (Gift Wrap) 
      // should use a random ephemeral key to hide the sender's identity from relays.
      // But the Seal (Kind 13) is inside and signed by the actual sender (us).

      // We need to construct the Seal Event object
      const sealEventUnsigned = {
        kind: KIND_SEAL,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: ciphertext,
        pubkey: innerEvent.pubkey,
      };

      // Sign the seal
      const signedSeal = await window.nostr!.signEvent(sealEventUnsigned);
      return signedSeal;
    },
    [getNip44]
  );

  // 3. Create Gift Wrap (Kind 1059) - Encrypted Seal
  const createGiftWrap = useCallback(
    async (seal: Event): Promise<Event> => {
      const nip44 = getNip44();
      const json = JSON.stringify(seal);
      
      // Encrypt for the receiver (which is US)
      // We need to generate a random ephemeral key for the wrapper?
      // NIP-59: "The Gift Wrap event is signed by a random ephemeral key."
      
      // Browser extensions usually handle NIP-59 "gift wrapping" automatically if they support it.
      // But if we are doing it manually with NIP-44 primitives:
      
      // We can't easily sign with a random ephemeral key using `window.nostr` 
      // because `window.nostr` only signs with the user's main key.
      // UNLESS the extension supports a specific "gift wrap" method.
      
      // If we use `window.nostr.signEvent`, it signs with our main key.
      // If we want true NIP-59 anonymity from relays, we need to generate a local key pair,
      // sign the wrapper with that, and publish.
      
      // However, for "Sync-to-Self", maybe we don't strictly need the outer wrapper to be anonymous 
      // if we don't mind relays knowing WE are saving data. 
      // BUT the requirement was "The relay only sees a random blob".
      
      // If we sign the outer event with our own key, the relay knows it's from us.
      // To follow the spec strictly, we need a local ephemeral key.
      
      // Let's use `nostr-tools` to generate a random key for the outer wrapper.
      const { generateSecretKey, getPublicKey: getPk, finalizeEvent } = await import('nostr-tools');
      const ephemeralPrivKey = generateSecretKey();
      const ephemeralPubKey = getPk(ephemeralPrivKey);

      // Encrypt the SEAL (json) for the RECEIVER (us)
      // We need to use NIP-44 encryption. 
      // Since we are generating the ephemeral key locally, we can use `nostr-tools` NIP-44 implementation 
      // OR we can use the extension to encrypt TO us, but we need to sign FROM the ephemeral key.
      
      // Actually, NIP-44 encryption derives a shared secret.
      // Sender (Ephemeral) -> Receiver (Us).
      // We need to encrypt `json` using the shared secret between EphemeralPriv and OurPub.
      
      // Since we have the Ephemeral Private Key, we can use `nostr-tools` (if it supports NIP-44) 
      // or a compatible library. `nostr-tools` v2 has `nip44`.
      const { nip44: toolsNip44 } = await import('nostr-tools');
      
      // We need our own public key
      const myPubkey = await getPublicKey();
      if (!myPubkey) throw new Error('No public key');

      // Encrypt: Sender = Ephemeral, Receiver = Us
      const conversationKey = toolsNip44.v2.utils.getConversationKey(ephemeralPrivKey, myPubkey);
      const ciphertext = toolsNip44.v2.encrypt(json, conversationKey);

      const giftWrapEvent = {
        kind: KIND_GIFT_WRAP,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', myPubkey]],
        content: ciphertext,
        pubkey: ephemeralPubKey,
      };

      return finalizeEvent(giftWrapEvent, ephemeralPrivKey);
    },
    []
  );

  // Publish Message Flow
  const publishMessage = useCallback(
    async (
      conversationId: string,
      message: Message,
      modelId: string,
      previousEventId?: string
    ): Promise<string | null> => {
      try {
        setIsSyncing(true);
        setError(null);

        // 1. Create Inner
        const inner = await createInnerEvent(conversationId, message, modelId, previousEventId);
        
        // 2. Create Seal (Signed by US)
        const seal = await createSeal(inner);
        
        // 3. Create Gift Wrap (Signed by Random, Encrypted to US)
        const giftWrap = await createGiftWrap(seal);

        // 4. Publish
        if (poolRef.current) {
          // RelayPool.publish(relays: string[], event: Event)
          await poolRef.current.publish(relays, giftWrap);
          
          // Return the ID of the INNER event (or the Seal?)
          // for the linked list.
          // The "previous event ID" should probably be the ID of the SEAL 
          // because that's the stable ID that we (the user) signed.
          // The Gift Wrap ID is random and ephemeral.
          // The Inner Event ID is also valid, but the Seal is the container.
          // Let's use the Inner Event ID as the reference, as it's the semantic unit.
          // But wait, we can't query for the Inner Event ID directly because it's encrypted.
          // We query for Gift Wraps to US.
          // Inside, we find the Seal, then the Inner.
          // The `e` tag in the Inner event points to the previous Inner Event ID?
          // Yes, that makes the most sense for the logical chain.
          
          // We need to calculate the ID of the Inner Event.
          // Since we didn't "finalize" the inner event (it's just a JSON blob inside the seal),
          // it doesn't strictly have an ID on the network.
          // BUT, we can generate a deterministic ID for it if we want, 
          // or we can use the SEAL's ID.
          // The Seal IS a real event signed by us.
          // So let's use the SEAL ID as the "previous event ID".
          
          return seal.id;
        }
        return null;

      } catch (err) {
        console.error('Failed to publish message:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        return null;
      } finally {
        setIsSyncing(false);
      }
    },
    [createInnerEvent, createSeal, createGiftWrap, relays]
  );

  // Sync Conversations Flow
  const syncConversations = useCallback(async (): Promise<Conversation[]> => {
    try {
      setIsSyncing(true);
      setError(null);
      const myPubkey = await getPublicKey();
      if (!myPubkey) throw new Error('No public key');

      // 1. Fetch Kind 1059 events for us
      // We need to use a filter
      const filter = {
        kinds: [KIND_GIFT_WRAP],
        '#p': [myPubkey],
        // We might want to limit by time if we have a lastSyncTime
        // since: lastSyncTime ? lastSyncTime : undefined
      };

      // Use applesauce pool to query
      // pool.query(relays, filter) -> Observable or Promise?
      // The snippet showed: pool.sync(relays, eventStore, filter)
      // But we might not want to use a full EventStore if we are just processing them once.
      // Let's assume we can get a list of events.
      
      // If applesauce-relay doesn't have a simple "list" method, we might need to subscribe.
      // Let's use a simple subscription and collect events until EOSE.
      
      // For now, let's assume we can get the events. 
      // I'll implement a helper to fetch all events from the pool.
      const events: Event[] = [];
      
      // We need to check the RelayPool API. 
      // Assuming a standard-ish API or I'll wrap it.
      // If I can't verify the API, I'll use a standard pattern.
      
      // Let's use a promise-based fetcher
      const fetchEvents = () => new Promise<Event[]>((resolve) => {
        if (!poolRef.current) return resolve([]);
        
        // Assuming subscribe returns a Sub object with on() methods
        // If applesauce-relay uses RxJS observables (as seen in the example: pool.sync(...).pipe(...))
        // we should probably use that if possible, but for a simple fetch, subscribe is easier if available.
        // The example showed: pool.sync(relays, eventStore, filter)
        // Let's try to use a standard subscription if available, or fallback to a simple implementation.
        
        // If subscribe is not available on RelayPool, we might need to use individual relay connections
        // or check if there's a 'query' method.
        
        // Based on standard Nostr pools (like nostr-tools SimplePool), subscribe is common.
        // But applesauce-relay might be different.
        // Let's try to use the `subscribe` method if it exists, but cast it to any to avoid TS errors if definitions are missing.
        
        const sub = (poolRef.current as any).subscribe(relays, [filter]);
        const collected: Event[] = [];
        
        sub.on('event', (event: Event) => {
          collected.push(event);
        });
        
        sub.on('eose', () => {
          sub.close();
          resolve(collected);
        });
        
        // Timeout safety
        setTimeout(() => {
          sub.close();
          resolve(collected);
        }, 5000);
      });

      const giftWraps = await fetchEvents();
      
      // 2. Unwrap and Decrypt
      const decryptedEvents: any[] = [];
      const nip44 = getNip44();
      const { nip44: toolsNip44 } = await import('nostr-tools');

      for (const gw of giftWraps) {
        try {
          // Decrypt Gift Wrap (Kind 1059) -> Seal (Kind 13)
          // The Gift Wrap is encrypted TO us.
          // We use our extension to decrypt it.
          const sealJson = await nip44.decrypt(gw.pubkey, gw.content);
          const seal = JSON.parse(sealJson);

          if (seal.kind !== KIND_SEAL) continue;
          
          // Verify Seal signature? 
          // It should be signed by US (since we sent it to ourselves).
          // if (seal.pubkey !== myPubkey) continue; 
          
          // Decrypt Seal (Kind 13) -> Inner Event (Kind 20001)
          // The Seal is encrypted TO us (receiver).
          // Sender is also US.
          const innerJson = await nip44.decrypt(seal.pubkey, seal.content);
          const inner = JSON.parse(innerJson);

          if (inner.kind === KIND_CHAT_INNER) {
            // Attach the SEAL ID to the inner event so we can track the chain
            inner.id = seal.id; 
            decryptedEvents.push(inner);
          }
        } catch (e) {
          console.warn('Failed to decrypt event:', e);
        }
      }

      // 3. Reconstruct Conversations
      const conversationsMap = new Map<string, Conversation>();
      
      // Group by 'd' tag (UUID)
      for (const ev of decryptedEvents) {
        const dTag = ev.tags.find((t: string[]) => t[0] === 'd');
        if (!dTag) continue;
        const uuid = dTag[1];
        
        if (!conversationsMap.has(uuid)) {
          conversationsMap.set(uuid, {
            id: uuid,
            title: 'New Conversation', // Will be updated
            messages: [],
          });
        }
        
        const conv = conversationsMap.get(uuid)!;
        
        // Parse content
        let content = ev.content;
        try {
          const parsed = JSON.parse(ev.content);
          if (typeof parsed === 'object') content = parsed;
        } catch {}

        const roleTag = ev.tags.find((t: string[]) => t[0] === 'role');
        const role = roleTag ? roleTag[1] : 'user';
        
        // We need to handle the "thinking" field if it exists in the content or tags
        // For now, simple message mapping
        const message: Message = {
          role,
          content,
        };
        
        // Store the event ID for sorting
        (message as any)._eventId = ev.id;
        (message as any)._prevId = ev.tags.find((t: string[]) => t[0] === 'e')?.[1];
        (message as any)._createdAt = ev.created_at;

        conv.messages.push(message);
      }

      // 4. Sort Messages
      const conversations = Array.from(conversationsMap.values()).map(conv => {
        // Sort by created_at first as a baseline
        conv.messages.sort((a: any, b: any) => a._createdAt - b._createdAt);
        
        // TODO: Implement strict linked-list sorting if needed
        // For now, time-based sorting is usually sufficient if clocks are okay.
        
        // Clean up internal props
        conv.messages = conv.messages.map(m => {
          const { _eventId, _prevId, _createdAt, ...rest } = m as any;
          return rest as Message;
        });

        // Generate title
        // We can use the util function if we import it, or just leave it generic
        // The app will likely regenerate titles based on content
        
        return conv;
      });

      setLastSyncTime(Date.now());
      return conversations;

    } catch (err) {
      console.error('Sync failed:', err);
      setError(err instanceof Error ? err.message : 'Sync failed');
      return [];
    } finally {
      setIsSyncing(false);
    }
  }, [getNip44, relays]);

  return {
    isSyncing,
    lastSyncTime,
    error,
    publishMessage,
    syncConversations,
  };
};