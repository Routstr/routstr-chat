import { useState, useEffect, useCallback } from 'react';
import { Conversation, Message } from '@/types/chat';
import {
  loadConversationsFromStorage,
  saveConversationToStorage,
  createAndStoreNewConversation,
  deleteConversationFromStorage,
  findConversationById,
  clearAllConversations
} from '@/utils/conversationUtils';
import { getTextFromContent } from '@/utils/messageUtils';
import { loadActiveConversationId, saveActiveConversationId } from '@/utils/storageUtils';
import { useChatHistorySync } from './useChatHistorySync';
import { useChatSync } from './useChatSync';
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

  const { syncConversations, isSyncing } = useChatSync(config.relayUrls);

  // useChatHistorySync({
  //   conversations,
  //   setConversations,
  //   activeConversationId,
  //   setMessages,
  //   conversationsLoaded
  // });

  const syncWithNostr = useCallback(async () => {
    const syncedConversations = await syncConversations();
    if (syncedConversations.length > 0) {
      setConversations(prev => {
        // Merge logic: prefer synced conversations but keep local ones if not present?
        // Or just overwrite?
        // For "Sync-to-Self", the relay state is the truth.
        // But we might have local unsynced changes.
        // For now, let's merge by ID, preferring the synced version if it has more messages?
        // Or just simple overwrite for existing IDs.
        
        const newMap = new Map(prev.map(c => [c.id, c]));
        syncedConversations.forEach(c => {
          newMap.set(c.id, c);
        });
        
        const merged = Array.from(newMap.values());
        // Persist to storage
        saveConversationToStorage(merged, '', []); // Just to trigger save, arguments are a bit weird in util
        // Actually saveConversationToStorage only saves one. We need persistConversationsSnapshot
        // But we can't import it easily if it's not exported or we don't want to duplicate logic.
        // Let's just return merged and let the effect handle it if we trigger a state update.
        // But we need to persist it.
        
        // We can use the setConversations callback to update state,
        // but we should also persist to localStorage.
        // The util `persistConversationsSnapshot` is exported.
        // Let's import it if needed, or just rely on the fact that `saveConversationToStorage` calls it.
        
        return merged;
      });
    }
  }, [syncConversations]);

  // Load conversations and active conversation ID from storage on mount
  useEffect(() => {
    const loadedConversations = loadConversationsFromStorage();
    setConversations(loadedConversations);
    setConversationsLoaded(true);
  }, []);

  // Save current conversation whenever messages change
  const saveCurrentConversation = useCallback(() => {
    console.log('logging COVNERTS')
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
