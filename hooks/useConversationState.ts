import { useState, useEffect, useCallback, useRef } from 'react';
import { Conversation, Message } from '@/types/chat';
import {
  loadConversationsFromStorage,
  saveConversationToStorage,
  createNewConversation,
  deleteConversationFromStorage,
  findConversationById,
  clearAllConversations
} from '@/utils/conversationUtils';
import { getTextFromContent } from '@/utils/messageUtils';
import { loadActiveConversationId, saveActiveConversationId } from '@/utils/storageUtils';
import { useChatHistorySync } from './useChatHistorySync';
import { useConversationSync, StoredConversation } from '@/hooks/useConversationSync';

export interface SyncConflict {
  conversationId: string;
  localVersion: Conversation;
  cloudVersion: StoredConversation;
  conflictType: 'title' | 'messages' | 'both';
}

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
  createNewConversationHandler: (initialMessages?: Message[]) => string;
  loadConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string, e: React.MouseEvent) => void;
  clearConversations: () => void;
  startEditingMessage: (index: number) => void;
  cancelEditing: () => void;
  saveCurrentConversation: () => void;
  saveConversationById: (conversationId: string, newMessages: Message[]) => void;
  getActiveConversationId: () => string | null;
  isLoadingConversations?: boolean;
  isSyncingConversations?: boolean;
  cloudSyncEnabled?: boolean;
  setCloudSyncEnabled?: (enabled: boolean) => void;
  refetchConversations?: () => void;
  syncConflicts?: SyncConflict[];
  resolveSyncConflict?: (conversationId: string, useLocal: boolean) => void;
  dismissSyncConflict?: (conversationId: string) => void;
  lastSyncTime?: number | null;
}

/**
 * Custom hook for managing conversation and message state
 * Handles conversation CRUD operations, message state management,
 * active conversation tracking, and conversation persistence
 */
export const useConversationState = (): UseConversationStateReturn => {
  const {
    syncedConversations,
    isLoadingConversations,
    isSyncingConversations,
    addOrUpdateConversation,
    deleteConversation: deleteConversationSync,
    cloudSyncEnabled,
    setCloudSyncEnabled,
    lastSyncTime,
    refetch: refetchConversations
  } = useConversationSync();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);

  // Use ref to access current conversations without causing re-renders
  const conversationsRef = useRef<Conversation[]>(conversations);
  conversationsRef.current = conversations;

  // Use a debounce timer for cloud sync
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Use chat history sync hook
  useChatHistorySync({
    conversations,
    setConversations,
    activeConversationId,
    setMessages,
    conversationsLoaded
  });

  // Sync conversations from cloud sync hook
  useEffect(() => {
    if (!conversationsLoaded) {
      if (syncedConversations.length > 0) {
        const localConversations = loadConversationsFromStorage();
        const conflicts: SyncConflict[] = [];

        const mergedConversations = syncedConversations.map(cloudConv => {
          const localConv = localConversations.find(l => l.id === cloudConv.id);

          if (localConv && localConv.updatedAt && cloudConv.updatedAt) {
            const timeDiff = Math.abs(localConv.updatedAt - cloudConv.updatedAt);
            if (timeDiff > 1000) {
              let conflictType: 'title' | 'messages' | 'both' = 'messages';
              if (localConv.title !== cloudConv.title && localConv.messages.length !== cloudConv.messages.length) {
                conflictType = 'both';
              } else if (localConv.title !== cloudConv.title) {
                conflictType = 'title';
              }

              conflicts.push({
                conversationId: cloudConv.id,
                localVersion: localConv,
                cloudVersion: cloudConv,
                conflictType
              });
            }
          }

          return {
            id: cloudConv.id,
            title: cloudConv.title,
            messages: cloudConv.messages
          };
        });

        setSyncConflicts(conflicts);
        setConversations(mergedConversations);
        setConversationsLoaded(true);
      } else {
        const loadedConversations = loadConversationsFromStorage();
        setConversations(loadedConversations);
        setConversationsLoaded(true);
      }
    }
  }, [syncedConversations, conversationsLoaded]);

  // Save current conversation whenever messages change
  const saveCurrentConversation = useCallback(() => {
    if (!activeConversationId) return;

    setConversations(prevConversations => {
      return saveConversationToStorage(
        prevConversations,
        activeConversationId,
        messages,
        false, // Don't sync inside setState
        undefined
      );
    });

    // Debounced sync to cloud to avoid re-render loops
    if (cloudSyncEnabled) {
      // Clear existing timer
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }

      // Set new timer for debounced sync
      syncTimerRef.current = setTimeout(() => {
        const activeConversation = conversationsRef.current.find(c => c.id === activeConversationId);
        if (activeConversation) {
          const updatedConversation = {
            ...activeConversation,
            messages
          };
          addOrUpdateConversation(updatedConversation);
        }
      }, 1000); // Debounce for 1 second
    }
  }, [activeConversationId, messages, cloudSyncEnabled, addOrUpdateConversation]);

  // Auto-save conversation when messages change
  useEffect(() => {
    if (activeConversationId && messages.length > 0 && conversationsLoaded) {
      saveCurrentConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeConversationId, conversationsLoaded]);

  // Set editing content when editing message index changes
  useEffect(() => {
    if (editingMessageIndex !== null && messages[editingMessageIndex]) {
      const messageText = getTextFromContent(messages[editingMessageIndex].content);
      setEditingContent(messageText);
    }
  }, [editingMessageIndex, messages]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
    };
  }, []);

  const createNewConversationHandler = useCallback((initialMessages: Message[] = []) => {
    const { newConversation, updatedConversations } = createNewConversation(
      conversationsRef.current,
      initialMessages,
      cloudSyncEnabled,
      cloudSyncEnabled ? (conv) => addOrUpdateConversation(conv) : undefined
    );

    setConversations(updatedConversations);
    setActiveConversationId(newConversation.id);
    setMessages(initialMessages);

    if (cloudSyncEnabled) {
      addOrUpdateConversation(newConversation);
    }

    return newConversation.id;
  }, [cloudSyncEnabled, addOrUpdateConversation]);

  const loadConversation = useCallback((conversationId: string) => {
    const conversation = findConversationById(conversationsRef.current, conversationId);
    if (conversation) {
      setActiveConversationId(conversationId);
      setMessages(conversation.messages);
    }
  }, []);

  const deleteConversation = useCallback((conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (cloudSyncEnabled) {
      deleteConversationSync(conversationId);
    }

    setConversations(prevConversations => {
      const updatedConversations = deleteConversationFromStorage(prevConversations, conversationId);
      
      if (conversationId === activeConversationId) {
        setActiveConversationId(null);
        setMessages([]);
      }
      
      return updatedConversations;
    });
  }, [activeConversationId, cloudSyncEnabled, deleteConversationSync]);

  const clearConversations = useCallback(() => {
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    clearAllConversations();
  }, []);

  const startEditingMessage = useCallback((index: number) => {
    setEditingMessageIndex(index);
    const messageText = getTextFromContent(messages[index].content);
    setEditingContent(messageText);
  }, [messages]);

  const cancelEditing = useCallback(() => {
    setEditingMessageIndex(null);
    setEditingContent('');
  }, []);

  const resolveSyncConflict = useCallback((conversationId: string, useLocal: boolean) => {
    const conflict = syncConflicts.find(c => c.conversationId === conversationId);
    if (!conflict) return;

    const resolvedConversation = useLocal ? conflict.localVersion : {
      id: conflict.cloudVersion.id,
      title: conflict.cloudVersion.title,
      messages: conflict.cloudVersion.messages
    };

    setConversations(prev => prev.map(conv => 
      conv.id === conversationId ? resolvedConversation : conv
    ));

    if (cloudSyncEnabled) {
      addOrUpdateConversation(resolvedConversation);
    }

    setSyncConflicts(prev => prev.filter(c => c.conversationId !== conversationId));
  }, [syncConflicts, cloudSyncEnabled, addOrUpdateConversation]);

  const dismissSyncConflict = useCallback((conversationId: string) => {
    setSyncConflicts(prev => prev.filter(c => c.conversationId !== conversationId));
  }, []);

  // Save a conversation by ID (used by chat to update messages after editing)
  const saveConversationById = useCallback((conversationId: string, newMessages: Message[]) => {
    const conversation = conversations.find(c => c.id === conversationId);
    if (conversation) {
      const updatedConversation = {
        ...conversation,
        messages: newMessages
      };

      if (cloudSyncEnabled) {
        addOrUpdateConversation(updatedConversation);
      }

      const updatedConversations = conversations.map(c =>
        c.id === conversationId ? updatedConversation : c
      );
      setConversations(updatedConversations);
      saveConversationToStorage(updatedConversation);

      // If this is the active conversation, update messages state too
      if (conversationId === activeConversationId) {
        setMessages(newMessages);
      }
    }
  }, [conversations, activeConversationId, cloudSyncEnabled, addOrUpdateConversation]);

  // Get the active conversation ID (useful for external hooks/components)
  const getActiveConversationId = useCallback(() => {
    return activeConversationId;
  }, [activeConversationId]);

  return {
    conversations,
    conversationsLoaded,
    activeConversationId,
    messages,
    editingMessageIndex,
    editingContent,
    setConversations,
    setActiveConversationId,
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
    saveConversationById,
    getActiveConversationId,
    isLoadingConversations,
    isSyncingConversations,
    cloudSyncEnabled,
    setCloudSyncEnabled,
    refetchConversations,
    syncConflicts,
    resolveSyncConflict,
    dismissSyncConflict,
    lastSyncTime
  };
};