import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { Conversation, Message } from '@/types/chat';
import {
  createPnsEvent,
  KIND_PNS,
  PnsKeys
} from '@/lib/pns';
import { useCurrentUser } from './useCurrentUser';
import { useNostrLogin } from '@nostrify/react/login';
import { useNostr as useNostrify } from '@nostrify/react';
import { getStorageItem, setStorageItem } from '@/utils/storageUtils';
import { eventStore} from '@/lib/applesauce-core';
import { triggerDerivedPnsSync, updateChatSyncEnabled } from './useChatSync1081';

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
  // Also update the reactive observable in useChatSyncProMax
  updateChatSyncEnabled(enabled);
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
    pnsKeys: PnsKeys,
    onMessagePublished?: (conversationId: string, message: Message) => void
  ) => Promise<string | null>;
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

  // Publish Message Flow
  const publishMessage = useCallback(
    async (
      conversationId: string,
      message: Message,
      pnsKeys: PnsKeys,
      onMessagePublished?: (conversationId: string, message: Message) => void
    ): Promise<string | null> => {
      try {
        setIsSyncing(true);
        setError(null);

        // 1. Create Inner
        const inner = await createInnerEvent(conversationId, message);
        
        // 2. Create PNS Event (Encrypted and Signed)
        const pnsEvent = createPnsEvent(inner, pnsKeys);
        eventStore.add(pnsEvent);
        console.log('Published message with event ID:', pnsEvent.id)
        
        triggerDerivedPnsSync();

        // Append message to conversationMapRef after successful publish
        if (onMessagePublished) {
          onMessagePublished(conversationId, { ...message, _eventId: pnsEvent.id });
        }

        return pnsEvent.id;
      } catch (err) {
        console.error('Failed to publish message:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        return null;
      } finally {
        setIsSyncing(false);
      }
    },
    [createInnerEvent, nostr]
  );

  return {
    isSyncing,
    lastSyncTime,
    error,
    chatSyncEnabled,
    setChatSyncEnabled,
    publishMessage,
  };
};