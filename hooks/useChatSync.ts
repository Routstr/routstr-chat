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
  KIND_PNS,
  PnsKeys
} from '@/lib/pns';
import { useCurrentUser } from './useCurrentUser';
import { useNostrLogin } from '@nostrify/react/login';
import { useNostr as useNostrify } from '@nostrify/react';
import { saveEventIdInStorage } from '@/utils/conversationUtils';
import { useChatSyncPro } from './useChatSyncPro';
import {
  decryptPnsEventToInner,
  processInnerEvent,
  extractConversationMetadata
} from '@/utils/eventProcessing';
import { getStorageManager } from '@/utils/storageManager';

// LocalStorage key for chat sync enabled state
const CHAT_SYNC_ENABLED_KEY = 'chatSyncEnabled';

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
    updatedMessages: Message[],
    modelId: string,
    updateMessages: (newMessages: Message[]) => void
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
  const [chatSyncEnabled, setChatSyncEnabledState] = useState<boolean>(true);
  const { user } = useCurrentUser();
  const { logins } = useNostrLogin()
  const { nostr } = useNostrify();

  // Initialize chatSyncEnabled from localStorage
  useEffect(() => {
    try {
      const storedValue = localStorage.getItem(CHAT_SYNC_ENABLED_KEY);
      if (storedValue !== null) {
        setChatSyncEnabledState(storedValue === 'true');
      }
    } catch (error) {
      console.error('Failed to read chatSyncEnabled from localStorage:', error);
    }
  }, []);

  // Function to update chatSyncEnabled in both state and localStorage
  const setChatSyncEnabled = useCallback((enabled: boolean) => {
    try {
      localStorage.setItem(CHAT_SYNC_ENABLED_KEY, enabled.toString());
      setChatSyncEnabledState(enabled);
    } catch (error) {
      console.error('Failed to save chatSyncEnabled to localStorage:', error);
    }
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
        
        // 2. Create PNS Event (Encrypted and Signed)
        const pnsEvent = await createPnsChatEvent(inner);

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