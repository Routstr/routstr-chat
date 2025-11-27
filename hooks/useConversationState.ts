import { useState, useEffect, useCallback, useRef } from 'react';
import { Conversation, Message } from '@/types/chat';
import {
  loadConversationsFromStorage,
  saveConversationToStorage,
  createAndStoreNewConversation,
  createNewConversationWithMap,
  deleteConversationFromStorage,
  findConversationById,
  clearAllConversations,
  sortConversationsByRecentActivity
} from '@/utils/conversationUtils';
import { getTextFromContent } from '@/utils/messageUtils';
import { loadActiveConversationId, saveActiveConversationId, loadLastUsedModel } from '@/utils/storageUtils';
import { useChatSync } from './useChatSync';
import { useChatSyncProMax } from './useChatSyncProMax';
import { processInnerEvent, decryptPnsEventToInner } from '@/utils/eventProcessing';
import { eventStore } from '@/lib/applesauce-core';

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

  const activeConversationIdRef = useRef<string | null>(null);
  const conversationsMapRef = useRef<Map<string, Conversation>>(new Map());
  const processedEventIdsRef = useRef<Set<string>>(new Set());

  const { syncConversationsIncremental, isSyncing, publishMessage, chatSyncEnabled } = useChatSync();
  const { syncedEvents, loading, currentPnsKeys } = useChatSyncProMax()

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

  // Process synced events from useChatSyncProMax
  useEffect(() => {
    if (!currentPnsKeys) {
      return;
    }

    let hasNewEvents = false;

    const eventsToLoad = eventStore.getByFilters({ kinds: [1080] });
    eventsToLoad.forEach((event) => {
      // Skip already processed events
      if (processedEventIdsRef.current.has(event.id)) {
        return;
      }

      // Decrypt and process the event
      const innerEvent = decryptPnsEventToInner(event, currentPnsKeys);
      if (!innerEvent) {
        return;
      }

      // Update conversations map
      processInnerEvent(conversationsMapRef.current, innerEvent);
      processedEventIdsRef.current.add(event.id);
      hasNewEvents = true;
    });

    // Update state with new conversations array if we processed any new events
    if (hasNewEvents) {
      const updatedConversations = Array.from(conversationsMapRef.current.values());
      const sortedConversations = sortConversationsByRecentActivity(updatedConversations);
      setConversations(sortedConversations);

      // Update messages for active conversation
      const currentActiveId = activeConversationIdRef.current;
      if (currentActiveId) {
        const activeConv = conversationsMapRef.current.get(currentActiveId);
        if (activeConv) {
          setMessages(activeConv.messages);
        }
      }
    }
  }, [syncedEvents, currentPnsKeys, loading]);

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
      const { newConversation, updatedConversations } = createNewConversationWithMap(conversationsMapRef.current, initialMessages, timestamp);
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
      const conversation = conversationsMapRef.current.get(conversationId);
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
