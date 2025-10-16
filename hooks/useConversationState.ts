import { useState, useEffect, useCallback } from 'react';
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

  useChatHistorySync({
    conversations,
    setConversations,
    activeConversationId,
    setMessages,
    conversationsLoaded
  });

  // Load conversations and active conversation ID from storage on mount
  useEffect(() => {
    const loadedConversations = loadConversationsFromStorage();
    setConversations(loadedConversations);
    setConversationsLoaded(true);

  }, []);

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

  const createNewConversationHandler = useCallback((initialMessages: Message[] = []) => {
    let createdId: string = '';
    setConversations(prevConversations => {
      const { newConversation, updatedConversations } = createNewConversation(prevConversations, initialMessages);
      createdId = newConversation.id;
      setActiveConversationIdWithStorage(newConversation.id);
      // Set messages to the initial messages (empty array if none provided)
      setMessages(initialMessages);
      return updatedConversations;
    });
    return createdId;
  }, [setActiveConversationIdWithStorage]);

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
    conversationsLoaded
  };
};
