import { useState, useEffect, useCallback } from 'react';
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
import { loadActiveConversationId, saveActiveConversationId } from '@/utils/storageUtils';
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

  const { config } = useAppContext(); // Keep presetRelays even if not used directly here

  const { syncConversationsIncremental, isSyncing, publishMessage } = useChatSync();
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

  // Sync real-time conversations from useChatSyncPro
  useEffect(() => {
    if (realtimeConversations.length > 0) {
      setConversations(prev => {
        // Merge real-time conversations with existing ones
        const mergedMap = new Map(prev.map(c => [c.id, c]));


        // Update with real-time data
        realtimeConversations.forEach((realtimeConv: Conversation) => {
          const localConv = mergedMap.get(realtimeConv.id);

          if (localConv) {
            // Common conversation ID found - merge messages
            const realtimeMessages = realtimeConv.messages;
            const localMessages = localConv.messages;

            // Map of realtime event IDs for quick lookup
            const realtimeEventIds = new Set(
              realtimeMessages
                .map(m => m._eventId)
                .filter(id => id !== undefined)
            );

            // Start with realtime messages as the base (source of truth for synced content)
            const mergedMessages = [...realtimeMessages];
            let hasChanges = false;

            // Check local messages for any that are missing in realtime (unsynced)
            localMessages.forEach(localMsg => {
              // If message has an event ID, check if it exists in realtime
              // If message has no event ID, it's definitely unsynced
              const isSynced = localMsg._eventId && realtimeEventIds.has(localMsg._eventId);

              if (!isSynced) {
                // This message exists locally but not in realtime sync
                // Add it to our merged list
                mergedMessages.push(localMsg);
                hasChanges = true;

                // TODO: Publish this missing event
                // if (localMsg.role === 'user') {
                //   publishMessage(
                //     realtimeConv.id,
                //     [...realtimeMessages, localMsg], // Context + new message
                //     'current-model-id', // We need the model ID here
                //     (newMsgs) => {
                //       // Callback to update messages after publish
                //       console.log('Published missing message:', localMsg);
                //     }
                //   );
                // }
              }
            });

            // If we merged anything, sort by creation time
            if (hasChanges) {
              mergedMessages.sort((a, b) => (a._createdAt || 0) - (b._createdAt || 0));
            }

            const mergedConv = {
              ...realtimeConv,
              messages: mergedMessages
            };

            mergedMap.set(realtimeConv.id, mergedConv);

            // If this updated conversation is the currently active one, update messages
            if (activeConversationId && realtimeConv.id === activeConversationId) {
              console.log('rdlogs: Real-time update for active conversation (merged):', realtimeConv.id);
              setMessages(mergedMessages);
            }
          } else {
            // New conversation from realtime
            mergedMap.set(realtimeConv.id, realtimeConv);

            // If this updated conversation is the currently active one, update messages
            if (activeConversationId && realtimeConv.id === activeConversationId) {
              console.log('rdlogs: Real-time update for active conversation:', realtimeConv.id);
              setMessages(realtimeConv.messages);
            }
          }
        });
        const updatedConversations = Array.from(mergedMap.values());

        // Sort by most recent activity
        const sortedConversations = sortConversationsByRecentActivity(updatedConversations);
        console.log("realtimeConversations", sortedConversations);
        // Persist the merged conversations to storage
        persistConversationsSnapshot(sortedConversations);
        
        return sortedConversations;
      });
    }
  }, [realtimeConversations, activeConversationId, publishMessage]);

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
