import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { Event, nip19 } from 'nostr-tools';
import { Conversation, Message } from '@/types/chat';
import {
  derivePnsKeys,
  encryptPnsEvent,
  createPnsEvent,
  KIND_PNS,
  PnsKeys
} from '@/lib/pns';
import { useCurrentUser } from './useCurrentUser';
import { useNostrLogin } from '@nostrify/react/login';
import { useNostr as useNostrify } from '@nostrify/react';
import { saveEventIdInStorage } from '@/utils/conversationUtils';
import {
  decryptPnsEventToInner,
  processInnerEvent,
  extractConversationMetadata
} from '@/utils/eventProcessing';
import { getStorageManager } from '@/utils/storageManager';
import { getStorageItem, setStorageItem } from '@/utils/storageUtils';
import { eventStore} from '@/lib/applesauce-core';
import { triggerSync } from './useChatSyncProMax';

// Storage key for chat sync enabled
const CHAT_SYNC_ENABLED_KEY = 'chatSyncEnabled';

// Subscribers for storage changes
const chatSyncSubscribers = new Set<() => void>();

// Subscribe function for useSyncExternalStore
const subscribeToChatSync = (callback: () => void) => {
  chatSyncSubscribers.add(callback);
  
  // Also listen for storage events from other tabs
  const handleStorage = (e: StorageEvent) => {
    if (e.key === CHAT_SYNC_ENABLED_KEY) {
      callback();
    }
  };
  window.addEventListener('storage', handleStorage);
  
  return () => {
    chatSyncSubscribers.delete(callback);
    window.removeEventListener('storage', handleStorage);
  };
};

// Get current value from localStorage
const getChatSyncSnapshot = (): boolean => {
  return getStorageItem<boolean>(CHAT_SYNC_ENABLED_KEY, true);
};

// Server snapshot (for SSR)
const getChatSyncServerSnapshot = (): boolean => {
  return true; // Default value for SSR
};

// Function to update the value and notify all subscribers
const setChatSyncEnabledGlobal = (enabled: boolean): void => {
  setStorageItem(CHAT_SYNC_ENABLED_KEY, enabled);
  // Notify all subscribers that the value changed
  chatSyncSubscribers.forEach(callback => callback());
};

// Custom Kinds
const KIND_CHAT_INNER = 20001;

interface ChatSyncHook {
  isSyncing: boolean;
  lastSyncTime: number | null;
  error: string | null;
  chatSyncEnabled: boolean;
  setChatSyncEnabled: (enabled: boolean) => void;
  publishMessage: (
    conversationId: string,
    message: Message,
  ) => Promise<string | null>;
  syncConversations: () => Promise<Conversation[]>;
  syncConversationsIncremental: (
    onConversationUpdate?: (conv: Conversation) => void,
    onComplete?: (conversations: Conversation[]) => void
  ) => Promise<Conversation[]>;
}

interface InnerEventPayload {
  content: string;
  tags: string[][];
  created_at: number;
  kind: number;
  pubkey: string;
}

export const useChatSync = (): ChatSyncHook => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user } = useCurrentUser();
  const { logins } = useNostrLogin()
  const { nostr } = useNostrify();

  // Use useSyncExternalStore to share chatSyncEnabled state across all hook instances
  const chatSyncEnabled = useSyncExternalStore(
    subscribeToChatSync,
    getChatSyncSnapshot,
    getChatSyncServerSnapshot
  );

  // Wrapper function that calls the global setter
  const setChatSyncEnabled = useCallback((enabled: boolean) => {
    setChatSyncEnabledGlobal(enabled);
  }, []);

  // Helper to get PNS keys
  const getPnsKeys = useCallback(() => {
    const privateKey = logins[0].type == 'nsec' ? nip19.decode(logins[0].data.nsec).data : null;
    if (!privateKey) {
      throw new Error('Private key not available');
    }
    return derivePnsKeys(privateKey);
  }, [logins]);

  // 1. Create Inner Event (Kind 20001)
  const createInnerEvent = useCallback(
    async (
      conversationId: string,
      message: Message
    ): Promise<InnerEventPayload> => {
      const pubkey = user?.pubkey;
      if (!pubkey) throw new Error('No public key available');

      const tags = [
        ['d', conversationId],
        ['role', message.role],
        ['client', 'routstr-chat'],
      ];

      if (message._prevId) {
        tags.push(['e', message._prevId]);
      }
      
      if (message.role === 'assistant') {
        tags.push(['model', message._modelId || 'unknown-model']);
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
    [user]
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
    ): Promise<string | null> => {
      try {
        setIsSyncing(true);
        setError(null);

        // 1. Create Inner
        const inner = await createInnerEvent(conversationId, message);
        
        // 2. Create PNS Event (Encrypted and Signed)
        const pnsEvent = await createPnsChatEvent(inner);
        eventStore.add(pnsEvent);
        console.log('Published message with event ID:', pnsEvent.id)
        
        // Trigger sync to push the new event to relays
        triggerSync();

        // saveEventIdInStorage(conversationId, message, pnsEvent.id)
        return pnsEvent.id;
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

  /**
   * Process a single PNS event incrementally
   * @param pnsEvent The PNS event to process
   * @param pnsKeys The PNS keys for decryption
   * @param conversationsMap Map of conversations being built
   * @param onConversationUpdate Optional callback for incremental updates
   */
  const processPnsEventIncremental = useCallback((
    pnsEvent: Event,
    pnsKeys: PnsKeys,
    conversationsMap: Map<string, Conversation>,
    onConversationUpdate?: (conv: Conversation) => void
  ): void => {
    // Decrypt PNS Event -> Inner Event
    const innerEvent = decryptPnsEventToInner(pnsEvent, pnsKeys);
    if (!innerEvent) {
      return;
    }

    // Process the inner event and update the conversations map
    processInnerEvent(conversationsMap, innerEvent);

    // Get the updated conversation
    const metadata = extractConversationMetadata(innerEvent);
    if (metadata && onConversationUpdate) {
      const conversation = conversationsMap.get(metadata.conversationId);
      if (conversation) {
        onConversationUpdate(conversation);
      }
    }
  }, []);

  /**
   * Sync conversations with incremental processing
   * Events are processed and displayed as they arrive
   */
  const syncConversationsIncremental = useCallback(async (
    onConversationUpdate?: (conv: Conversation) => void,
    onComplete?: (conversations: Conversation[]) => void
  ): Promise<Conversation[]> => {
    try {
      setIsSyncing(true);
      setError(null);
      
      const myPubkey = user?.pubkey;
      if (!myPubkey) throw new Error('No public key');

      // Get PNS keys
      const pnsKeys = getPnsKeys();
      console.log("Syncing conversations for PNS pubkey:", pnsKeys.pnsKeypair.pubKey);
      
      const filter = {
        kinds: [KIND_PNS],
        authors: [pnsKeys.pnsKeypair.pubKey],
      };

      // Fetch all PNS events
      const pnsEvents = await nostr.query([filter]);
      console.log(`Fetched ${pnsEvents.length} PNS events`);
      
      // Process events incrementally
      const conversationsMap = new Map<string, Conversation>();
      const storageManager = getStorageManager();

      for (const pnsEvent of pnsEvents) {
        try {
          // Process each event
          processPnsEventIncremental(
            pnsEvent,
            pnsKeys,
            conversationsMap,
            onConversationUpdate
          );
        } catch (e) {
          console.warn('Failed to process PNS event:', e);
        }
      }

      // Get final conversations array
      const conversations = Array.from(conversationsMap.values());
      
      // Sort conversations by most recent activity (newest first)
      conversations.sort((a, b) => {
        const aTime = Math.max(...a.messages.map(m => m._createdAt || 0));
        const bTime = Math.max(...b.messages.map(m => m._createdAt || 0));
        return bTime - aTime;
      });

      console.log(`Sync complete: ${conversations.length} conversations`);

      // Queue batch update to storage
      storageManager.queueBatchUpdate(conversations);

      // Call completion callback
      if (onComplete) {
        onComplete(conversations);
      }

      setLastSyncTime(Date.now());
      return conversations;

    } catch (err) {
      console.error('Sync failed:', err);
      setError(err instanceof Error ? err.message : 'Sync failed');
      return [];
    } finally {
      setIsSyncing(false);
    }
  }, [getPnsKeys, nostr, user, processPnsEventIncremental]);

  /**
   * Sync Conversations Flow (Backward compatible wrapper)
   * Fetches all events at once and returns complete conversations
   */
  const syncConversations = useCallback(async (): Promise<Conversation[]> => {
    return await syncConversationsIncremental();
  }, [syncConversationsIncremental]);

  return {
    isSyncing,
    lastSyncTime,
    error,
    chatSyncEnabled,
    setChatSyncEnabled,
    publishMessage,
    syncConversations,
    syncConversationsIncremental,
  };
};