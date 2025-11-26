import { useState, useEffect, useCallback, useRef } from 'react';
import { Conversation, Message } from '@/types/chat';
import {
  loadConversationsFromStorage,
  saveConversationToStorage,
  createAndStoreNewConversation,
  deleteConversationFromStorage,
  findConversationById,
  clearAllConversations,
  persistConversationsSnapshot,
  sortConversationsByRecentActivity
} from '@/utils/conversationUtils';
import { getTextFromContent } from '@/utils/messageUtils';
import { loadActiveConversationId, saveActiveConversationId, loadLastUsedModel } from '@/utils/storageUtils';
import { useChatSync } from './useChatSync';
import { useChatSyncPro } from './useChatSyncPro';
import { useAppContext } from './useAppContext';

export interface UseConversationStateReturn {
  conversations: Conversation[];
  conversationsLoaded: boolean;
  activeConversationId: string | null;
  messages: Message[];
  editingMessageIndex: number | null;
  editingContent: string;
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  setEditingMessageIndex: (index: number | null) => void;
  setEditingContent: (content: string) => void;
  createNewConversationHandler: (initialMessages?: Message[], timestamp?: string) => string;
  loadConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string, e: React.MouseEvent) => void;
  clearConversations: () => void;
  startEditingMessage: (index: number) => void;
  cancelEditing: () => void;
  saveCurrentConversation: () => void;
  saveConversationById: (conversationId: string, newMessages: Message[]) => void;
  getActiveConversationId: () => string | null;
  syncWithNostr: () => Promise<void>;
  isSyncing: boolean;
}

interface PendingPublishTask {
  conversationId: string;
  messages: Message[];
  key: string;
  modelId: string;
}

/**
 * Custom hook for managing conversation and message state
 * Handles conversation CRUD operations, message state management,
 * active conversation tracking, and conversation persistence
 */
export const useConversationState = (): UseConversationStateReturn => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');

  const activeConversationIdRef = useRef<string | null>(null);
  const pendingPublishKeysRef = useRef<Set<string>>(new Set());


  const { syncConversationsIncremental, isSyncing, publishMessage, chatSyncEnabled } = useChatSync();
  const { conversations: realtimeConversations, events } = useChatSyncPro();

  // useChatHistorySync({
  //   conversations,
  //   setConversations,
  //   activeConversationId,
  //   setMessages,
  //   conversationsLoaded
  // });

  /**
   * Handle incremental conversation updates as events arrive
   */
  const handleConversationUpdate = useCallback((updatedConversation: Conversation) => {
    setConversations(prev => {
      // Find if conversation already exists
      const existingIndex = prev.findIndex(c => c.id === updatedConversation.id);
      
      if (existingIndex !== -1) {
        // Update existing conversation
        const updated = [...prev];
        updated[existingIndex] = updatedConversation;
        return updated;
      } else {
        // Add new conversation
        return [...prev, updatedConversation];
      }
    });
  }, []);

  /**
   * Sync with Nostr using incremental processing
   * Events are displayed as they arrive for better user experience
   */
  const syncWithNostr = useCallback(async () => {
    await syncConversationsIncremental(
      // Callback for each conversation update as events arrive
      handleConversationUpdate,
      // Callback when sync completes
      (finalConversations) => {
        console.log(`Sync complete: ${finalConversations.length} conversations loaded`);
        // Final state update happens automatically through handleConversationUpdate
        // Storage is handled by the storage manager in useChatSync
      }
    );
  }, [syncConversationsIncremental, handleConversationUpdate]);

  // Load conversations and active conversation ID from storage on mount
  useEffect(() => {
    const loadedConversations = loadConversationsFromStorage();
    console.log("LOADING ", loadedConversations)
    setConversations(loadedConversations);
    setConversationsLoaded(true);
  }, []);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const updateConversationAfterPublish = useCallback((conversationId: string, newMessages: Message[]) => {
    setConversations(prevConversations => {
      return saveConversationToStorage(prevConversations, conversationId, newMessages);
    });

    if (activeConversationIdRef.current === conversationId) {
      setMessages(newMessages);
    }
  }, [setConversations, setMessages]);

  // Sync real-time conversations from useChatSyncPro and backfill unsynced messages
  useEffect(() => {
    console.log(chatSyncEnabled);
    const pendingPublishes: PendingPublishTask[] = [];

    const buildPendingKey = (conversationId: string, message: Message, fallbackIndex: number): string => {
      const createdKey = message._createdAt ?? `created-${fallbackIndex}`;
      const prevKey = message._prevId ?? `prev-${fallbackIndex}`;
      return `${conversationId}:${createdKey}:${prevKey}`;
    };

    const getModelIdForMessage = (message?: Message): string => {
      const candidate = (message && typeof (message as any)?.model === 'string')
        ? (message as any).model
        : (message && typeof (message as any)?.metadata?.model === 'string')
          ? (message as any).metadata.model
          : undefined;
      return candidate ?? loadLastUsedModel() ?? 'unknown-model';
    };

    const enqueuePublish = (conversationId: string, message: Message, snapshot: Message[], fallbackIndex: number) => {
      if (!chatSyncEnabled) return;

      const key = buildPendingKey(conversationId, message, fallbackIndex);
      if (pendingPublishKeysRef.current.has(key)) {
        return;
      }

      pendingPublishKeysRef.current.add(key);
      pendingPublishes.push({
        conversationId,
        messages: snapshot,
        key,
        modelId: getModelIdForMessage(message),
      });
    };

    setConversations(prev => {
      if (prev.length === 0 && realtimeConversations.length === 0) {
        return prev;
      }

      const mergedMap = new Map(prev.map(c => [c.id, c]));
      const realtimeConversationIds = new Set(realtimeConversations.map(conv => conv.id));

      if (realtimeConversations.length > 0) {
        realtimeConversations.forEach((realtimeConv: Conversation) => {
          const localConv = mergedMap.get(realtimeConv.id);

          if (localConv) {
            const realtimeMessages = realtimeConv.messages;
            const localMessages = localConv.messages;

            const realtimeEventIds = new Set(
              realtimeMessages
                .map(m => m._eventId)
                .filter((id): id is string => id !== undefined)
            );

            const mergedMessages = [...realtimeMessages];
            let hasChanges = false;

            localMessages.forEach((localMsg, localIndex) => {
              const isSynced = localMsg._eventId && realtimeEventIds.has(localMsg._eventId);

              if (!isSynced) {
                mergedMessages.push(localMsg);
                hasChanges = true;

                enqueuePublish(
                  realtimeConv.id,
                  localMsg,
                  mergedMessages.slice(),
                  localIndex
                );
              }
            });

            if (hasChanges) {
              mergedMessages.sort((a, b) => (a._createdAt || 0) - (b._createdAt || 0));
            }

            const mergedConv = {
              ...realtimeConv,
              messages: mergedMessages
            };

            mergedMap.set(realtimeConv.id, mergedConv);

            if (activeConversationId && realtimeConv.id === activeConversationId) {
              console.log('rdlogs: Real-time update for active conversation (merged):', realtimeConv.id);
              setMessages(mergedMessages);
            }
          } else {
            mergedMap.set(realtimeConv.id, realtimeConv);

            if (activeConversationId && realtimeConv.id === activeConversationId) {
              console.log('rdlogs: Real-time update for active conversation:', realtimeConv.id);
              setMessages(realtimeConv.messages);
            }
          }
        });
      }

      const unsyncedLocalConversationIds: string[] = [];
      prev.forEach(localConv => {
        if (!realtimeConversationIds.has(localConv.id) && localConv.messages.length > 0) {
          unsyncedLocalConversationIds.push(localConv.id);

          if (chatSyncEnabled) {
            const progressiveMessages: Message[] = [];
            localConv.messages.forEach((message, idx) => {
              progressiveMessages.push(message);
              if (!message._eventId) {
                enqueuePublish(localConv.id, message, progressiveMessages.slice(), idx);
              }
            });
          }

          if (activeConversationId && localConv.id === activeConversationId) {
            console.log('rdlogs: Active conversation awaiting realtime presence:', localConv.id);
            setMessages(localConv.messages);
          }
        }
      });

      if (unsyncedLocalConversationIds.length > 0) {
        console.log('rdlogs: Conversations missing from realtime sync:', unsyncedLocalConversationIds);
      }

      if (realtimeConversations.length > 0) {
        const updatedConversations = Array.from(mergedMap.values());
        const sortedConversations = sortConversationsByRecentActivity(updatedConversations);
        console.log('realtimeConversations', sortedConversations);
        persistConversationsSnapshot(sortedConversations);

        return sortedConversations;
      }

      return prev;
    });

    if (pendingPublishes.length > 0 && chatSyncEnabled) {
      pendingPublishes.forEach(task => {
        publishMessage(
          task.conversationId,
          task.messages,
          task.modelId,
          (newMessages) => updateConversationAfterPublish(task.conversationId, newMessages)
        )
          .catch(err => {
            console.error('Failed to publish pending message:', err);
          })
          .finally(() => {
            pendingPublishKeysRef.current.delete(task.key);
          });
      });
    } else if (pendingPublishes.length > 0) {
      pendingPublishes.forEach(task => pendingPublishKeysRef.current.delete(task.key));
    }
  }, [realtimeConversations, activeConversationId, publishMessage, chatSyncEnabled, updateConversationAfterPublish, setMessages]);

  // Save current conversation whenever messages change
  const saveCurrentConversation = useCallback(() => {
    if (!activeConversationId) return;

    setConversations(prevConversations => {
      return saveConversationToStorage(
        prevConversations,
        activeConversationId,
        messages
      );
    });
  }, [activeConversationId, messages]);

  // Auto-save conversation when messages change
  useEffect(() => {
    if (activeConversationId && messages.length > 0) {
      saveCurrentConversation();
    }
  }, [messages, activeConversationId, saveCurrentConversation]);

  // Set editing content when editing message index changes
  useEffect(() => {
    if (editingMessageIndex !== null && messages[editingMessageIndex]) {
      const messageText = getTextFromContent(messages[editingMessageIndex].content);
      setEditingContent(messageText);
    }
  }, [editingMessageIndex, messages]);

  // Reset inline editing state when switching conversations
  useEffect(() => {
    setEditingMessageIndex(null);
    setEditingContent('');
  }, [activeConversationId]);

  // Wrapper function to set active conversation ID and save to localStorage
  const setActiveConversationIdWithStorage = useCallback((conversationId: string | null) => {
    setActiveConversationId(conversationId);
    saveActiveConversationId(conversationId);
  }, []);

  const createNewConversationHandler = useCallback((initialMessages: Message[] = [], timestamp?: string) => {
    let createdId: string = '';
    setConversations(prevConversations => {
      const { newConversation, updatedConversations } = createAndStoreNewConversation(prevConversations, initialMessages, timestamp);
      createdId = newConversation.id;
      setActiveConversationIdWithStorage(newConversation.id);
      // Set messages to the initial messages (empty array if none provided)
      setMessages(initialMessages);
      return updatedConversations;
    });
    return createdId;
  }, []);

  const loadConversation = useCallback((conversationId: string) => {
    setConversations(prevConversations => {
      const conversation = findConversationById(prevConversations, conversationId);
      if (conversation) {
        setActiveConversationIdWithStorage(conversationId);
        console.log("rdlogs: loadConversation", conversationId)
        setMessages(conversation.messages);
      }
      return prevConversations;
    });
  }, [setActiveConversationIdWithStorage]);

  const deleteConversation = useCallback((conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    setConversations(prevConversations => {
      const updatedConversations = deleteConversationFromStorage(prevConversations, conversationId);
      
      if (conversationId === activeConversationId) {
        setActiveConversationIdWithStorage(null);
        setMessages([]);
      }
      
      return updatedConversations;
    });
  }, [activeConversationId, setActiveConversationIdWithStorage]);

  const clearConversations = useCallback(() => {
    setConversations([]);
    setActiveConversationIdWithStorage(null);
    setMessages([]);
    clearAllConversations();
  }, [setActiveConversationIdWithStorage]);

  const startEditingMessage = useCallback((index: number) => {
    setEditingMessageIndex(index);
    const messageText = getTextFromContent(messages[index].content);
    setEditingContent(messageText);
    // Store the original message content for preserving attachments
    if (typeof messages[index].content !== 'string') {
      // Already an array with possible attachments
    }
  }, [messages]);

  const cancelEditing = useCallback(() => {
    setEditingMessageIndex(null);
    setEditingContent('');
  }, []);

  return {
    conversations,
    activeConversationId,
    messages,
    editingMessageIndex,
    editingContent,
    setConversations,
    setActiveConversationId: setActiveConversationIdWithStorage,
    setMessages,
    setEditingMessageIndex,
    setEditingContent,
    createNewConversationHandler,
    loadConversation,
    deleteConversation,
    clearConversations,
    startEditingMessage,
    cancelEditing,
    saveCurrentConversation,
    saveConversationById: (conversationId: string, newMessages: Message[]) => {
      setConversations(prevConversations => {
        return saveConversationToStorage(prevConversations, conversationId, newMessages);
      });
    },
    getActiveConversationId: () => loadActiveConversationId(),
    conversationsLoaded,
    syncWithNostr,
    isSyncing
  };
};
