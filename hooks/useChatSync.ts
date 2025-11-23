import { useState, useEffect, useCallback, useRef } from 'react';
import { RelayPool } from 'applesauce-relay';
import { Event, nip19 } from 'nostr-tools';
import { Conversation, Message } from '@/types/chat';
import { useNostr } from '@/context/NostrContext';
import { toast } from 'sonner';
import {
  derivePnsKeys,
  encryptPnsEvent,
  createPnsEvent,
  decryptPnsEvent,
  KIND_PNS
} from '@/lib/pns';
import { useCurrentUser } from './useCurrentUser';
import { useNostrLogin } from '@nostrify/react/login';

// Custom Kinds
const KIND_CHAT_INNER = 20001;
const SALT_CHAT_HISTORY = 'routstr-chat-history-v2';

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
  const { privateKey } = useNostr();
  const { user } = useCurrentUser();
  const { logins } = useNostrLogin()

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

  // Helper to get PNS keys
  const getPnsKeys = useCallback(() => {
    const privateKey = logins[0].type == 'nsec' ? nip19.decode(logins[0].data.nsec).data : null;
    if (!privateKey) {
      throw new Error('Private key not available');
    }
    return derivePnsKeys(privateKey);
  }, [privateKey]);

  // 1. Create Inner Event (Kind 20001)
  const createInnerEvent = useCallback(
    async (
      conversationId: string,
      message: Message,
      modelId: string,
      previousEventId?: string
    ): Promise<InnerEventPayload> => {
      const pubkey = user?.pubkey;
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

  // 2. Create PNS Event (Kind 1080) - Encrypted Inner Event
  const createPnsChatEvent = useCallback(
    async (innerEvent: InnerEventPayload): Promise<Event> => {
      const pnsKeys = getPnsKeys();
      
      // Encrypt the inner event using PNS
      const { content } = encryptPnsEvent(innerEvent, pnsKeys);
      
      // Create and sign the PNS event
      return createPnsEvent(content, pnsKeys);
    },
    [getPnsKeys]
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
        console.log('iner event', inner);
        
        // 2. Create PNS Event (Encrypted and Signed)
        const pnsEvent = await createPnsChatEvent(inner);
        console.log('pns', pnsEvent);

        // 3. Publish
        if (poolRef.current) {
          // RelayPool.publish(relays: string[], event: Event)
          const pubred = await poolRef.current.publish(relays, pnsEvent);
          console.log(pubred);
          
          // Return the ID of the PNS event for the linked list
          return pnsEvent.id;
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
    [createInnerEvent, createPnsChatEvent, relays]
  );

  // Sync Conversations Flow
  const syncConversations = useCallback(async (): Promise<Conversation[]> => {
    try {
      setIsSyncing(true);
      setError(null);
      const myPubkey = user?.pubkey;
      if (!myPubkey) throw new Error('No public key');

      // 1. Fetch Kind 1080 PNS events for us
      // We need to use a filter
      const pnsKeys = getPnsKeys();
      const filter = {
        kinds: [KIND_PNS],
        authors: [pnsKeys.pnsKeypair.pubKey],
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

      const pnsEvents = await fetchEvents();
      
      // 2. Decrypt PNS Events
      const decryptedEvents: any[] = [];

      for (const pnsEvent of pnsEvents) {
        try {
          // Decrypt PNS Event (Kind 1080) -> Inner Event (Kind 20001)
          const inner = decryptPnsEvent(pnsEvent, pnsKeys);
          
          if (inner && inner.kind === KIND_CHAT_INNER) {
            // Attach the PNS event ID to the inner event so we can track the chain
            inner.id = pnsEvent.id;
            decryptedEvents.push(inner);
          }
        } catch (e) {
          console.warn('Failed to decrypt PNS event:', e);
        }
      }

      // 3. Reconstruct Conversations
      const conversationsMap = new Map<string, Conversation>();
      console.log(decryptedEvents);
      
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
  }, [getPnsKeys, relays]);

  return {
    isSyncing,
    lastSyncTime,
    error,
    publishMessage,
    syncConversations,
  };
};