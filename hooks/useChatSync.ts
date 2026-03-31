import { useState, useCallback, useSyncExternalStore } from "react";
import { Conversation, Message } from "@/types/chat";
import { createPnsEvent, PnsKeys } from "@/lib/pns";
import { getStorageItem, setStorageItem } from "@/utils/storageUtils";
import { eventStore, relayPool } from "@/lib/applesauce-core";
import {
  triggerDerivedPnsSync,
  updateChatSyncEnabled,
} from "./useChatSync1081";
import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";
import { useAppContext } from "@/hooks/useAppContext";

// Storage key for chat sync enabled
const CHAT_SYNC_ENABLED_KEY = "chatSyncEnabled";

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
  window.addEventListener("storage", handleStorage);

  return () => {
    chatSyncSubscribers.delete(callback);
    window.removeEventListener("storage", handleStorage);
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
  chatSyncSubscribers.forEach((callback) => callback());
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
  migrateConversations: (
    conversations: Conversation[],
    pnsKeys: PnsKeys
  ) => Promise<Conversation[] | null>;
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
  const { manager } = useAccountManager();
  const { config } = useAppContext();
  const activeAccount = useObservableState(manager.active$);

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
    (conversationId: string, message: Message): InnerEventPayload => {
      const pubkey = activeAccount?.pubkey;
      if (!pubkey) {
        throw new Error("No public key available");
      }

      const tags = [
        ["d", conversationId],
        ["role", message.role],
        ["client", "routstr-chat"],
      ];

      if (message._prevId) {
        tags.push(["e", message._prevId]);
      }

      if (message.role === "assistant") {
        tags.push(["model", message._modelId || "unknown-model"]);
      }

      // Serialize content if it's complex (e.g., with images)
      const contentStr =
        typeof message.content === "string"
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
    [activeAccount]
  );

  const migrateConversations = useCallback(
    async (
      conversations: Conversation[],
      pnsKeys: PnsKeys
    ): Promise<Conversation[] | null> => {
      try {
        setIsSyncing(true);
        let addedCount = 0;
        const eventsToPublish: ReturnType<typeof createPnsEvent>[] = [];

        // Deep copy to avoid mutating state directly
        const updatedConversations: Conversation[] = JSON.parse(
          JSON.stringify(conversations)
        );

        for (const conversation of updatedConversations) {
          for (const message of conversation.messages) {
            // Skip if already has event ID
            if (message._eventId) continue;

            try {
              // 1. Create Inner
              const inner = createInnerEvent(conversation.id, message);

              // 2. Create PNS Event
              const pnsEvent = createPnsEvent(inner, pnsKeys);
              eventStore.add(pnsEvent);
              eventsToPublish.push(pnsEvent);

              // Update message with event ID
              message._eventId = pnsEvent.id;
              addedCount++;
            } catch (err) {
              console.error("Failed to migrate message:", err);
            }
          }
        }

        if (addedCount > 0) {
          await Promise.allSettled(
            eventsToPublish.map((event) => relayPool.publish(config.relayUrls, event))
          );
          console.log(`Migrated ${addedCount} messages`);
          triggerDerivedPnsSync();
          setLastSyncTime(Date.now());
          return updatedConversations;
        }

        return null;
      } catch (err) {
        console.error("Migration failed:", err);
        return null;
      } finally {
        setIsSyncing(false);
      }
    },
    [config.relayUrls, createInnerEvent]
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
        const inner = createInnerEvent(conversationId, message);

        // 2. Create PNS Event (Encrypted and Signed)
        const pnsEvent = createPnsEvent(inner, pnsKeys);
        eventStore.add(pnsEvent);
        if (onMessagePublished) {
          onMessagePublished(conversationId, {
            ...message,
            _eventId: pnsEvent.id,
          });
        }

        await relayPool.publish(config.relayUrls, pnsEvent);
        console.log("Published message with event ID:", pnsEvent.id);

        triggerDerivedPnsSync();
        setLastSyncTime(Date.now());

        return pnsEvent.id;
      } catch (err) {
        console.error("Failed to publish message:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        return null;
      } finally {
        setIsSyncing(false);
      }
    },
    [config.relayUrls, createInnerEvent]
  );

  return {
    isSyncing,
    lastSyncTime,
    error,
    chatSyncEnabled,
    setChatSyncEnabled,
    publishMessage,
    migrateConversations,
  };
};
