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
import { relayPool } from '@/lib/applesauce-core';
import { useNostr as useNostrify } from '@nostrify/react';
import { saveEventIdInStorage } from '@/utils/conversationUtils';
import { useConversationState } from './useConversationState';

// Custom Kinds
const KIND_CHAT_INNER = 20001;
const SALT_CHAT_HISTORY = 'routstr-chat-history-v2';

interface ChatSyncHook {
  isSyncing: boolean;
  lastSyncTime: number | null;
  error: string | null;
  publishMessage: (
    conversationId: string,
    updatedMessages: Message[],
    modelId: string,
    updateMessages: (newMessages: Message[]) => void
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
  const { nostr } = useNostrify();

  // Initialize RelayPool (no longer needed with nostrify)
  useEffect(() => {
    // This effect is kept for compatibility but the poolRef is no longer used
    // as we're now using the nostrify pool from the context
    return () => {
      // Cleanup if needed
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
      modelId: string
    ): Promise<InnerEventPayload> => {
      const pubkey = user?.pubkey;
      if (!pubkey) throw new Error('No public key available');

      const tags = [
        ['d', conversationId],
        ['role', message.role],
        ['model', modelId],
        ['client', 'routstr-chat'],
      ];

      if (message._prevId) {
        tags.push(['e', message._prevId]);
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
      updatedMessages: Message[],
      modelId: string,
      updateMessages: (newMessages: Message[]) => void
    ): Promise<string | null> => {
      console.log(updatedMessages)
      const message = updatedMessages[updatedMessages.length - 1];
      try {
        setIsSyncing(true);
        setError(null);

        // 1. Create Inner
        const inner = await createInnerEvent(conversationId, message, modelId);
        console.log('iner event', inner);
        
        // 2. Create PNS Event (Encrypted and Signed)
        const pnsEvent = await createPnsChatEvent(inner);
        console.log('pns', pnsEvent);

        // 3. Publish
        if (nostr) {
          // Use nostrify pool to publish the event
          await nostr.event(pnsEvent);
          if (message._prevId) {
            // Edit the last message to add _eventId
            const lastMessage = updatedMessages[updatedMessages.length - 1];
            lastMessage._eventId = pnsEvent.id;
            
            updateMessages(updatedMessages)
            saveEventIdInStorage(conversationId, message._prevId, pnsEvent.id);
          }
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
    [createInnerEvent, createPnsChatEvent, nostr]
  );

  // Sync Conversations Flow
  const syncConversations = useCallback(async (): Promise<Conversation[]> => {
    try {
      setIsSyncing(true);
      setError(null);
      console.log(user);
      const myPubkey = user?.pubkey;
      if (!myPubkey) throw new Error('No public key');

      // 1. Fetch Kind 1080 PNS events for us
      const pnsKeys = getPnsKeys();
      const filter = {
        kinds: [KIND_PNS],
        authors: [pnsKeys.pnsKeypair.pubKey],
        // We might want to limit by time if we have a lastSyncTime
        // since: lastSyncTime ? lastSyncTime : undefined
      };

      // Use the nostrify pool to query events
      // This follows the same pattern as useChatHistorySync
      const pnsEvents = await nostr.query([filter]);
      
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
            title: '', // Will be set to first message content
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
        
        // Set title to first message content if title is empty
        if (!conv.title && conv.messages.length === 1) {
          // If content is a string, use it directly
          // If content is an object, convert to string or extract text
          if (typeof message.content === 'string') {
            conv.title = message.content.length > 50
              ? message.content.substring(0, 50) + '...'
              : message.content;
          } else {
            conv.title = JSON.stringify(message.content).length > 50
              ? JSON.stringify(message.content).substring(0, 50) + '...'
              : JSON.stringify(message.content);
          }
        }
      }

      // 4. Sort Messages
      const conversations = Array.from(conversationsMap.values()).map(conv => {
        // Sort by created_at first as a baseline
        conv.messages.sort((a: any, b: any) => a._createdAt - b._createdAt);
        
        // TODO: Implement strict linked-list sorting if needed
        // For now, time-based sorting is usually sufficient if clocks are okay.
        
        // Keep all properties including _eventId, _prevId, and _createdAt
        // No longer cleaning up internal props as we want to preserve them

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
  }, [getPnsKeys, nostr]);

  return {
    isSyncing,
    lastSyncTime,
    error,
    publishMessage,
    syncConversations,
  };
};